import { ISystemCollector } from "./interfaces";
import { SystemInfo } from "../types";
import { execCommand } from "../utils/exec";

export class DarwinSystemCollector implements ISystemCollector {
  private prevCpuUser = 0;
  private prevCpuSystem = 0;
  private prevCpuIdle = 0;

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
    } catch {
      // fallback: just report 0
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
    } catch {
      // sysctl or vm_stat not available
    }

    return { cpuPercent, memUsedMib, memTotalMib };
  }
}
