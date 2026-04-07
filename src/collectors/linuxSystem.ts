import { readFile } from "fs/promises";
import { ISystemCollector } from "./interfaces";
import { SystemInfo, DiskInfo } from "../types";
import { execCommand } from "../utils/exec";
import { logDebug } from "../utils/logger";

const DISK_CACHE_TTL = 60_000; // 60s — disk changes slowly

export class LinuxSystemCollector implements ISystemCollector {
  private prevCpuIdle = 0;
  private prevCpuTotal = 0;
  private cachedDisks: DiskInfo[] = [];
  private diskCacheTime = 0;

  async collect(): Promise<SystemInfo> {
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

    return { cpuPercent, memUsedMib, memTotalMib, disks: this.cachedDisks };
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
