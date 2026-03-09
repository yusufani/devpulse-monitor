import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo, SystemInfo } from "../types";
import { fmtMem } from "../utils/format";
import {
  SidebarItem,
  SystemItem,
  GpuItem,
  GpuDetailItem,
  VramMapItem,
  VramSegment,
  ContainerItem,
  ContainerInfoItem,
  ProcessItem,
  ProcessDetailItem,
  GpuUserItem,
  OpenMonitorItem,
  tempColor,
  vramColor,
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
    if (element instanceof GpuUserItem) return this.getGpuUserChildren(element);
    if (element instanceof ContainerItem) return this.getContainerChildren(element);
    if (element instanceof ProcessItem) return this.getProcessChildren(element);
    return [];
  }

  private getRootItems(): SidebarItem[] {
    const items: SidebarItem[] = [];
    items.push(new SystemItem(this.system));
    // Multi-GPU summary line
    if (this.gpus.length > 1) {
      const totalUsed = this.gpus.reduce((s, g) => s + g.memUsed, 0);
      const totalMem = this.gpus.reduce((s, g) => s + g.memTotal, 0);
      const totalPct = totalMem > 0 ? Math.round((totalUsed / totalMem) * 100) : 0;
      items.push(new GpuDetailItem(
        `Total VRAM: ${fmtMem(totalUsed)}/${fmtMem(totalMem)} (${totalPct}%) · ${this.gpus.length} GPUs`,
        "server",
        vramColor(totalPct),
      ));
    }
    for (const gpu of this.gpus) items.push(new GpuItem(gpu));
    if (this.hasGpu) items.push(new OpenMonitorItem());
    return items;
  }

  private getGpuChildren(g: GpuInfo): SidebarItem[] {
    const items: SidebarItem[] = [];

    // Group processes on this GPU by user, sorted by total VRAM descending
    const procsOnGpu = this.gpuProcesses.filter((p) => p.gpuIndex === g.index);
    const byUser = new Map<string, { vram: number; count: number }>();
    for (const p of procsOnGpu) {
      let user = p.username || "unknown";
      if (p.containerId) {
        const c = this.containers.find((c) => c.id === p.containerId);
        if (c?.ownerName) user = c.ownerName;
      }
      if (!byUser.has(user)) byUser.set(user, { vram: 0, count: 0 });
      const entry = byUser.get(user)!;
      entry.vram += p.memMib;
      entry.count++;
    }
    const sortedUsers = [...byUser.entries()].sort((a, b) => b[1].vram - a[1].vram);

    // VRAM map bar (compact, hover for colored rectangle)
    const segments: VramSegment[] = sortedUsers.map(([user, info]) => ({ username: user, vram: info.vram }));
    items.push(new VramMapItem(segments, g.memTotal, g.memFree));

    // Compact info line: temp + power + util
    items.push(new GpuDetailItem(
      `${g.temp}\u00B0C · ${g.power.toFixed(0)}W · ${g.util}% util`,
      "flame",
      tempColor(g.temp),
    ));

    // User items (expandable with their containers/processes)
    for (const [user, info] of sortedUsers) {
      items.push(new GpuUserItem(user, g.index, info.count, info.vram));
    }

    return items;
  }

  private getGpuUserChildren(el: GpuUserItem): SidebarItem[] {
    const procsOnGpu = this.gpuProcesses.filter((p) => p.gpuIndex === el.gpuIndex);
    const items: SidebarItem[] = [];
    const seen = new Set<number>();

    // Container processes: group by container
    const containerVram = new Map<string, number>();
    for (const p of procsOnGpu) {
      if (!p.containerId) continue;
      const c = this.containers.find((c) => c.id === p.containerId);
      const owner = c?.ownerName || p.username || "unknown";
      if (owner !== el.username) continue;
      containerVram.set(p.containerId, (containerVram.get(p.containerId) || 0) + p.memMib);
    }
    // Sort containers by VRAM descending
    const sortedContainers = [...containerVram.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cid] of sortedContainers) {
      const c = this.containers.find((c) => c.id === cid);
      if (!c) continue;
      const cProcs = procsOnGpu.filter((p) => p.containerId === cid);
      const vram = cProcs.reduce((s, p) => s + p.memMib, 0);
      const stats = this.containerStats.get(cid);
      items.push(new ContainerItem(c, vram, [el.gpuIndex], cProcs.length, stats));
      for (const p of cProcs) seen.add(p.pid);
    }

    // Host processes (non-container) for this user on this GPU
    const hostProcs = procsOnGpu.filter(
      (p) => !p.containerId && (p.username || "unknown") === el.username,
    );
    for (const p of hostProcs) {
      if (seen.has(p.pid)) continue;
      seen.add(p.pid);
      items.push(new ProcessItem(p));
    }

    return items;
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
