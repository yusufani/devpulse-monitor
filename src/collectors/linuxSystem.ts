import { readFile } from "fs/promises";
import { ISystemCollector } from "./interfaces";
import { SystemInfo } from "../types";
import { logDebug } from "../utils/logger";

export class LinuxSystemCollector implements ISystemCollector {
  private prevCpuIdle = 0;
  private prevCpuTotal = 0;

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

    return { cpuPercent, memUsedMib, memTotalMib };
  }
}
