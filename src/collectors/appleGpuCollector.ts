import { IGpuCollector } from "./interfaces";
import { GpuInfo, GpuProcess } from "../types";
import { execCommand } from "../utils/exec";
import { log } from "../utils/logger";
import { detectPlatform } from "../utils/platform";

export class AppleGpuCollector implements IGpuCollector {
  async isAvailable(): Promise<boolean> {
    return detectPlatform() === "darwin";
  }

  async collectGpus(): Promise<GpuInfo[]> {
    const gpus: GpuInfo[] = [];

    try {
      const { stdout } = await execCommand("system_profiler SPDisplaysDataType -json", { timeout: 10000 });
      const data = JSON.parse(stdout);
      const displays = data?.SPDisplaysDataType || [];

      for (let i = 0; i < displays.length; i++) {
        const d = displays[i];
        const name = d._name || `Apple GPU ${i}`;
        // Apple reports VRAM in string format like "16 GB" or as unified memory
        const vramStr = d.sppci_vram || d["spdisplays_vram"] || "0";
        const vramMatch = vramStr.match(/(\d+)\s*(GB|MB)/i);
        let memTotalMib = 0;
        if (vramMatch) {
          const val = parseInt(vramMatch[1]);
          memTotalMib = vramMatch[2].toUpperCase() === "GB" ? val * 1024 : val;
        }

        gpus.push({
          index: i,
          name,
          vendor: "apple",
          memUsed: 0, // Apple doesn't expose per-GPU VRAM usage
          memTotal: memTotalMib,
          memFree: memTotalMib,
          util: 0, // No utilization metric available
          temp: 0, // Would need powermetrics (requires sudo)
          power: 0,
        });
      }
    } catch (e) {
      log(`system_profiler query failed: ${e}`);
    }

    return gpus;
  }

  async collectProcesses(_containerNameMap: Map<string, string>): Promise<GpuProcess[]> {
    // Apple doesn't expose per-process GPU memory usage
    return [];
  }
}
