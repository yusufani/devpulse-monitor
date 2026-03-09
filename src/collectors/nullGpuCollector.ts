import { IGpuCollector } from "./interfaces";
import { GpuInfo, GpuProcess } from "../types";

export class NullGpuCollector implements IGpuCollector {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async collectGpus(): Promise<GpuInfo[]> {
    return [];
  }

  async collectProcesses(_containerNameMap: Map<string, string>): Promise<GpuProcess[]> {
    return [];
  }
}
