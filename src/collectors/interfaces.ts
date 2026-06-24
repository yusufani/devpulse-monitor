import { SystemInfo, GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo, ContainerInspect } from "../types";

/** Which on-demand (potentially expensive) sections to collect this cycle. */
export interface CollectOptions {
  /** Collect per-process RAM usage (ps). Set when RAM Manager is expanded. */
  ram?: boolean;
  /** Collect per-process CPU usage (ps). Set when CPU Manager is expanded. */
  cpu?: boolean;
  /** Collect per-user disk usage (du). Set when Disk Manager is expanded. */
  disk?: boolean;
}

export interface ISystemCollector {
  /** containerNameMap (short id -> name) is used to attribute host processes to containers. */
  collect(containerNameMap?: Map<string, string>, opts?: CollectOptions): Promise<SystemInfo>;
}

export interface IGpuCollector {
  isAvailable(): Promise<boolean>;
  collectGpus(): Promise<GpuInfo[]>;
  collectProcesses(containerNameMap: Map<string, string>): Promise<GpuProcess[]>;
}

export interface IDockerCollector {
  isAvailable(): Promise<boolean>;
  getContainerNames(): Promise<Map<string, string>>;
  getAllRunningContainers(): Promise<ContainerFullInfo[]>;
  getContainerStats(): Promise<Map<string, ContainerStats>>;
  stopContainer(containerId: string): Promise<void>;
  killContainer(containerId: string): Promise<void>;
  restartContainer(containerId: string): Promise<void>;
  inspectContainer(containerId: string): Promise<ContainerInspect>;
}
