import * as vscode from "vscode";
import { SystemInfo, GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo, ServiceDefinition, ServiceStatus } from "../types";
import { fmtMem } from "../utils/format";

// ── GPU Monitor Tree Items ────────────────────────────────────────

export type SidebarItem =
  | SystemItem
  | GpuItem
  | GpuDetailItem
  | SectionItem
  | ContainerItem
  | ContainerInfoItem
  | ProcessItem
  | ProcessDetailItem
  | UserItem
  | OpenMonitorItem
  | ErrorItem;

export class SystemItem extends vscode.TreeItem {
  constructor(public readonly info: SystemInfo) {
    super("System", vscode.TreeItemCollapsibleState.None);
    const memPct = info.memTotalMib > 0 ? Math.round((info.memUsedMib / info.memTotalMib) * 100) : 0;
    this.description = `CPU ${info.cpuPercent}% · RAM ${fmtMem(info.memUsedMib)}/${fmtMem(info.memTotalMib)} (${memPct}%)`;
    const cpuColor =
      info.cpuPercent > 80
        ? "errorForeground"
        : info.cpuPercent > 50
          ? "editorWarning.foreground"
          : "testing.iconPassed";
    this.iconPath = new vscode.ThemeIcon("server", new vscode.ThemeColor(cpuColor));
  }
}

export class GpuItem extends vscode.TreeItem {
  constructor(public readonly gpu: GpuInfo) {
    const pct = gpu.memTotal > 0 ? Math.round((gpu.memUsed / gpu.memTotal) * 100) : 0;
    const bar = "\u2588".repeat(Math.round(pct / 10)) + "\u2591".repeat(10 - Math.round(pct / 10));
    super(`GPU ${gpu.index}: ${gpu.name}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${bar} ${pct}% · ${gpu.util}% util`;
    const severity =
      gpu.util > 80 || pct > 90
        ? "errorForeground"
        : gpu.util > 30 || pct > 50
          ? "editorWarning.foreground"
          : "testing.iconPassed";
    this.iconPath = new vscode.ThemeIcon("pulse", new vscode.ThemeColor(severity));
  }
}

export class GpuDetailItem extends vscode.TreeItem {
  constructor(label: string, icon: string, color?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
  }
}

export class SectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly sectionType: "containers" | "hostProcs",
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon(sectionType === "containers" ? "server-process" : "person");
  }
}

export class ContainerItem extends vscode.TreeItem {
  constructor(
    public readonly container: ContainerFullInfo,
    public readonly gpuVram: number,
    public readonly gpuIndices: number[],
    public readonly gpuProcCount: number,
    stats?: ContainerStats,
  ) {
    super(
      container.name,
      gpuProcCount > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    const parts: string[] = [];
    if (gpuVram > 0) parts.push(`VRAM ${fmtMem(gpuVram)}`);
    if (stats) {
      parts.push(`CPU ${stats.cpuPercent.toFixed(1)}%`);
      parts.push(`RAM ${fmtMem(stats.memUsedMib)}`);
    }
    if (gpuIndices.length > 0) parts.push(`GPU ${gpuIndices.join(",")}`);
    this.description = parts.join(" · ") || "starting...";
    const hasGpu = gpuVram > 0;
    this.iconPath = new vscode.ThemeIcon(
      "package",
      hasGpu ? new vscode.ThemeColor("terminal.ansiCyan") : new vscode.ThemeColor("terminal.ansiGreen"),
    );
    this.contextValue = "gpuContainer";
    this.tooltip = `${container.name}\nOwner: ${container.ownerName}\n${parts.join("\n")}`;
  }
}

export class ContainerInfoItem extends vscode.TreeItem {
  constructor(label: string, icon: string = "info") {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class ProcessItem extends vscode.TreeItem {
  constructor(public readonly proc: GpuProcess) {
    super(proc.processName, vscode.TreeItemCollapsibleState.Collapsed);
    const parts = [`PID ${proc.pid}`, `VRAM ${fmtMem(proc.memMib)}`, `G${proc.gpuIndex}`];
    if (proc.ramMib > 0) parts.push(`RAM ${fmtMem(proc.ramMib)}`);
    this.description = parts.join(" · ");
    this.iconPath = new vscode.ThemeIcon("symbol-method");
    this.contextValue = "gpuProcess";
    this.tooltip = `${proc.processName}\n${parts.join("\n")}\nUser: ${proc.username}`;
  }
}

export class ProcessDetailItem extends vscode.TreeItem {
  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class UserItem extends vscode.TreeItem {
  constructor(
    public readonly username: string,
    procCount: number,
    totalVram: number,
  ) {
    super(username, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${procCount} proc · VRAM ${fmtMem(totalVram)}`;
    this.iconPath = new vscode.ThemeIcon("person");
  }
}

export class OpenMonitorItem extends vscode.TreeItem {
  constructor() {
    super("Open Full GPU Monitor", vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("window");
    this.command = { command: "gpuMonitor.show", title: "Open GPU Monitor" };
  }
}

export class ErrorItem extends vscode.TreeItem {
  constructor(msg: string) {
    super(msg, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("warning");
  }
}

// ── Services Tree Items ───────────────────────────────────────────

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly categoryId: string,
    label: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "category";
  }
}

export class ServiceItem extends vscode.TreeItem {
  constructor(
    public readonly service: ServiceDefinition,
    status: ServiceStatus | undefined,
  ) {
    super(service.label, vscode.TreeItemCollapsibleState.None);
    this.description = service.description;
    this.tooltip = `${service.label} — ${service.description || ""}\n${service.script ? `Script: ${service.script}` : ""}`;

    if (service.category === "action") {
      this.iconPath = new vscode.ThemeIcon("stop-circle", new vscode.ThemeColor("errorForeground"));
    } else if (service.category === "popular") {
      this.iconPath = new vscode.ThemeIcon(
        "star-full",
        status === "running"
          ? new vscode.ThemeColor("testing.iconPassed")
          : new vscode.ThemeColor("editorWarning.foreground"),
      );
    } else if (status === "running") {
      this.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("testing.iconPassed"));
    } else {
      this.iconPath = new vscode.ThemeIcon("circle-outline");
    }

    this.command = {
      command: "dockerServices.runService",
      title: "Run Service",
      arguments: [service],
    };
    this.contextValue = "service";
  }
}
