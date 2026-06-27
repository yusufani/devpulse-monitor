import { readFile } from "fs/promises";
import { ISystemCollector, CollectOptions, PodIndex } from "./interfaces";
import { SystemInfo, DiskInfo, HostProcessInfo } from "../types";
import { execCommand } from "../utils/exec";
import { resolveContainerFromPid } from "./containerResolver";
import { logDebug } from "../utils/logger";

const DISK_CACHE_TTL = 60_000; // 60s — disk changes slowly
const RESOLVE_MIN_RSS_MIB = 50; // only map sizeable processes to containers
const RESOLVE_MAX = 250; // cap /proc/<pid>/cgroup reads per refresh

export class LinuxSystemCollector implements ISystemCollector {
  private prevCpuIdle = 0;
  private prevCpuTotal = 0;
  private cachedDisks: DiskInfo[] = [];
  private diskCacheTime = 0;

  async collect(containerNameMap?: Map<string, string>, opts?: CollectOptions, podIndex?: PodIndex): Promise<SystemInfo> {
    let cpuPercent = 0;
    try {
      const stat = await readFile("/proc/stat", "utf-8");
      const parts = stat.split("\n")[0].split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      if (this.prevCpuTotal > 0) {
        const dT = total - this.prevCpuTotal;
        const dI = idle - this.prevCpuIdle;
        cpuPercent = dT > 0 ? Math.round(((dT - dI) / dT) * 100) : 0;
      }
      this.prevCpuIdle = idle;
      this.prevCpuTotal = total;
    } catch (e) {
      logDebug(`[linux] /proc/stat CPU read failed: ${e}`);
    }

    let memUsedMib = 0,
      memTotalMib = 0;
    try {
      const mi = await readFile("/proc/meminfo", "utf-8");
      const val = (k: string) => {
        const m = mi.match(new RegExp(`${k}:\\s+(\\d+)`));
        return m ? parseInt(m[1]) : 0;
      };
      memTotalMib = Math.round(val("MemTotal") / 1024);
      memUsedMib = Math.round((val("MemTotal") - val("MemAvailable")) / 1024);
    } catch (e) {
      logDebug(`[linux] /proc/meminfo memory read failed: ${e}`);
    }

    // Disk — cached, refreshed every 60s
    if (Date.now() - this.diskCacheTime > DISK_CACHE_TTL) {
      this.cachedDisks = await collectDisks();
      this.diskCacheTime = Date.now();
    }

    // Host processes (RAM / CPU by user) — collected while either manager is expanded.
    // A single ps call yields both rss and %cpu, so RAM and CPU share it.
    let hostProcesses: HostProcessInfo[] = [];
    if (opts?.ram || opts?.cpu) {
      hostProcesses = await collectHostProcesses(containerNameMap ?? new Map(), podIndex);
    }

    // Disk-user breakdown (du) is orchestrated by MonitorService (cancellable + progress)
    return {
      cpuPercent,
      memUsedMib,
      memTotalMib,
      disks: this.cachedDisks,
      hostProcesses,
      diskUsers: [],
    };
  }
}

/** Read all processes via ps and attribute the largest ones to containers via /proc cgroup. */
async function collectHostProcesses(nameMap: Map<string, string>, podIndex?: PodIndex): Promise<HostProcessInfo[]> {
  try {
    // comm last so the fixed-width leading columns parse cleanly
    const { stdout } = await execCommand(
      "ps -eo pid,uid,user:32,pcpu,rss,comm --no-headers --sort=-rss 2>/dev/null",
      { timeout: 5000 },
    );
    const procs: HostProcessInfo[] = [];
    let resolved = 0;
    for (const line of stdout.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const pid = parseInt(parts[0]);
      const uid = parseInt(parts[1]);
      const username = parts[2];
      const cpuPercent = parseFloat(parts[3]) || 0;
      const rssKb = parseInt(parts[4]);
      const comm = parts.slice(5).join(" ");
      if (!pid || !(rssKb > 0)) continue;
      const rssMib = Math.round(rssKb / 1024);
      let containerId = "";
      let containerName = "";
      if (resolved < RESOLVE_MAX && rssMib >= RESOLVE_MIN_RSS_MIB) {
        resolved++;
        const c = resolveContainerFromPid(pid, nameMap, podIndex);
        if (c.id) {
          containerId = c.id;
          containerName = c.name;
        }
      }
      procs.push({ pid, uid, username, rssMib, cpuPercent, comm, containerId, containerName });
    }
    return procs;
  } catch (e) {
    logDebug(`[linux] host process collection failed: ${e}`);
    return [];
  }
}

async function collectDisks(): Promise<DiskInfo[]> {
  try {
    // -P = POSIX format (stable parsing), -x = exclude pseudo-fs types
    const { stdout } = await execCommand(
      "df -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x fuse.lxcfs 2>/dev/null",
      { timeout: 5000 },
    );
    const disks: DiskInfo[] = [];
    const seen = new Set<string>(); // deduplicate by device
    for (const line of stdout.trim().split("\n").slice(1)) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const device = parts[0];
      if (!device.startsWith("/")) continue; // skip non-device entries
      if (seen.has(device)) continue;
      seen.add(device);
      const totalKb = parseInt(parts[1]) || 0;
      const usedKb = parseInt(parts[2]) || 0;
      const freeKb = parseInt(parts[3]) || 0;
      if (totalKb < 1024 * 1024) continue; // skip < 1 GiB partitions
      const totalGib = parseFloat((totalKb / (1024 * 1024)).toFixed(1));
      const usedGib = parseFloat((usedKb / (1024 * 1024)).toFixed(1));
      const freeGib = parseFloat((freeKb / (1024 * 1024)).toFixed(1));
      const usedPercent = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
      disks.push({ mount: parts[5], device, totalGib, usedGib, freeGib, usedPercent });
    }
    return disks.sort((a, b) => b.usedPercent - a.usedPercent);
  } catch (e) {
    logDebug(`[linux] disk collection failed: ${e}`);
    return [];
  }
}
