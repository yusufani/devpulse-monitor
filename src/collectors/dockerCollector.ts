import { readFileSync } from "fs";
import * as os from "os";
import { IDockerCollector } from "./interfaces";
import { ContainerStats, ContainerFullInfo, ContainerInspect } from "../types";
import { findBinary, execCommand } from "../utils/exec";
import { toMib } from "../utils/format";
import { detectPlatform } from "../utils/platform";
import { log, logDebug } from "../utils/logger";

function readProcFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

// UID resolution cache (persistent across refreshes)
let _uidMap: Map<number, string> | null = null;

async function resolveUid(uid: number): Promise<string> {
  if (!_uidMap) {
    _uidMap = new Map();
    try {
      const passwd = readProcFile("/etc/passwd");
      for (const line of passwd.split("\n")) {
        const p = line.split(":");
        if (p.length >= 3) _uidMap.set(parseInt(p[2]), p[0]);
      }
    } catch {
      // no passwd file
    }
  }
  if (_uidMap.has(uid)) return _uidMap.get(uid)!;
  try {
    const { stdout } = await execCommand(`id -un ${uid}`, { timeout: 3000 });
    const name = stdout.trim();
    if (name) {
      _uidMap.set(uid, name);
      return name;
    }
  } catch (e) {
    logDebug(`[docker] id -un ${uid} failed: ${e}`);
  }
  return `uid:${uid}`;
}

const STATS_CACHE_TTL = 25_000;
const OWNER_CACHE_TTL = 120_000; // owner bilgisi 2 dakika cache'lenir
const CONTAINER_LIST_CACHE_TTL = 8_000; // container listesi 8s cache (30s refresh'te yeterli)

export class DockerCollector implements IDockerCollector {
  private dockerPath: string | null = null;

  // Stats cache
  private cachedStats = new Map<string, ContainerStats>();
  private lastStatsTime = 0;

  // Owner cache — container id → owner name
  private ownerCache = new Map<string, string>();
  private lastOwnerTime = 0;

  // Container name cache — container id → name (from last docker ps)
  private containerNameCache = new Map<string, string>();
  private lastContainerListTime = 0;
  private lastContainerList: ContainerFullInfo[] = [];

  async isAvailable(): Promise<boolean> {
    this.dockerPath = await findBinary("docker");
    return this.dockerPath !== null;
  }

  private get docker(): string {
    return this.dockerPath || "docker";
  }

  /**
   * Returns cached container name map. Cheap — no extra docker ps call.
   * Data comes from the last getAllRunningContainers() call.
   */
  async getContainerNames(): Promise<Map<string, string>> {
    // If cache is fresh, return it directly
    if (this.containerNameCache.size > 0 && Date.now() - this.lastContainerListTime < CONTAINER_LIST_CACHE_TTL) {
      return new Map(this.containerNameCache);
    }
    // Otherwise do a lightweight docker ps (only ID|Name)
    const map = new Map<string, string>();
    try {
      const { stdout } = await execCommand(`${this.docker} ps --format "{{.ID}}|{{.Names}}" --no-trunc`);
      for (const line of stdout.trim().split("\n")) {
        if (!line.includes("|")) continue;
        const [cid, name] = line.split("|", 2);
        map.set(cid.substring(0, 12), name);
      }
    } catch (e) {
      log(`[names] getContainerNames failed: ${e}`);
    }
    this.containerNameCache = map;
    this.lastContainerListTime = Date.now();
    return new Map(map);
  }

  async getAllRunningContainers(): Promise<ContainerFullInfo[]> {
    if (!this.dockerPath) return [];
    const platform = detectPlatform();

    try {
      const { stdout } = await execCommand(
        `${this.docker} ps --no-trunc --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Label \\"com.docker.compose.project\\"}}|{{.Image}}|{{.Ports}}"`,
      );
      const lines = stdout
        .trim()
        .split("\n")
        .filter((l) => l.includes("|"));
      if (lines.length === 0) {
        this.lastContainerList = [];
        return [];
      }

      // Update container name cache from this docker ps result
      const nameMap = new Map<string, string>();
      for (const line of lines) {
        const parts = line.split("|");
        nameMap.set(parts[0].substring(0, 12), parts[1]);
      }
      this.containerNameCache = nameMap;
      this.lastContainerListTime = Date.now();

      const ids = lines.map((l) => l.split("|", 1)[0]);
      const { stdout: pidOut } = await execCommand(`${this.docker} inspect --format '{{.State.Pid}}' ${ids.join(" ")}`);
      const pids = pidOut
        .trim()
        .split("\n")
        .map((s) => parseInt(s.trim()) || 0);

      // Resolve owners with cache
      await this.resolveOwners(lines, pids, platform);

      const results: ContainerFullInfo[] = [];
      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split("|");
        const fullId = parts[0];
        const name = parts[1];
        const status = parts[2] || "";
        const composeProject = parts[3] || "";
        const image = parts[4] || "";
        const portsRaw = parts.slice(5).join("|") || "";
        const pid = pids[i] || 0;
        const cid = fullId.substring(0, 12);
        const ownerName = this.ownerCache.get(cid) || "?";

        let health: ContainerFullInfo["health"] = "none";
        if (status.includes("(healthy)")) health = "healthy";
        else if (status.includes("(unhealthy)")) health = "unhealthy";
        else if (status.includes("(health: starting)") || status.includes("health: starting")) health = "starting";

        const uptimeMatch = status.match(/Up\s+(.+?)(?:\s+\(|$)/);
        const uptime = uptimeMatch ? uptimeMatch[1].trim() : "";

        results.push({
          id: cid,
          name,
          mainPid: pid,
          ownerUid: -1,
          ownerName,
          health,
          composeProject,
          uptime,
          image,
          ports: portsRaw,
        });
      }
      this.lastContainerList = results;
      return results;
    } catch (e) {
      log(`[containers] getAllRunningContainers failed: ${e}`);
      return [];
    }
  }

  /**
   * Resolve container owners with a TTL cache.
   * Only re-resolves containers not already in cache or when cache expires.
   */
  private async resolveOwners(
    lines: string[],
    pids: number[],
    platform: string,
  ): Promise<void> {
    const cacheExpired = Date.now() - this.lastOwnerTime > OWNER_CACHE_TTL;

    // Find which containers need owner resolution
    const needResolution: Array<{ cid: string; name: string; pid: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split("|");
      const cid = parts[0].substring(0, 12);
      const name = parts[1];
      if (cacheExpired || !this.ownerCache.has(cid)) {
        needResolution.push({ cid, name, pid: pids[i] || 0 });
      }
    }

    if (needResolution.length === 0) return;

    if (platform === "linux" || platform === "darwin") {
      // Try /proc-based resolution first
      let procWorks = false;
      const testPid = needResolution.find((c) => c.pid > 0)?.pid;
      if (testPid) {
        const testStatus = readProcFile(`/proc/${testPid}/status`);
        procWorks = testStatus.length > 0;
      }

      if (procWorks) {
        for (const { cid, pid } of needResolution) {
          if (pid > 0) {
            const status = readProcFile(`/proc/${pid}/status`);
            const uidMatch = status.match(/Uid:\s+(\d+)/);
            if (uidMatch) {
              this.ownerCache.set(cid, await resolveUid(parseInt(uidMatch[1])));
            }
          }
        }
      } else {
        // /proc not accessible — use docker inspect (single batch, no docker top)
        logDebug("[owner] /proc not accessible, resolving owners via docker inspect");
        const promises = needResolution.map(async ({ cid, name }) => {
          try {
            const { stdout: inspectOut } = await execCommand(
              `${this.docker} inspect --format '{{.Config.User}}' ${cid}`,
              { timeout: 5000 },
            );
            const configUser = inspectOut.trim();
            if (configUser && configUser !== "''" && configUser !== "''") {
              const userPart = configUser.split(":")[0];
              const numericUid = parseInt(userPart);
              if (!isNaN(numericUid)) {
                this.ownerCache.set(cid, await resolveUid(numericUid));
              } else {
                this.ownerCache.set(cid, userPart);
              }
              return;
            }
            // If Config.User is empty, mark as "root" (Docker default)
            this.ownerCache.set(cid, "root");
          } catch (e) {
            logDebug(`[owner] owner resolution failed for ${name} (${cid}): ${e}`);
            this.ownerCache.set(cid, "?");
          }
        });
        await Promise.all(promises);
      }
    }

    this.lastOwnerTime = Date.now();

    // Clean up cache entries for containers that no longer exist
    const currentIds = new Set(lines.map((l) => l.split("|")[0].substring(0, 12)));
    for (const key of this.ownerCache.keys()) {
      if (!currentIds.has(key)) this.ownerCache.delete(key);
    }
  }

  async getContainerStats(): Promise<Map<string, ContainerStats>> {
    if (!this.dockerPath) return new Map();

    if (Date.now() - this.lastStatsTime < STATS_CACHE_TTL && this.cachedStats.size > 0) {
      return new Map(this.cachedStats);
    }

    const map = new Map<string, ContainerStats>();
    try {
      const { stdout } = await execCommand(
        `${this.docker} stats --no-stream --no-trunc --format "{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.BlockIO}}"`,
        { timeout: 20000, retries: 1 },
      );
      const numCores = os.cpus().length || 1;
      for (const line of stdout.trim().split("\n")) {
        const parts = line.split("|");
        if (parts.length < 4) continue;
        const cid = parts[0].trim().substring(0, 12);
        const cpuRaw = parseFloat(parts[1].replace("%", "")) || 0;
        const memPct = parseFloat(parts[3].replace("%", "")) || 0;
        const memParts = parts[2].split("/");
        map.set(cid, {
          cpuPercent: cpuRaw / numCores,
          memUsedMib: memParts.length >= 1 ? toMib(memParts[0]) : 0,
          memLimitMib: memParts.length >= 2 ? toMib(memParts[1]) : 0,
          memPercent: memPct,
          netIO: (parts[4] || "").trim(),
          blockIO: (parts[5] || "").trim(),
        });
      }
    } catch (e) {
      log(`[stats] getContainerStats failed: ${e}`);
    }

    this.cachedStats = map;
    this.lastStatsTime = Date.now();
    return new Map(map);
  }

  async stopContainer(containerId: string): Promise<void> {
    await execCommand(`${this.docker} stop ${containerId}`);
  }

  async killContainer(containerId: string): Promise<void> {
    await execCommand(`${this.docker} kill ${containerId}`);
  }

  async restartContainer(containerId: string): Promise<void> {
    await execCommand(`${this.docker} restart ${containerId}`, { timeout: 30000 });
  }

  /** On-demand inspect — only called when user explicitly requests env/volumes */
  async inspectContainer(containerId: string): Promise<ContainerInspect> {
    try {
      const { stdout } = await execCommand(
        `${this.docker} inspect --format '{{json .Config.Env}}|||{{json .Mounts}}' ${containerId}`,
        { timeout: 5000 },
      );
      const [envJson, mountsJson] = stdout.split("|||");
      const env: string[] = JSON.parse(envJson || "[]");
      const rawMounts: Array<{ Source: string; Destination: string; Mode: string }> = JSON.parse(mountsJson || "[]");
      return {
        env,
        mounts: rawMounts.map((m) => ({ source: m.Source, destination: m.Destination, mode: m.Mode || "rw" })),
      };
    } catch (e) {
      log(`[inspect] inspectContainer failed: ${e}`);
      return { env: [], mounts: [] };
    }
  }
}
