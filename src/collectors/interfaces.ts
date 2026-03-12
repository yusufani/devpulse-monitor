import { SystemInfo, GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo, ContainerInspect } from "../types";

export interface ISystemCollector {
  collect(): Promise<SystemInfo>;
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
