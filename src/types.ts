export interface SystemInfo {
  cpuPercent: number;
  memUsedMib: number;
  memTotalMib: number;
}

export interface GpuInfo {
  index: number;
  name: string;
  vendor: "nvidia" | "amd" | "apple" | "unknown";
  memUsed: number;
  memTotal: number;
  memFree: number;
  util: number;
  temp: number;
  power: number;
}

export interface GpuProcess {
  pid: number;
  gpuIndex: number;
  memMib: number;
  processName: string;
  containerId: string;
  containerName: string;
  cmdline: string;
  cwd: string;
  cpuPercent: number;
  ramMib: number;
  uid: number;
  username: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memUsedMib: number;
  memLimitMib: number;
  memPercent: number;
  netIO: string;
  blockIO: string;
}

export interface ContainerInspect {
  env: string[];
  mounts: Array<{ source: string; destination: string; mode: string }>;
}

export interface ContainerFullInfo {
  id: string;
  name: string;
  mainPid: number;
  ownerUid: number;
  ownerName: string;
  health: "healthy" | "unhealthy" | "starting" | "none";
  composeProject: string;
  uptime: string;
  image: string;
  ports: string;
}

export interface GpuData {
  gpus: GpuInfo[];
  processes: GpuProcess[];
  containerStats: Map<string, ContainerStats>;
  timestamp: number;
  error: string;
}

export interface MonitorData {
  system: SystemInfo;
  gpuData: GpuData;
  containers: ContainerFullInfo[];
}

