import { readFile } from "fs/promises";
import * as os from "os";
import { IDockerCollector } from "./interfaces";
import { ContainerStats, ContainerFullInfo } from "../types";
import { findBinary, execCommand } from "../utils/exec";
import { toMib } from "../utils/format";
import { detectPlatform } from "../utils/platform";

async function readProcFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
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
      const passwd = await readProcFile("/etc/passwd");
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
    } catch {
      // docker not available or no containers
    }
    return map;
  }

  async getAllRunningContainers(): Promise<ContainerFullInfo[]> {
    if (!this.dockerPath) return [];
    const platform = detectPlatform();

    try {
      const { stdout } = await execCommand(`${this.docker} ps --no-trunc --format "{{.ID}}|{{.Names}}"`);
      const lines = stdout
        .trim()
        .split("\n")
        .filter((l) => l.includes("|"));
      if (lines.length === 0) return [];

      const ids = lines.map((l) => l.split("|")[0]);
      const { stdout: pidOut } = await execCommand(`${this.docker} inspect --format '{{.State.Pid}}' ${ids.join(" ")}`);
      const pids = pidOut
        .trim()
        .split("\n")
        .map((s) => parseInt(s.trim()) || 0);

      const results: ContainerFullInfo[] = [];
      for (let i = 0; i < lines.length; i++) {
        const [fullId, name] = lines[i].split("|", 2);
        const pid = pids[i] || 0;
        let ownerUid = -1,
          ownerName = "?";

        // PID-based owner resolution only works on Linux
        if (platform === "linux" && pid > 0) {
          const status = await readProcFile(`/proc/${pid}/status`);
          const uidMatch = status.match(/Uid:\s+(\d+)/);
          if (uidMatch) {
            ownerUid = parseInt(uidMatch[1]);
            ownerName = await resolveUid(ownerUid);
          }
        }

        results.push({ id: fullId.substring(0, 12), name, mainPid: pid, ownerUid, ownerName });
      }
      return results;
    } catch {
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
        `${this.docker} stats --no-stream --no-trunc --format "{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}"`,
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
        });
      }
    } catch {
      // docker stats failed
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
}
