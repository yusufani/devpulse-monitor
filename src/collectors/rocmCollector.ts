import { IGpuCollector } from "./interfaces";
import { GpuInfo, GpuProcess } from "../types";
import { findBinary, execCommand } from "../utils/exec";
import { log } from "../utils/logger";

export class RocmCollector implements IGpuCollector {
  private rocmPath: string | null = null;

  async isAvailable(): Promise<boolean> {
    this.rocmPath = await findBinary("rocm-smi");
    return this.rocmPath !== null;
  }

  async collectGpus(): Promise<GpuInfo[]> {
    if (!this.rocmPath) return [];
    const gpus: GpuInfo[] = [];

    try {
      const { stdout } = await execCommand(
        `${this.rocmPath} --showmeminfo vram --showuse --showtemp --showpower --json`,
        { timeout: 10000 },
      );
      const data = JSON.parse(stdout);

      // rocm-smi JSON structure varies by version; handle common formats
      const cards = Object.keys(data).filter((k) => k.startsWith("card"));
      for (let i = 0; i < cards.length; i++) {
        const card = data[cards[i]];
        const memUsed = Math.round((parseInt(card["VRAM Total Used Memory (B)"] || "0") || 0) / (1024 * 1024));
        const memTotal = Math.round((parseInt(card["VRAM Total Memory (B)"] || "0") || 0) / (1024 * 1024));
        gpus.push({
          index: i,
          name: card["Card Series"] || card["Card series"] || `AMD GPU ${i}`,
          vendor: "amd",
          memUsed,
          memTotal,
          memFree: memTotal - memUsed,
          util: parseInt(card["GPU use (%)"] || "0") || 0,
          temp: parseFloat(card["Temperature (Sensor edge) (C)"] || card["Temperature (Sensor junction) (C)"] || "0") || 0,
          power: parseFloat(card["Average Graphics Package Power (W)"] || "0") || 0,
        });
      }
    } catch (e) {
      log(`rocm-smi query failed: ${e}`);
    }

    return gpus;
  }

  async collectProcesses(_containerNameMap: Map<string, string>): Promise<GpuProcess[]> {
    // ROCm doesn't have a clean per-process VRAM query like nvidia-smi
    // Future: parse /sys/kernel/debug/dri/*/clients or rocm-smi --showpids
    return [];
  }
}
