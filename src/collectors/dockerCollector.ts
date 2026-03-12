import { readFileSync } from "fs";
import * as os from "os";
import { IDockerCollector } from "./interfaces";
import { ContainerStats, ContainerFullInfo, ContainerInspect } from "../types";
import { findBinary, execCommand } from "../utils/exec";
import { toMib } from "../utils/format";
import { detectPlatform } from "../utils/platform";
import { log } from "../utils/logger";

function readProcFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

// UID resolution cache
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
  return _uidMap.get(uid) || `uid:${uid}`;
}

const STATS_CACHE_TTL = 25_000;

export class DockerCollector implements IDockerCollector {
  private dockerPath: string | null = null;
  private cachedStats = new Map<string, ContainerStats>();
  private lastStatsTime = 0;

  async isAvailable(): Promise<boolean> {
    this.dockerPath = await findBinary("docker");
    return this.dockerPath !== null;
  }

  private get docker(): string {
    return this.dockerPath || "docker";
  }

  async getContainerNames(): Promise<Map<string, string>> {
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
    return map;
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
      if (lines.length === 0) return [];

      const ids = lines.map((l) => l.split("|", 1)[0]);
      const { stdout: pidOut } = await execCommand(`${this.docker} inspect --format '{{.State.Pid}}' ${ids.join(" ")}`);
      const pids = pidOut
        .trim()
        .split("\n")
        .map((s) => parseInt(s.trim()) || 0);

      // Resolve owners: try /proc first, fallback to docker top
      const ownerMap = new Map<string, string>();
      if (platform === "linux") {
        // Try /proc-based resolution (works when running on host)
        let procWorks = false;
        if (pids[0] > 0) {
          const testStatus = readProcFile(`/proc/${pids[0]}/status`);
          procWorks = testStatus.length > 0;
        }

        if (procWorks) {
          for (let i = 0; i < lines.length; i++) {
            const name = lines[i].split("|")[1];
            const pid = pids[i] || 0;
            if (pid > 0) {
              const status = readProcFile(`/proc/${pid}/status`);
              const uidMatch = status.match(/Uid:\s+(\d+)/);
              if (uidMatch) {
                ownerMap.set(name, await resolveUid(parseInt(uidMatch[1])));
              }
            }
          }
        } else {
          // /proc not accessible (running inside container)
          log("[owner] /proc not accessible, using docker inspect + docker top fallback");
          const topPromises = lines.map(async (line) => {
            const parts = line.split("|");
            const id = parts[0], name = parts[1];
            const cid = id.substring(0, 12);
            try {
              // First try docker inspect for configured user
              const { stdout: inspectOut } = await execCommand(
                `${this.docker} inspect --format '{{.Config.User}}' ${cid}`,
                { timeout: 5000 },
              );
              const configUser = inspectOut.trim();
              if (configUser && configUser !== "''" && configUser !== "''") {
                // May be numeric UID like "1000" or "1000:1000" — resolve to name
                const userPart = configUser.split(":")[0];
                const numericUid = parseInt(userPart);
                if (!isNaN(numericUid)) {
                  ownerMap.set(name, await resolveUid(numericUid));
                } else {
                  ownerMap.set(name, userPart);
                }
                return;
              }

              // Fallback: docker top for main process user
              const { stdout: topOut } = await execCommand(
                `${this.docker} top ${cid} -eo pid,user`,
                { timeout: 5000 },
              );
              const topLines = topOut.trim().split("\n");
              if (topLines.length >= 2) {
                const user = topLines[1].trim().split(/\s+/)[1] || topLines[1].trim().split(/\s+/)[0];
                if (user) {
                  // Resolve numeric UIDs
                  const numericUid = parseInt(user);
                  if (!isNaN(numericUid)) {
                    ownerMap.set(name, await resolveUid(numericUid));
                  } else {
                    ownerMap.set(name, user);
                  }
                }
              }
            } catch {
              // skip — owner stays "?"
            }
          });
          await Promise.all(topPromises);
        }
      }

      const results: ContainerFullInfo[] = [];
      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split("|");
        const fullId = parts[0];
        const name = parts[1];
        const status = parts[2] || "";
        const composeProject = parts[3] || "";
        const image = parts[4] || "";
        const portsRaw = parts.slice(5).join("|") || ""; // ports may contain pipes
        const pid = pids[i] || 0;
        const ownerName = ownerMap.get(name) || "?";

        // Parse health from status string (e.g. "Up 2 hours (healthy)")
        let health: ContainerFullInfo["health"] = "none";
        if (status.includes("(healthy)")) health = "healthy";
        else if (status.includes("(unhealthy)")) health = "unhealthy";
        else if (status.includes("(health: starting)") || status.includes("health: starting")) health = "starting";

        // Parse uptime from status (e.g. "Up 2 hours", "Up 3 days")
        const uptimeMatch = status.match(/Up\s+(.+?)(?:\s+\(|$)/);
        const uptime = uptimeMatch ? uptimeMatch[1].trim() : "";

        results.push({
          id: fullId.substring(0, 12),
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
      return results;
    } catch (e) {
      log(`[containers] getAllRunningContainers failed: ${e}`);
      return [];
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
