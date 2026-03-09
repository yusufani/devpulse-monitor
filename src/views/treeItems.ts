import * as vscode from "vscode";
import { SystemInfo, GpuInfo, GpuProcess, ContainerStats, ContainerFullInfo } from "../types";
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
    super(`GPU ${gpu.index}`, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${gpu.name} · ${fmtMem(gpu.memUsed)}/${fmtMem(gpu.memTotal)} · ${gpu.temp}\u00B0C`;
    this.iconPath = new vscode.ThemeIcon("circuit-board", new vscode.ThemeColor(vramColor(pct)));

    const md = new vscode.MarkdownString("", true);
    md.supportHtml = true;
    md.isTrusted = true;
    md.value = `<div style="font-family:monospace"><strong>GPU ${gpu.index}: ${gpu.name}</strong><br>` +
      `VRAM: ${fmtMem(gpu.memUsed)} / ${fmtMem(gpu.memTotal)} (${pct}%)<br>` +
      `Temp: ${gpu.temp}\u00B0C · Power: ${gpu.power.toFixed(0)}W · Util: ${gpu.util}%</div>`;
    this.tooltip = md;
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

export function buildVramTooltip(segments: VramSegment[], totalVram: number, freeMib: number): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  const usedPct = totalVram > 0 ? Math.round(((totalVram - freeMib) / totalVram) * 100) : 0;
  const barPx = 260;
  let html = `<div style="font-family:monospace"><strong>VRAM ${fmtMem(totalVram - freeMib)} / ${fmtMem(totalVram)} (${usedPct}%)</strong>`;
  html += `<div style="display:flex;width:${barPx}px;height:16px;border:1px solid #666;border-radius:3px;overflow:hidden;margin:4px 0">`;
  for (const seg of segments) {
    const w = totalVram > 0 ? Math.max(2, Math.round((seg.vram / totalVram) * barPx)) : 0;
    html += `<div style="width:${w}px;height:100%;background:${getUserHexColor(seg.username)}"></div>`;
  }
  if (freeMib > 0) {
    html += `<div style="flex:1;height:100%;background:#333"></div>`;
  }
  html += `</div>`;
  for (const seg of segments) {
    const p = totalVram > 0 ? Math.round((seg.vram / totalVram) * 100) : 0;
    html += `<div><span style="color:${getUserHexColor(seg.username)}">\u25A0</span> ${seg.username} ${fmtMem(seg.vram)} (${p}%)</div>`;
  }
  if (freeMib > 0) {
    const p = totalVram > 0 ? Math.round((freeMib / totalVram) * 100) : 0;
    html += `<div><span style="color:#555">\u25A1</span> free ${fmtMem(freeMib)} (${p}%)</div>`;
  }
  html += `</div>`;
  md.value = html;
  return md;
}

export class VramMapItem extends vscode.TreeItem {
  constructor(segments: VramSegment[], totalVram: number, freeMib: number) {
    const barW = 15;
    const usedPct = totalVram > 0 ? Math.round(((totalVram - freeMib) / totalVram) * 100) : 0;
    const usedBlocks = Math.round((usedPct / 100) * barW);
    const bar = "\u2588".repeat(usedBlocks) + "\u2591".repeat(barW - usedBlocks);
    const legend = segments.map((s) => `${s.username}:${fmtMem(s.vram)}`).join(" ");
    super(`${bar}`, vscode.TreeItemCollapsibleState.None);
    this.description = `${usedPct}% ${legend}`;
    this.iconPath = new vscode.ThemeIcon("graph", new vscode.ThemeColor(vramColor(usedPct)));
    this.tooltip = buildVramTooltip(segments, totalVram, freeMib);
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

