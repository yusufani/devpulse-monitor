import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo, SystemInfo } from "../types";
import { fmtMem } from "../utils/format";
import {
  SidebarItem,
  SystemItem,
  GpuItem,
  GpuDetailItem,
  SectionItem,
  ContainerItem,
  ContainerInfoItem,
  ProcessItem,
  ProcessDetailItem,
  UserItem,
  OpenMonitorItem,
} from "./treeItems";

export class GpuSidebarProvider implements vscode.TreeDataProvider<SidebarItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private system: SystemInfo = { cpuPercent: 0, memUsedMib: 0, memTotalMib: 0 };
  private gpus: GpuInfo[] = [];
  private gpuProcesses: GpuProcess[] = [];
  private containers: ContainerFullInfo[] = [];
  private containerStats = new Map<string, ContainerStats>();
  private hasGpu = false;
  private subscription: vscode.Disposable;

  constructor(monitor: MonitorService) {
    this.subscription = monitor.onDataUpdated((data) => {
      this.system = data.system;
      this.containers = data.containers;
      this.gpus = data.gpuData.gpus;
      this.gpuProcesses = data.gpuData.processes;
      this.containerStats = data.gpuData.containerStats;
      this.hasGpu = data.gpuData.gpus.length > 0;
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  getTreeItem(el: SidebarItem): vscode.TreeItem {
    return el;
  }

  getChildren(element?: SidebarItem): SidebarItem[] {
    if (!element) return this.getRootItems();
    if (element instanceof GpuItem) return this.getGpuChildren(element.gpu);
    if (element instanceof SectionItem) {
      if (element.sectionType === "containers") return this.getContainerItems();
      if (element.sectionType === "hostProcs") return this.getHostProcsItems();
    }
    if (element instanceof ContainerItem) return this.getContainerChildren(element);
    if (element instanceof UserItem) return this.getUserChildren(element);
    if (element instanceof ProcessItem) return this.getProcessChildren(element);
    return [];
  }

  private getRootItems(): SidebarItem[] {
    const items: SidebarItem[] = [];
    items.push(new SystemItem(this.system));
    for (const gpu of this.gpus) items.push(new GpuItem(gpu));
    if (this.containers.length > 0) {
      items.push(new SectionItem(`Containers (${this.containers.length})`, "containers"));
    }
    const hostProcs = this.gpuProcesses.filter((p) => !p.containerId);
    if (hostProcs.length > 0) {
      items.push(new SectionItem(`Host GPU Processes (${hostProcs.length})`, "hostProcs"));
    }
    if (this.hasGpu) items.push(new OpenMonitorItem());
    return items;
  }

  private getGpuChildren(g: GpuInfo): SidebarItem[] {
    const pct = g.memTotal > 0 ? Math.round((g.memUsed / g.memTotal) * 100) : 0;
    const tempColor =
      g.temp > 80 ? "errorForeground" : g.temp > 65 ? "editorWarning.foreground" : "testing.iconPassed";
    return [
      new GpuDetailItem(
        `VRAM: ${fmtMem(g.memUsed)} / ${fmtMem(g.memTotal)} (${pct}%)`,
        "database",
        pct > 90 ? "errorForeground" : pct > 70 ? "editorWarning.foreground" : "testing.iconPassed",
      ),
      new GpuDetailItem(`Temp: ${g.temp}\u00B0C`, "flame", tempColor),
      new GpuDetailItem(`Power: ${g.power.toFixed(0)}W`, "zap"),
      new GpuDetailItem(`Free: ${fmtMem(g.memFree)}`, "arrow-down"),
    ];
  }

  private getContainerItems(): SidebarItem[] {
    const gpuByContainer = new Map<string, { vram: number; gpus: Set<number>; procs: GpuProcess[] }>();
    for (const p of this.gpuProcesses) {
      if (!p.containerId) continue;
      if (!gpuByContainer.has(p.containerId))
        gpuByContainer.set(p.containerId, { vram: 0, gpus: new Set(), procs: [] });
      const entry = gpuByContainer.get(p.containerId)!;
      entry.vram += p.memMib;
      entry.gpus.add(p.gpuIndex);
      entry.procs.push(p);
    }

    const sorted = [...this.containers].sort((a, b) => {
      const aGpu = gpuByContainer.get(a.id)?.vram || 0;
      const bGpu = gpuByContainer.get(b.id)?.vram || 0;
      if (aGpu !== bGpu) return bGpu - aGpu;
      const aRam = this.containerStats.get(a.id)?.memUsedMib || 0;
      const bRam = this.containerStats.get(b.id)?.memUsedMib || 0;
      return bRam - aRam;
    });

    return sorted.map((c) => {
      const gpuInfo = gpuByContainer.get(c.id);
      const vram = gpuInfo?.vram || 0;
      const indices = gpuInfo ? [...gpuInfo.gpus].sort() : [];
      const procCount = gpuInfo?.procs.length || 0;
      const stats = this.containerStats.get(c.id);
      return new ContainerItem(c, vram, indices, procCount, stats);
    });
  }

  private getContainerChildren(el: ContainerItem): SidebarItem[] {
    const items: SidebarItem[] = [];
    items.push(new ContainerInfoItem(`Owner: ${el.container.ownerName}`, "person"));
    if (el.gpuIndices.length > 0) {
      items.push(new ContainerInfoItem(`GPU: ${el.gpuIndices.join(", ")}`, "pulse"));
    }
    const stats = this.containerStats.get(el.container.id);
    if (stats) {
      items.push(
        new ContainerInfoItem(
          `CPU: ${stats.cpuPercent.toFixed(1)}% · RAM: ${fmtMem(stats.memUsedMib)}/${fmtMem(stats.memLimitMib)}`,
          "dashboard",
        ),
      );
    }
    const procs = this.gpuProcesses.filter((p) => p.containerId === el.container.id);
    const seen = new Set<number>();
    for (const p of procs) {
      if (seen.has(p.pid)) continue;
      seen.add(p.pid);
      items.push(new ProcessItem(p));
    }
    return items;
  }

  private getHostProcsItems(): SidebarItem[] {
    const hostProcs = this.gpuProcesses.filter((p) => !p.containerId);
    const byUser = new Map<string, GpuProcess[]>();
    for (const p of hostProcs) {
      const user = p.username || "unknown";
      if (!byUser.has(user)) byUser.set(user, []);
      byUser.get(user)!.push(p);
    }
    const sorted = [...byUser.entries()].sort(
      (a, b) => b[1].reduce((s, p) => s + p.memMib, 0) - a[1].reduce((s, p) => s + p.memMib, 0),
    );
    return sorted.map(([user, procs]) => {
      const totalVram = procs.reduce((s, p) => s + p.memMib, 0);
      return new UserItem(user, procs.length, totalVram);
    });
  }

  private getUserChildren(el: UserItem): SidebarItem[] {
    const hostProcs = this.gpuProcesses.filter(
      (p) => !p.containerId && (p.username || "unknown") === el.username,
    );
    const seen = new Set<number>();
    return hostProcs
      .filter((p) => {
        if (seen.has(p.pid)) return false;
        seen.add(p.pid);
        return true;
      })
      .map((p) => new ProcessItem(p));
  }

  private getProcessChildren(el: ProcessItem): SidebarItem[] {
    const p = el.proc;
    const items: SidebarItem[] = [];
    if (p.cmdline && p.cmdline !== p.processName) {
      const cmd = p.cmdline.length > 120 ? p.cmdline.substring(0, 117) + "..." : p.cmdline;
      items.push(new ProcessDetailItem(cmd, "terminal"));
    }
    if (p.cwd && p.cwd !== "?") {
      items.push(new ProcessDetailItem(p.cwd, "folder"));
    }
    return items;
  }

  dispose(): void {
    this.subscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}
