import * as vscode from "vscode";
import { SystemInfo, GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo, ServiceDefinition, ServiceStatus } from "../types";
import { fmtMem } from "../utils/format";

// ── User Color Palette ───────────────────────────────────────────

// Theme color IDs for tree item icons
const USER_THEME_COLORS = [
  "terminal.ansiCyan",
  "terminal.ansiMagenta",
  "terminal.ansiYellow",
  "terminal.ansiBlue",
  "terminal.ansiGreen",
  "terminal.ansiRed",
  "terminal.ansiWhite",
  "terminal.ansiBrightCyan",
  "terminal.ansiBrightMagenta",
  "terminal.ansiBrightYellow",
];

// Hex colors for HTML tooltips (matching the theme colors above)
const USER_HEX_COLORS = [
  "#00CCCC", // cyan
  "#CC00CC", // magenta
  "#CCCC00", // yellow
  "#5555FF", // blue
  "#00CC00", // green
  "#FF4444", // red
  "#CCCCCC", // white
  "#55FFFF", // bright cyan
  "#FF55FF", // bright magenta
  "#FFFF55", // bright yellow
];

const userColorIndex = new Map<string, number>();

function getUserIndex(username: string): number {
  if (!userColorIndex.has(username)) {
    userColorIndex.set(username, userColorIndex.size % USER_THEME_COLORS.length);
  }
  return userColorIndex.get(username)!;
}

export function getUserColor(username: string): string {
  return USER_THEME_COLORS[getUserIndex(username)];
}

export function getUserHexColor(username: string): string {
  return USER_HEX_COLORS[getUserIndex(username)];
}

export function tempColor(temp: number): string {
  if (temp > 85) return "errorForeground";
  if (temp > 75) return "editorWarning.foreground";
  if (temp > 60) return "terminal.ansiYellow";
  return "testing.iconPassed";
}

export function vramColor(pct: number): string {
  if (pct > 90) return "errorForeground";
  if (pct > 70) return "editorWarning.foreground";
  if (pct > 50) return "terminal.ansiYellow";
  return "testing.iconPassed";
}

// ── GPU Monitor Tree Items ────────────────────────────────────────

export type SidebarItem =
  | SystemItem
  | GpuItem
  | GpuDetailItem
  | VramMapItem
  | SectionItem
  | ContainerItem
  | ContainerInfoItem
  | ProcessItem
  | ProcessDetailItem
  | UserItem
  | GpuUserItem
  | OpenMonitorItem
  | ErrorItem;

export class SystemItem extends vscode.TreeItem {
  constructor(public readonly info: SystemInfo) {
    super("System", vscode.TreeItemCollapsibleState.None);
    const cpuBar = "\u2588".repeat(Math.round(info.cpuPercent / 10)) + "\u2591".repeat(10 - Math.round(info.cpuPercent / 10));
    const memPct = info.memTotalMib > 0 ? Math.round((info.memUsedMib / info.memTotalMib) * 100) : 0;
    const memBar = "\u2588".repeat(Math.round(memPct / 10)) + "\u2591".repeat(10 - Math.round(memPct / 10));
    this.description = `CPU ${cpuBar} ${info.cpuPercent}% · RAM ${memBar} ${memPct}%`;
    this.tooltip = `CPU: ${info.cpuPercent}%\nRAM: ${fmtMem(info.memUsedMib)} / ${fmtMem(info.memTotalMib)} (${memPct}%)`;
    const cpuColor =
      info.cpuPercent > 80
        ? "errorForeground"
        : info.cpuPercent > 50
          ? "editorWarning.foreground"
          : "testing.iconPassed";
    this.iconPath = new vscode.ThemeIcon("dashboard", new vscode.ThemeColor(cpuColor));
  }
}

export class GpuItem extends vscode.TreeItem {
  constructor(public readonly gpu: GpuInfo) {
    const pct = gpu.memTotal > 0 ? Math.round((gpu.memUsed / gpu.memTotal) * 100) : 0;
    const bar = "\u2588".repeat(Math.round(pct / 10)) + "\u2591".repeat(10 - Math.round(pct / 10));
    super(`GPU ${gpu.index}: ${gpu.name}`, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${bar} ${pct}% · ${gpu.temp}\u00B0C · ${gpu.util}% util`;
    this.tooltip = `GPU ${gpu.index}: ${gpu.name}\nVRAM: ${fmtMem(gpu.memUsed)} / ${fmtMem(gpu.memTotal)} (${pct}%)\nTemp: ${gpu.temp}\u00B0C\nPower: ${gpu.power.toFixed(0)}W\nUtil: ${gpu.util}%`;
    this.iconPath = new vscode.ThemeIcon("circuit-board", new vscode.ThemeColor(vramColor(pct)));
  }
}

export class GpuDetailItem extends vscode.TreeItem {
  constructor(label: string, icon: string, color?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon, color ? new vscode.ThemeColor(color) : undefined);
  }
}

export interface VramSegment {
  username: string;
  vram: number;
}

export class VramMapItem extends vscode.TreeItem {
  constructor(segments: VramSegment[], totalVram: number, freeMib: number) {
    // Build a single combined bar: filled per user + empty for free
    const barWidth = 30;
    let barStr = "";
    const legendParts: string[] = [];
    for (const seg of segments) {
      const blocks = totalVram > 0 ? Math.max(1, Math.round((seg.vram / totalVram) * barWidth)) : 0;
      barStr += "\u2588".repeat(blocks);
      legendParts.push(`${seg.username}:${fmtMem(seg.vram)}`);
    }
    const freeBlocks = Math.max(0, barWidth - barStr.length);
    barStr += "\u2591".repeat(freeBlocks);

    const usedPct = totalVram > 0 ? Math.round(((totalVram - freeMib) / totalVram) * 100) : 0;
    super(`${barStr} ${usedPct}%`, vscode.TreeItemCollapsibleState.None);
    this.description = legendParts.join(" · ");
    this.iconPath = new vscode.ThemeIcon("symbol-color-palette", new vscode.ThemeColor(vramColor(usedPct)));

    // Build HTML tooltip with real colored rectangles
    const md = new vscode.MarkdownString("", true);
    md.supportHtml = true;
    md.isTrusted = true;

    const totalBarWidth = 280; // pixels
    let html = `<div style="font-family:monospace;margin-bottom:6px"><strong>VRAM ${fmtMem(totalVram - freeMib)} / ${fmtMem(totalVram)} (${usedPct}%)</strong></div>`;
    // Outer bar container
    html += `<div style="display:flex;width:${totalBarWidth}px;height:22px;border:1px solid #666;border-radius:3px;overflow:hidden">`;
    for (const seg of segments) {
      const widthPx = totalVram > 0 ? Math.max(2, Math.round((seg.vram / totalVram) * totalBarWidth)) : 0;
      const hexColor = getUserHexColor(seg.username);
      html += `<div style="width:${widthPx}px;height:100%;background:${hexColor}" title="${seg.username}: ${fmtMem(seg.vram)}"></div>`;
    }
    // Free space
    if (freeMib > 0) {
      const freeWidthPx = totalVram > 0 ? Math.round((freeMib / totalVram) * totalBarWidth) : totalBarWidth;
      html += `<div style="width:${freeWidthPx}px;height:100%;background:#333" title="free: ${fmtMem(freeMib)}"></div>`;
    }
    html += `</div>`;

    // Legend
    html += `<div style="margin-top:6px;font-family:monospace">`;
    for (const seg of segments) {
      const hexColor = getUserHexColor(seg.username);
      const segPct = totalVram > 0 ? Math.round((seg.vram / totalVram) * 100) : 0;
      html += `<div><span style="color:${hexColor}">\u2588\u2588</span> ${seg.username}: ${fmtMem(seg.vram)} (${segPct}%)</div>`;
    }
    if (freeMib > 0) {
      const freePct = totalVram > 0 ? Math.round((freeMib / totalVram) * 100) : 0;
      html += `<div><span style="color:#555">\u2591\u2591</span> free: ${fmtMem(freeMib)} (${freePct}%)</div>`;
    }
    html += `</div>`;

    md.value = html;
    this.tooltip = md;
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

export class GpuUserItem extends vscode.TreeItem {
  constructor(
    public readonly username: string,
    public readonly gpuIndex: number,
    procCount: number,
    totalVram: number,
  ) {
    super(username, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${procCount} proc · VRAM ${fmtMem(totalVram)}`;
    const color = getUserColor(username);
    this.iconPath = new vscode.ThemeIcon("person", new vscode.ThemeColor(color));
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
