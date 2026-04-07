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
  const barW = 240;
  const pctColor = pct > 90 ? "#FF4444" : pct > 70 ? "#CCCC00" : "#4ec9b0";
  const tempCol = tempColorHex(gpu.temp);

  let html = `<div style="font-family:monospace;min-width:260px">`;

  // Header
  html += `<div style="font-size:13px;margin-bottom:6px"><strong>GPU ${gpu.index}</strong> · ${gpu.name}</div>`;

  // Stats row
  html += `<div style="display:flex;gap:16px;margin-bottom:8px">`;
  html += `<span>VRAM <strong style="color:${pctColor}">${pct}%</strong></span>`;
  html += `<span>Util <strong>${gpu.util}%</strong></span>`;
  html += `<span>Temp <strong style="color:${tempCol}">${gpu.temp}\u00B0C</strong></span>`;
  html += `<span>Power <strong>${gpu.power.toFixed(0)}W</strong></span>`;
  html += `</div>`;

  // VRAM bar
  html += `<div style="margin-bottom:4px;color:#999;font-size:11px">${fmtMem(gpu.memUsed)} / ${fmtMem(gpu.memTotal)}</div>`;
  html += `<div style="display:flex;width:${barW}px;height:14px;border:1px solid #555;border-radius:4px;overflow:hidden;margin-bottom:8px">`;
  for (const u of users) {
    const w = gpu.memTotal > 0 ? Math.max(2, Math.round((u.vram / gpu.memTotal) * barW)) : 0;
    html += `<div style="width:${w}px;height:100%;background:${getUserHexColor(u.username)}"></div>`;
  }
  if (gpu.memFree > 0) {
    html += `<div style="flex:1;height:100%;background:#2a2a2a"></div>`;
  }
  html += `</div>`;

  // User legend
  if (users.length > 0) {
    for (const u of users) {
      const p = gpu.memTotal > 0 ? Math.round((u.vram / gpu.memTotal) * 100) : 0;
      html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">`;
      html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${getUserHexColor(u.username)}"></span>`;
      html += `<span>${u.username}</span>`;
      html += `<span style="color:#999">${fmtMem(u.vram)} (${p}%)</span>`;
      html += `</div>`;
    }
    if (gpu.memFree > 0) {
      const fp = gpu.memTotal > 0 ? Math.round((gpu.memFree / gpu.memTotal) * 100) : 0;
      html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">`;
      html += `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:#2a2a2a;border:1px solid #555"></span>`;
      html += `<span style="color:#666">free ${fmtMem(gpu.memFree)} (${fp}%)</span>`;
      html += `</div>`;
    }
  }

  html += `</div>`;
  md.value = html;
  return md;
}

function diskColor(pct: number): string {
  if (pct > 90) return "#FF4444";
  if (pct > 75) return "#CCCC00";
  return "#4ec9b0";
}

function fmtGib(gib: number): string {
  if (gib >= 1024) return `${(gib / 1024).toFixed(1)} TiB`;
  return `${gib.toFixed(1)} GiB`;
}

function buildSystemTooltip(cpuPct: number, memPct: number, memUsed: number, memTotal: number, disks: DiskInfo[]): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  const cpuCol = cpuPct > 80 ? "#FF4444" : cpuPct > 50 ? "#CCCC00" : "#4ec9b0";
  const ramCol = memPct > 80 ? "#FF4444" : memPct > 50 ? "#CCCC00" : "#4ec9b0";
  const barW = 240;

  let html = `<div style="font-family:monospace;min-width:260px">`;
  html += `<div style="font-size:13px;margin-bottom:8px"><strong>System</strong></div>`;

  // CPU bar
  html += `<div style="margin-bottom:6px">`;
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>CPU</span><strong style="color:${cpuCol}">${cpuPct}%</strong></div>`;
  html += `<div style="width:${barW}px;height:10px;background:#2a2a2a;border-radius:3px;overflow:hidden">`;
  html += `<div style="width:${cpuPct}%;height:100%;background:${cpuCol};border-radius:3px"></div></div></div>`;

  // RAM bar
  html += `<div style="margin-bottom:6px">`;
  html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>RAM</span><strong style="color:${ramCol}">${memPct}%</strong></div>`;
  html += `<div style="width:${barW}px;height:10px;background:#2a2a2a;border-radius:3px;overflow:hidden">`;
  html += `<div style="width:${memPct}%;height:100%;background:${ramCol};border-radius:3px"></div></div>`;
  html += `<div style="color:#999;font-size:11px;margin-top:2px">${fmtMem(memUsed)} / ${fmtMem(memTotal)}</div></div>`;

  // Disk bars
  if (disks.length > 0) {
    html += `<div style="border-top:1px solid #444;margin-top:8px;padding-top:8px">`;
    html += `<div style="font-size:12px;margin-bottom:6px"><strong>Disks</strong></div>`;
    for (const d of disks) {
      const col = diskColor(d.usedPercent);
      const label = d.mount.length > 20 ? "..." + d.mount.slice(-17) : d.mount;
      html += `<div style="margin-bottom:6px">`;
      html += `<div style="display:flex;justify-content:space-between;margin-bottom:2px">`;
      html += `<span style="font-size:11px" title="${d.device} → ${d.mount}">${label}</span>`;
      html += `<strong style="color:${col};font-size:11px">${d.usedPercent}%</strong></div>`;
      html += `<div style="width:${barW}px;height:8px;background:#2a2a2a;border-radius:3px;overflow:hidden">`;
      html += `<div style="width:${d.usedPercent}%;height:100%;background:${col};border-radius:3px"></div></div>`;
      html += `<div style="color:#999;font-size:10px;margin-top:1px">${d.device} · ${fmtGib(d.usedGib)} / ${fmtGib(d.totalGib)} · free ${fmtGib(d.freeGib)}</div>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  md.value = html;
  return md;
}

export class StatusBarController implements vscode.Disposable {
  private gpuItems: vscode.StatusBarItem[] = [];
  private sysItem: vscode.StatusBarItem;
  private subscription: vscode.Disposable;

  constructor(monitor: MonitorService) {
    // System item (rightmost, lowest priority)
    this.sysItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -110);
    this.sysItem.command = "gpuMonitor.refresh";
    this.sysItem.show();

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

      // Update system item
      const memPct =
        data.system.memTotalMib > 0 ? Math.round((data.system.memUsedMib / data.system.memTotalMib) * 100) : 0;
      const cpuPct = data.system.cpuPercent;
      const disks = data.system.disks || [];
      // Show worst (most-used) disk in status bar
      const worstDisk = disks.length > 0 ? disks.reduce((a, b) => a.usedPercent > b.usedPercent ? a : b) : null;
      const diskStr = worstDisk ? ` $(server) Disk ${worstDisk.usedPercent}%` : "";
      this.sysItem.text = `$(dashboard) CPU ${cpuPct}% $(database) RAM ${memPct}%${diskStr}`;
      // Color based on worst metric
      const worstSys = Math.max(cpuPct, memPct, worstDisk?.usedPercent ?? 0);
      this.sysItem.color = pctColor(worstSys);
      this.sysItem.tooltip = buildSystemTooltip(cpuPct, memPct, data.system.memUsedMib, data.system.memTotalMib, disks);
    });
  }

  dispose(): void {
    this.subscription.dispose();
    for (const item of this.gpuItems) item.dispose();
    this.sysItem.dispose();
  }
}
