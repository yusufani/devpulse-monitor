import { IContainerCollector, PodIndex } from "./interfaces";
import { ContainerStats, ContainerFullInfo, ContainerInspect } from "../types";
import { log } from "../utils/logger";

/**
 * Fans container/pod queries out across multiple sources (Docker + Kubernetes)
 * and merges the results, presenting a single IContainerCollector to the rest
 * of the app. Action methods are dispatched to the right source by id prefix
 * ("k8s:" → Kubernetes, otherwise Docker).
 */
export class ContainerAggregator implements IContainerCollector {
  constructor(private readonly sources: IContainerCollector[]) {}

  async isAvailable(): Promise<boolean> {
    const flags = await Promise.all(this.sources.map((s) => s.isAvailable().catch(() => false)));
    return flags.some(Boolean);
  }

  async getAllRunningContainers(): Promise<ContainerFullInfo[]> {
    const lists = await Promise.all(
      this.sources.map((s) =>
        s.getAllRunningContainers().catch((e) => {
          log(`[aggregator] getAllRunningContainers failed: ${e}`);
          return [] as ContainerFullInfo[];
        }),
      ),
    );
    return lists.flat();
  }

  async getContainerNames(): Promise<Map<string, string>> {
    const maps = await Promise.all(
      this.sources.map((s) => s.getContainerNames().catch(() => new Map<string, string>())),
    );
    const merged = new Map<string, string>();
    for (const m of maps) for (const [k, v] of m) merged.set(k, v);
    return merged;
  }

  async getContainerStats(): Promise<Map<string, ContainerStats>> {
    const maps = await Promise.all(
      this.sources.map((s) => s.getContainerStats().catch(() => new Map<string, ContainerStats>())),
    );
    const merged = new Map<string, ContainerStats>();
    for (const m of maps) for (const [k, v] of m) merged.set(k, v);
    return merged;
  }

  /** Merge pod indexes from any source that provides one (k8s). */
  async getPodIndex(): Promise<PodIndex> {
    const merged: PodIndex = new Map();
    const maps = await Promise.all(
      this.sources.map((s) => (s.getPodIndex ? s.getPodIndex().catch(() => new Map()) : Promise.resolve(new Map()))),
    );
    for (const m of maps) for (const [k, v] of m) merged.set(k, v);
    return merged;
  }

  /** Pick the source responsible for an id ("k8s:" → a source exposing getPodIndex). */
  private pick(id: string): IContainerCollector | undefined {
    if (id.startsWith("k8s:")) return this.sources.find((s) => typeof s.getPodIndex === "function");
    return this.sources.find((s) => typeof s.getPodIndex !== "function") ?? this.sources[0];
  }

  async stopContainer(id: string): Promise<void> {
    await this.pick(id)?.stopContainer(id);
  }

  async killContainer(id: string): Promise<void> {
    await this.pick(id)?.killContainer(id);
  }

  async restartContainer(id: string): Promise<void> {
    await this.pick(id)?.restartContainer(id);
  }

  async inspectContainer(id: string): Promise<ContainerInspect> {
    const src = this.pick(id);
    return src ? src.inspectContainer(id) : { env: [], mounts: [] };
  }
}
