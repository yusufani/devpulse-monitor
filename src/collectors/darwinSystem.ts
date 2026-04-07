import { ISystemCollector } from "./interfaces";
import { SystemInfo, DiskInfo } from "../types";
import { execCommand } from "../utils/exec";
import { log, logDebug } from "../utils/logger";

const DISK_CACHE_TTL = 60_000; // 60s

export class DarwinSystemCollector implements ISystemCollector {
  private prevCpuUser = 0;
  private prevCpuSystem = 0;
  private prevCpuIdle = 0;
  private cachedDisks: DiskInfo[] = [];
  private diskCacheTime = 0;

  async collect(): Promise<SystemInfo> {
    let cpuPercent = 0;
    try {
      // Use top to get CPU usage (two samples, use the second)
      const { stdout } = await execCommand("top -l 2 -n 0 -s 1 | grep 'CPU usage' | tail -1", { timeout: 5000 });
      const match = stdout.match(/(\d+\.?\d*)% user.*?(\d+\.?\d*)% sys.*?(\d+\.?\d*)% idle/);
      if (match) {
        const user = parseFloat(match[1]);
        const sys = parseFloat(match[2]);
        const idle = parseFloat(match[3]);
        if (this.prevCpuIdle > 0) {
          cpuPercent = Math.round(user + sys);
        }
        this.prevCpuUser = user;
        this.prevCpuSystem = sys;
        this.prevCpuIdle = idle;
      }
    } catch (e) {
      log(`[darwin] CPU usage query failed: ${e}`);
    }

    let memUsedMib = 0,
      memTotalMib = 0;
    try {
      const { stdout: memTotal } = await execCommand("sysctl -n hw.memsize", { timeout: 3000 });
      memTotalMib = Math.round(parseInt(memTotal.trim()) / (1024 * 1024));

      const { stdout: vmStat } = await execCommand("vm_stat", { timeout: 3000 });
      const pageSize = 16384; // default on Apple Silicon, 4096 on Intel
      const pageSizeMatch = vmStat.match(/page size of (\d+) bytes/);
      const ps = pageSizeMatch ? parseInt(pageSizeMatch[1]) : pageSize;

      const val = (key: string): number => {
        const m = vmStat.match(new RegExp(`"${key}":\\s+(\\d+)`));
        return m ? parseInt(m[1]) : 0;
      };
      const free = val("Pages free");
      const inactive = val("Pages inactive");
      const speculative = val("Pages speculative");
      const purgeable = val("Pages purgeable");
      const available = (free + inactive + speculative + purgeable) * ps;
      memUsedMib = Math.round((parseInt(memTotal.trim()) - available) / (1024 * 1024));
    } catch (e) {
      log(`[darwin] memory query (sysctl/vm_stat) failed: ${e}`);
    }

    // Disk — cached, refreshed every 60s
    if (Date.now() - this.diskCacheTime > DISK_CACHE_TTL) {
      this.cachedDisks = await collectDisksDarwin();
      this.diskCacheTime = Date.now();
    }

    return { cpuPercent, memUsedMib, memTotalMib, disks: this.cachedDisks };
  }
}

async function collectDisksDarwin(): Promise<DiskInfo[]> {
  try {
    const { stdout } = await execCommand("df -P -k 2>/dev/null", { timeout: 5000 });
    const disks: DiskInfo[] = [];
    const seen = new Set<string>();
    for (const line of stdout.trim().split("\n").slice(1)) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const device = parts[0];
      if (!device.startsWith("/dev/")) continue;
      if (seen.has(device)) continue;
      seen.add(device);
      const totalKb = parseInt(parts[1]) || 0;
      const usedKb = parseInt(parts[2]) || 0;
      const freeKb = parseInt(parts[3]) || 0;
      if (totalKb < 1024 * 1024) continue; // skip < 1 GiB
      const totalGib = parseFloat((totalKb / (1024 * 1024)).toFixed(1));
      const usedGib = parseFloat((usedKb / (1024 * 1024)).toFixed(1));
      const freeGib = parseFloat((freeKb / (1024 * 1024)).toFixed(1));
      const usedPercent = totalKb > 0 ? Math.round((usedKb / totalKb) * 100) : 0;
      disks.push({ mount: parts[5], device, totalGib, usedGib, freeGib, usedPercent });
    }
    return disks.sort((a, b) => b.usedPercent - a.usedPercent);
  } catch (e) {
    logDebug(`[darwin] disk collection failed: ${e}`);
    return [];
  }
}
