import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { GpuInfo, GpuProcess, ContainerFullInfo, DiskInfo } from "../types";
import { fmtMem } from "../utils/format";
import { getUserHexColor } from "./treeItems";

interface UserVram {
  username: string;
  vram: number;
}

function getGpuUserVram(gpu: GpuInfo, processes: GpuProcess[], containers: ContainerFullInfo[]): UserVram[] {
  const byUser = new Map<string, number>();
  for (const p of processes) {
    if (p.gpuIndex !== gpu.index) continue;
    let user = p.username || "?";
    if (p.containerId) {
      const c = containers.find((c) => c.id === p.containerId);
      if (c?.ownerName) user = c.ownerName;
    }
    byUser.set(user, (byUser.get(user) || 0) + p.memMib);
  }
  return [...byUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([username, vram]) => ({ username, vram }));
}

function pctColor(pct: number): string | undefined {
  if (pct > 90) return "#FF4444";
  if (pct > 70) return "#CCCC00";
  return undefined; // default color
}

function tempColorHex(temp: number): string {
  if (temp > 85) return "#FF4444";
  if (temp > 75) return "#CCCC00";
  if (temp > 60) return "#DDDD80";
  return "#4ec9b0";
}

/** Build a terminal-style segmented bar for VRAM user breakdown */
function termBarSegmented(users: UserVram[], freeVram: number, total: number, width: number = 24): string {
  if (total <= 0) return "\u2591".repeat(width);
  let bar = "";
  let usedCols = 0;
  for (const u of users) {
    const cols = Math.max(1, Math.round((u.vram / total) * width));
    bar += `</span><span style="color:${getUserHexColor(u.username)}">${"\u2588".repeat(Math.min(cols, width - usedCols))}`;
    usedCols += cols;
  }
  if (usedCols < width) {
    bar += `</span><span style="color:#555">${"\u2591".repeat(width - usedCols)}`;
  }
  return bar + "</span><span>";
}

function buildGpuTooltip(
  gpu: GpuInfo,
  processes: GpuProcess[],
  containers: ContainerFullInfo[],
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  const pct = gpu.memTotal > 0 ? Math.round((gpu.memUsed / gpu.memTotal) * 100) : 0;
  const users = getGpuUserVram(gpu, processes, containers);
  const vramCol = pct > 90 ? "#FF4444" : pct > 70 ? "#CCCC00" : "#4ec9b0";
  const tempCol = tempColorHex(gpu.temp);
  const utilCol = gpu.util > 90 ? "#FF4444" : gpu.util > 70 ? "#CCCC00" : "#4ec9b0";
  const barW = 24;

  let html = `<div style="font-family:monospace;white-space:pre;line-height:1.5">`;

  // Header
  html += `<strong>GPU ${gpu.index}</strong> \u00B7 ${gpu.name}\n\n`;

  // VRAM bar with user segments
  const vramBar = termBarSegmented(users, gpu.memFree, gpu.memTotal, barW);
  html += `<span style="color:#9cdcfe">VRAM</span>  <span>[${vramBar}]</span> <strong style="color:${vramCol}">${pct.toString().padStart(3)}%</strong>\n`;
  html += `<span style="color:#999">       ${fmtMem(gpu.memUsed)} / ${fmtMem(gpu.memTotal)}</span>\n\n`;

  // Util bar
  const utilBar = termBar(gpu.util, barW);
  html += `<span style="color:#9cdcfe">Util</span>  <span style="color:${utilCol}">[${utilBar}]</span> <strong style="color:${utilCol}">${gpu.util.toString().padStart(3)}%</strong>\n\n`;

  // Temp & Power inline
  html += `<span style="color:#9cdcfe">Temp</span>  <strong style="color:${tempCol}">${gpu.temp}\u00B0C</strong>    <span style="color:#9cdcfe">Power</span>  <strong>${gpu.power.toFixed(0)}W</strong>\n`;

  // User legend
  if (users.length > 0) {
    html += `\n`;
    for (const u of users) {
      const p = gpu.memTotal > 0 ? Math.round((u.vram / gpu.memTotal) * 100) : 0;
      html += `<span style="color:${getUserHexColor(u.username)}">\u2588\u2588</span> ${u.username.padEnd(12)} <span style="color:#999">${fmtMem(u.vram).padStart(8)} (${p}%)</span>\n`;
    }
    if (gpu.memFree > 0) {
      const fp = gpu.memTotal > 0 ? Math.round((gpu.memFree / gpu.memTotal) * 100) : 0;
      html += `<span style="color:#555">\u2591\u2591</span> <span style="color:#666">free${" ".repeat(9)}${fmtMem(gpu.memFree).padStart(8)} (${fp}%)</span>\n`;
    }
  }

  html += `</div>`;
  md.value = html;
  return md;
}

function fmtGib(gib: number): string {
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`;
  return `${gib.toFixed(1)} GiB`;
}

/** Terminal-style block bar: [████████░░░░░░] */
function termBar(pct: number, width: number = 20): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

function diskColorHex(pct: number): string {
  if (pct > 90) return "#FF4444";
  if (pct > 75) return "#CCCC00";
  return "#4ec9b0";
}

function buildCpuTooltip(cpuPct: number): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;
  const col = cpuPct > 80 ? "#FF4444" : cpuPct > 50 ? "#CCCC00" : "#4ec9b0";
  const barW = 200;
  let html = `<div style="font-family:monospace;min-width:220px">`;
  html += `<div style="font-size:13px;margin-bottom:6px"><strong>CPU</strong></div>`;
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>Usage</span><strong style="color:${col}">${cpuPct}%</strong></div>`;
  html += `<div style="width:${barW}px;height:10px;background:#2a2a2a;border-radius:3px;overflow:hidden">`;
  html += `<div style="width:${cpuPct}%;height:100%;background:${col};border-radius:3px"></div></div>`;
  html += `</div>`;
  md.value = html;
  return md;
}

function buildRamTooltip(memPct: number, memUsed: number, memTotal: number): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;
  const col = memPct > 80 ? "#FF4444" : memPct > 50 ? "#CCCC00" : "#4ec9b0";
  const barW = 200;
  let html = `<div style="font-family:monospace;min-width:220px">`;
  html += `<div style="font-size:13px;margin-bottom:6px"><strong>RAM</strong></div>`;
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>Usage</span><strong style="color:${col}">${memPct}%</strong></div>`;
  html += `<div style="width:${barW}px;height:10px;background:#2a2a2a;border-radius:3px;overflow:hidden">`;
  html += `<div style="width:${memPct}%;height:100%;background:${col};border-radius:3px"></div></div>`;
  html += `<div style="color:#999;font-size:11px;margin-top:2px">${fmtMem(memUsed)} / ${fmtMem(memTotal)}</div>`;
  html += `</div>`;
  md.value = html;
  return md;
}

function buildDiskTooltip(disks: DiskInfo[]): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  if (disks.length === 0) {
    md.value = `<div style="font-family:monospace">No disks detected</div>`;
    return md;
  }

  // Find longest mount label for alignment
  const labels = disks.map((d) => d.mount.length > 18 ? "..." + d.mount.slice(-15) : d.mount);
  const maxLabel = Math.max(...labels.map((l) => l.length));
  const barWidth = 24;

  let html = `<div style="font-family:monospace;white-space:pre;line-height:1.5">`;
  html += `<strong>Disks</strong>\n\n`;

  for (let i = 0; i < disks.length; i++) {
    const d = disks[i];
    const col = diskColorHex(d.usedPercent);
    const label = labels[i].padEnd(maxLabel);
    const bar = termBar(d.usedPercent, barWidth);
    const pctStr = `${d.usedPercent}%`.padStart(4);

    html += `<span style="color:#9cdcfe">${label}</span> <span style="color:${col}">[${bar}]</span> <strong style="color:${col}">${pctStr}</strong>\n`;
    html += `<span style="color:#666">${" ".repeat(maxLabel)} ${d.device}</span>\n`;
    html += `<span style="color:#999">${" ".repeat(maxLabel)} ${fmtGib(d.usedGib)} / ${fmtGib(d.totalGib)}  free ${fmtGib(d.freeGib)}</span>\n\n`;
  }

  html += `</div>`;
  md.value = html;
  return md;
}

export class StatusBarController implements vscode.Disposable {
  private gpuItems: vscode.StatusBarItem[] = [];
  private cpuItem: vscode.StatusBarItem;
  private ramItem: vscode.StatusBarItem;
  private diskItem: vscode.StatusBarItem;
  private subscription: vscode.Disposable;

  constructor(monitor: MonitorService) {
    // CPU item
    this.cpuItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -108);
    this.cpuItem.command = "gpuMonitor.refresh";
    this.cpuItem.show();

    // RAM item
    this.ramItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -109);
    this.ramItem.command = "gpuMonitor.refresh";
    this.ramItem.show();

    // Disk item
    this.diskItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -110);
    this.diskItem.command = "gpuMonitor.refresh";

    this.subscription = monitor.onDataUpdated((data) => {
      // Ensure we have the right number of GPU items
      while (this.gpuItems.length < data.gpuData.gpus.length) {
        const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100 - this.gpuItems.length);
        item.command = "gpuMonitor.show";
        item.show();
        this.gpuItems.push(item);
      }
      // Hide extras
      for (let i = data.gpuData.gpus.length; i < this.gpuItems.length; i++) {
        this.gpuItems[i].hide();
      }

      // Update each GPU item independently
      for (let i = 0; i < data.gpuData.gpus.length; i++) {
        const g = data.gpuData.gpus[i];
        const pct = g.memTotal > 0 ? Math.round((g.memUsed / g.memTotal) * 100) : 0;
        const item = this.gpuItems[i];
        item.text = `$(pulse) GPU ${g.index} ${pct}%`;
        item.color = pctColor(pct);
        item.tooltip = buildGpuTooltip(g, data.gpuData.processes, data.containers);
      }

      // CPU item
      const cpuPct = data.system.cpuPercent;
      this.cpuItem.text = `$(dashboard) CPU ${cpuPct}%`;
      this.cpuItem.color = pctColor(cpuPct);
      this.cpuItem.tooltip = buildCpuTooltip(cpuPct);

      // RAM item
      const memPct =
        data.system.memTotalMib > 0 ? Math.round((data.system.memUsedMib / data.system.memTotalMib) * 100) : 0;
      this.ramItem.text = `$(database) RAM ${memPct}%`;
      this.ramItem.color = pctColor(memPct);
      this.ramItem.tooltip = buildRamTooltip(memPct, data.system.memUsedMib, data.system.memTotalMib);

      // Disk item — show worst disk
      const disks = data.system.disks || [];
      if (disks.length > 0) {
        const worstDisk = disks.reduce((a, b) => a.usedPercent > b.usedPercent ? a : b);
        this.diskItem.text = `$(server) Disk ${worstDisk.usedPercent}%`;
        this.diskItem.color = pctColor(worstDisk.usedPercent);
        this.diskItem.tooltip = buildDiskTooltip(disks);
        this.diskItem.show();
      } else {
        this.diskItem.hide();
      }
    });
  }

  dispose(): void {
    this.subscription.dispose();
    for (const item of this.gpuItems) item.dispose();
    this.cpuItem.dispose();
    this.ramItem.dispose();
    this.diskItem.dispose();
  }
}
