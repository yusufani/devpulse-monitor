import * as vscode from "vscode";
import { SystemInfo, GpuData, ContainerFullInfo, MonitorData } from "../types";
import { ISystemCollector, IGpuCollector, IDockerCollector } from "../collectors/interfaces";
import { log } from "../utils/logger";

export class MonitorService implements vscode.Disposable {
  private _onDataUpdated = new vscode.EventEmitter<MonitorData>();
  readonly onDataUpdated = this._onDataUpdated.event;

  private system: SystemInfo = { cpuPercent: 0, memUsedMib: 0, memTotalMib: 0 };
  private gpuData: GpuData = { gpus: [], processes: [], containerStats: new Map(), timestamp: 0, error: "" };
  private containers: ContainerFullInfo[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private gpuEnabled: boolean;

  constructor(
    private systemCollector: ISystemCollector,
    private gpuCollector: IGpuCollector,
    private dockerCollector: IDockerCollector,
  ) {
    this.gpuEnabled = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("gpuMonitoring", true);
  }

  getLatestData(): MonitorData {
    return {
      system: this.system,
      gpuData: this.gpuData,
      containers: this.containers,
    };
  }

  getSystem(): SystemInfo {
    return this.system;
  }

  getGpuData(): GpuData {
    return this.gpuData;
  }

  getContainers(): ContainerFullInfo[] {
    return this.containers;
  }

  async refresh(): Promise<void> {
    try {
      // Collect system info and container list in parallel (fast)
      const [system, containers] = await Promise.all([
        this.systemCollector.collect(),
        this.dockerCollector.getAllRunningContainers(),
      ]);
      this.system = system;
      this.containers = containers;

      // GPU data — optional, graceful if missing
      if (this.gpuEnabled) {
        try {
          const containerNameMap = await this.dockerCollector.getContainerNames();
          const [gpus, processes, containerStats] = await Promise.all([
            this.gpuCollector.collectGpus(),
            this.gpuCollector.collectProcesses(containerNameMap),
            this.dockerCollector.getContainerStats(),
          ]);

          if (gpus.length > 0) {
            this.gpuData = {
              gpus,
              processes,
              containerStats,
              timestamp: Date.now(),
              error: "",
            };
          } else {
            this.gpuData = {
              gpus: [],
              processes: [],
              containerStats,
              timestamp: Date.now(),
              error: "",
            };
          }
        } catch (e) {
          log(`GPU collection failed: ${e}`);
          // Still get container stats for non-GPU view
          const containerStats = await this.dockerCollector.getContainerStats();
          this.gpuData = {
            gpus: [],
            processes: [],
            containerStats,
            timestamp: Date.now(),
            error: e instanceof Error ? e.message : String(e),
          };
        }
      } else {
        const containerStats = await this.dockerCollector.getContainerStats();
        this.gpuData = { gpus: [], processes: [], containerStats, timestamp: Date.now(), error: "" };
      }
    } catch (e) {
      log(`Monitor refresh error: ${e}`);
    }

    this._onDataUpdated.fire(this.getLatestData());
  }

  startAutoRefresh(): void {
    const intervalSec = vscode.workspace.getConfiguration("dockerMonitor").get<number>("refreshInterval", 10);
    this.stopAutoRefresh();
    this.refresh(); // initial
    this.refreshTimer = setInterval(() => this.refresh(), intervalSec * 1000);
    log(`Auto-refresh started (${intervalSec}s interval)`);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.dockerCollector.stopContainer(containerId);
  }

  async killContainer(containerId: string): Promise<void> {
    await this.dockerCollector.killContainer(containerId);
  }

  async killProcess(pid: number): Promise<void> {
    const { execCommand } = await import("../utils/exec");
    await execCommand(`kill -9 ${pid}`, { timeout: 5000 });
  }

  dispose(): void {
    this.stopAutoRefresh();
    this._onDataUpdated.dispose();
  }
}
