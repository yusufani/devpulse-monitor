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
  SectionItem,
  ContainerItem,
  ContainerInfoItem,
  ProcessItem,
  ProcessDetailItem,
  UserItem,
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
    if (element instanceof SectionItem) {
      if (element.sectionType === "containers") return this.getContainerItems();
      if (element.sectionType === "hostProcs") return this.getHostProcsItems();
    }
    if (element instanceof GpuUserItem) return this.getGpuUserChildren(element);
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

    // VRAM map: single bar with colored segments per user
    if (sortedUsers.length > 0 || g.memTotal > 0) {
      const segments: VramSegment[] = sortedUsers.map(([user, info]) => ({ username: user, vram: info.vram }));
      items.push(new VramMapItem(segments, g.memTotal, g.memFree));
    }

    // GPU details with colored icons
    items.push(
      new GpuDetailItem(
        `VRAM: ${fmtMem(g.memUsed)} / ${fmtMem(g.memTotal)} (${pct}%)`,
        "database",
        vramColor(pct),
      ),
    );
    items.push(new GpuDetailItem(`Temp: ${g.temp}\u00B0C`, "flame", tempColor(g.temp)));
    items.push(new GpuDetailItem(`Power: ${g.power.toFixed(0)}W`, "zap", "terminal.ansiYellow"));

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
