import * as vscode from "vscode";
import * as os from "os";
import { SystemInfo, GpuData, ContainerFullInfo, ContainerInspect, MonitorData } from "../types";
import { ISystemCollector, IGpuCollector, IDockerCollector } from "../collectors/interfaces";
import { fmtMem } from "../utils/format";
import { log, logDebug } from "../utils/logger";

export class MonitorService implements vscode.Disposable {
  private _onDataUpdated = new vscode.EventEmitter<MonitorData>();
  readonly onDataUpdated = this._onDataUpdated.event;

  private system: SystemInfo = { cpuPercent: 0, memUsedMib: 0, memTotalMib: 0, disks: [] };
  private gpuData: GpuData = { gpus: [], processes: [], containerStats: new Map(), timestamp: 0, error: "" };
  private containers: ContainerFullInfo[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshing = false;
  private gpuEnabled: boolean;
  private alertFired = new Set<number>(); // GPU indices that already fired alert
  private idleAlertFired = new Set<number>(); // GPU indices that fired idle alert
  private prevContainerIds = new Set<string>(); // for death detection
  private prevContainerNames = new Map<string, string>(); // id → name
  private prevContainerOwners = new Map<string, string>(); // id → ownerName
  private leakAlertFired = new Set<number>(); // GPU indices that fired leak alert
  private gpuHistory: Array<{ timestamp: number; gpus: Array<{ index: number; memUsed: number; memTotal: number; util: number; temp: number }> }> = [];

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
    if (this.refreshing) {
      logDebug("Skipping refresh — previous cycle still running");
      return;
    }
    this.refreshing = true;
    try {
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
            // getContainerNames returns cached data from getAllRunningContainers above — no extra docker ps call
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

      // Record GPU history for charts (keep last 60 data points)
      if (this.gpuData.gpus.length > 0) {
        this.gpuHistory.push({
          timestamp: Date.now(),
          gpus: this.gpuData.gpus.map((g) => ({ index: g.index, memUsed: g.memUsed, memTotal: g.memTotal, util: g.util, temp: g.temp })),
        });
        if (this.gpuHistory.length > 60) this.gpuHistory.shift();
      }

      // Alerts (pure logic on existing data — no extra commands)
      const notificationsEnabled = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("enableNotifications", false);
      if (notificationsEnabled) {
        this.checkVramAlerts();
        this.checkContainerDeaths();
        const idleEnabled = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("idleGpuDetection", true);
        const leakEnabled = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("leakDetection", true);
        if (idleEnabled) this.checkIdleGpus();
        if (leakEnabled) this.checkVramLeaks();
      } else {
        // Still track container state so notifications work immediately when enabled
        const currentIds = new Set(this.containers.map((c) => c.id));
        const currentNames = new Map<string, string>();
        const currentOwners = new Map<string, string>();
        for (const c of this.containers) {
          currentNames.set(c.id, c.name);
          currentOwners.set(c.id, c.ownerName);
        }
        this.prevContainerIds = currentIds;
        this.prevContainerNames = currentNames;
        this.prevContainerOwners = currentOwners;
      }

      this._onDataUpdated.fire(this.getLatestData());
    } finally {
      this.refreshing = false;
    }
  }

  startAutoRefresh(): void {
    const intervalSec = vscode.workspace.getConfiguration("dockerMonitor").get<number>("refreshInterval", 30);
    this.stopAutoRefresh();
    const loop = () => {
      this.refresh().finally(() => {
        if (this.refreshTimer !== undefined) {
          this.refreshTimer = setTimeout(loop, intervalSec * 1000);
        }
      });
    };
    this.refreshTimer = setTimeout(loop, 0); // start immediately
    log(`Auto-refresh started (${intervalSec}s interval)`);
  }

  stopAutoRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async stopContainer(containerId: string): Promise<void> {
    await this.dockerCollector.stopContainer(containerId);
  }

  async killContainer(containerId: string): Promise<void> {
    await this.dockerCollector.killContainer(containerId);
  }

  async restartContainer(containerId: string): Promise<void> {
    await this.dockerCollector.restartContainer(containerId);
  }

  async killProcess(pid: number): Promise<void> {
    const { execCommand } = await import("../utils/exec");
    await execCommand(`kill -9 ${pid}`, { timeout: 5000 });
  }

  getGpuHistory(): typeof this.gpuHistory {
    return this.gpuHistory;
  }

  private checkVramAlerts(): void {
    const threshold = vscode.workspace.getConfiguration("dockerMonitor").get<number>("vramAlertThreshold", 90);
    for (const gpu of this.gpuData.gpus) {
      const pct = gpu.memTotal > 0 ? Math.round((gpu.memUsed / gpu.memTotal) * 100) : 0;
      if (pct > threshold && !this.alertFired.has(gpu.index)) {
        this.alertFired.add(gpu.index);
        vscode.window.showWarningMessage(
          `GPU ${gpu.index} VRAM ${pct}% (${fmtMem(gpu.memUsed)}/${fmtMem(gpu.memTotal)})`,
          "Open Monitor",
        ).then((action) => {
          if (action === "Open Monitor") {
            vscode.commands.executeCommand("gpuMonitor.show");
          }
        });
      } else if (pct <= Math.max(50, threshold - 5)) {
        // Reset alert when usage drops back
        this.alertFired.delete(gpu.index);
      }
    }
  }

  /** Detect containers that disappeared since last refresh */
  private checkContainerDeaths(): void {
    const currentIds = new Set(this.containers.map((c) => c.id));
    // Build current name/owner maps
    const currentNames = new Map<string, string>();
    const currentOwners = new Map<string, string>();
    for (const c of this.containers) {
      currentNames.set(c.id, c.name);
      currentOwners.set(c.id, c.ownerName);
    }

    const onlyMine = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("notifyOnlyMyContainers", true);
    const currentUser = os.userInfo().username;

    if (this.prevContainerIds.size > 0) {
      const stoppedNames: string[] = [];
      for (const prevId of this.prevContainerIds) {
        if (!currentIds.has(prevId)) {
          if (onlyMine) {
            const owner = this.prevContainerOwners.get(prevId) || "?";
            if (owner !== currentUser && owner !== "?" && owner !== "root") continue;
          }
          stoppedNames.push(this.prevContainerNames.get(prevId) || prevId);
        }
      }
      if (stoppedNames.length === 1) {
        vscode.window.showWarningMessage(
          `Container stopped: ${stoppedNames[0]}`,
          "Open Monitor",
        ).then((action) => {
          if (action === "Open Monitor") vscode.commands.executeCommand("gpuMonitor.show");
        });
      } else if (stoppedNames.length > 1) {
        vscode.window.showWarningMessage(
          `${stoppedNames.length} containers stopped: ${stoppedNames.join(", ")}`,
          "Open Monitor",
        ).then((action) => {
          if (action === "Open Monitor") vscode.commands.executeCommand("gpuMonitor.show");
        });
      }
    }
    this.prevContainerIds = currentIds;
    this.prevContainerNames = currentNames;
    this.prevContainerOwners = currentOwners;
  }

  /** On-demand inspect — only called when user explicitly requests */
  async inspectContainer(containerId: string): Promise<ContainerInspect> {
    return this.dockerCollector.inspectContainer(containerId);
  }

  /** Detect GPUs with VRAM allocated but 0% utilization */
  private checkIdleGpus(): void {
    for (const gpu of this.gpuData.gpus) {
      const pct = gpu.memTotal > 0 ? (gpu.memUsed / gpu.memTotal) * 100 : 0;
      const hasVram = pct > 10; // at least 10% VRAM used
      const isIdle = gpu.util <= 2; // ~0% utilization

      if (hasVram && isIdle && !this.idleAlertFired.has(gpu.index)) {
        // Confirm idle by checking last 3 history points
        const recentHistory = this.gpuHistory.slice(-3);
        const consistentlyIdle = recentHistory.length >= 3 && recentHistory.every((h) => {
          const g = h.gpus.find((g) => g.index === gpu.index);
          return g ? g.util <= 2 : false;
        });
        if (consistentlyIdle) {
          this.idleAlertFired.add(gpu.index);
          // Find which containers are using this GPU
          const users = this.gpuData.processes
            .filter((p) => p.gpuIndex === gpu.index && p.containerName)
            .map((p) => p.containerName);
          const uniqueUsers = [...new Set(users)].slice(0, 3).join(", ");
          vscode.window.showInformationMessage(
            `GPU ${gpu.index} idle (${fmtMem(gpu.memUsed)} VRAM allocated, 0% util)${uniqueUsers ? ` — ${uniqueUsers}` : ""}`,
          );
        }
      } else if (!isIdle || !hasVram) {
        this.idleAlertFired.delete(gpu.index);
      }
    }
  }

  /** Detect monotonically increasing VRAM — possible memory leak */
  private checkVramLeaks(): void {
    if (this.gpuHistory.length < 10) return; // need enough samples
    const recent = this.gpuHistory.slice(-10);

    for (const gpu of this.gpuData.gpus) {
      if (this.leakAlertFired.has(gpu.index)) continue;
      const pct = gpu.memTotal > 0 ? (gpu.memUsed / gpu.memTotal) * 100 : 0;
      if (pct < 50) continue; // only care if already above 50%

      const vals = recent
        .map((h) => h.gpus.find((g) => g.index === gpu.index)?.memUsed)
        .filter((v): v is number => v !== undefined);
      if (vals.length < 10) continue;

      // Check monotonic increase: each sample >= previous
      let monotonic = true;
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] < vals[i - 1]) { monotonic = false; break; }
      }
      // Must have meaningful growth (at least 5% increase over the window)
      const growth = vals[vals.length - 1] - vals[0];
      const growthPct = gpu.memTotal > 0 ? (growth / gpu.memTotal) * 100 : 0;

      if (monotonic && growthPct >= 5) {
        this.leakAlertFired.add(gpu.index);
        vscode.window.showWarningMessage(
          `GPU ${gpu.index}: VRAM growing steadily (+${fmtMem(growth)} in last ${recent.length} samples, now ${Math.round(pct)}%) — possible memory leak`,
          "Open Monitor",
        ).then((action) => {
          if (action === "Open Monitor") {
            vscode.commands.executeCommand("gpuMonitor.show");
          }
        });
      }
    }
  }

  dispose(): void {
    this.stopAutoRefresh();
    this._onDataUpdated.dispose();
  }
}
