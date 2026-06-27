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

/**
 * Maps a container short id (first 12 hex of the runtime container id) to the
 * row it should be attributed to. For Kubernetes this remaps a container id to
 * its parent pod (id = "k8s:<namespace>/<pod>"), so GPU/host processes show up
 * under the pod rather than a raw container id.
 */
export type PodIndex = Map<string, { id: string; name: string }>;

export interface ISystemCollector {
  /**
   * containerNameMap (short id -> name) is used to attribute host processes to containers.
   * podIndex (optional) remaps k8s container ids to their parent pod.
   */
  collect(containerNameMap?: Map<string, string>, opts?: CollectOptions, podIndex?: PodIndex): Promise<SystemInfo>;
}

export interface IGpuCollector {
  isAvailable(): Promise<boolean>;
  collectGpus(): Promise<GpuInfo[]>;
  collectProcesses(containerNameMap: Map<string, string>, podIndex?: PodIndex): Promise<GpuProcess[]>;
}

/**
 * A source of container/pod rows. Implemented by DockerCollector, KubernetesCollector
 * and the ContainerAggregator that fans out across multiple sources.
 */
export interface IContainerCollector {
  isAvailable(): Promise<boolean>;
  getContainerNames(): Promise<Map<string, string>>;
  getAllRunningContainers(): Promise<ContainerFullInfo[]>;
  getContainerStats(): Promise<Map<string, ContainerStats>>;
  stopContainer(containerId: string): Promise<void>;
  killContainer(containerId: string): Promise<void>;
  restartContainer(containerId: string): Promise<void>;
  inspectContainer(containerId: string): Promise<ContainerInspect>;
  /** Optional: returns a container-short-id → pod remap (k8s only). */
  getPodIndex?(): Promise<PodIndex>;
}

/** @deprecated Use IContainerCollector. Kept as an alias for backward compatibility. */
export type IDockerCollector = IContainerCollector;
