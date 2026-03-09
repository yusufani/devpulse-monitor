import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { GpuInfo, GpuProcess, ContainerFullInfo } from "../types";
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

function buildVramBar(gpu: GpuInfo, processes: GpuProcess[], containers: ContainerFullInfo[], barWidth = 10): string {
  const users = getGpuUserVram(gpu, processes, containers);
  const usedBlocks = gpu.memTotal > 0 ? Math.round((gpu.memUsed / gpu.memTotal) * barWidth) : 0;
  const freeBlocks = barWidth - usedBlocks;
  const bar = "\u2588".repeat(usedBlocks) + "\u2591".repeat(freeBlocks);
  const legend = users.map((u) => `${u.username}:${fmtMem(u.vram)}`).join(" ");
  return `G${gpu.index}[${bar}]${legend ? " " + legend : ""}`;
}

function buildHtmlTooltip(
  gpus: GpuInfo[],
  processes: GpuProcess[],
  containers: ContainerFullInfo[],
  cpuPct: number,
  memPct: number,
  memUsed: number,
  memTotal: number,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString("", true);
  md.supportHtml = true;
  md.isTrusted = true;

  const barWidth = 280;
  let html = `<div style="font-family:monospace"><strong>Docker Monitor</strong></div>`;

  for (const g of gpus) {
    const pct = g.memTotal > 0 ? Math.round((g.memUsed / g.memTotal) * 100) : 0;
    const users = getGpuUserVram(g, processes, containers);

    html += `<div style="margin-top:8px;font-family:monospace">`;
    html += `<div><strong>GPU ${g.index}: ${g.name}</strong> — ${g.temp}\u00B0C · ${g.util}% util</div>`;
    html += `<div style="margin:2px 0">VRAM: ${fmtMem(g.memUsed)} / ${fmtMem(g.memTotal)} (${pct}%)</div>`;

    // Colored VRAM bar
    html += `<div style="display:flex;width:${barWidth}px;height:18px;border:1px solid #666;border-radius:3px;overflow:hidden;margin:4px 0">`;
    for (const u of users) {
      const w = g.memTotal > 0 ? Math.max(2, Math.round((u.vram / g.memTotal) * barWidth)) : 0;
      const color = getUserHexColor(u.username);
      html += `<div style="width:${w}px;height:100%;background:${color}"></div>`;
    }
    if (g.memFree > 0) {
      const fw = g.memTotal > 0 ? Math.round((g.memFree / g.memTotal) * barWidth) : barWidth;
      html += `<div style="width:${fw}px;height:100%;background:#333"></div>`;
    }
    html += `</div>`;

    // User legend
    for (const u of users) {
      const color = getUserHexColor(u.username);
      const segPct = g.memTotal > 0 ? Math.round((u.vram / g.memTotal) * 100) : 0;
      html += `<div><span style="color:${color}">\u2588\u2588</span> ${u.username}: ${fmtMem(u.vram)} (${segPct}%)</div>`;
    }
    if (g.memFree > 0) {
      const freePct = g.memTotal > 0 ? Math.round((g.memFree / g.memTotal) * 100) : 0;
      html += `<div><span style="color:#555">\u2591\u2591</span> free: ${fmtMem(g.memFree)} (${freePct}%)</div>`;
    }
    html += `</div>`;
  }

  // System info
  html += `<div style="margin-top:8px;font-family:monospace;border-top:1px solid #444;padding-top:6px">`;
  html += `CPU: ${cpuPct}% · RAM: ${fmtMem(memUsed)}/${fmtMem(memTotal)} (${memPct}%)`;
  html += `</div>`;

  md.value = html;
  return md;
}

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private subscription: vscode.Disposable;

  constructor(monitor: MonitorService) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
    this.statusBarItem.command = "gpuMonitor.refresh";
    this.statusBarItem.show();

    this.subscription = monitor.onDataUpdated((data) => {
      const parts: string[] = [];
      for (const g of data.gpuData.gpus) {
        parts.push(buildVramBar(g, data.gpuData.processes, data.containers));
      }
      const memPct =
        data.system.memTotalMib > 0 ? Math.round((data.system.memUsedMib / data.system.memTotalMib) * 100) : 0;
      parts.push(`CPU ${data.system.cpuPercent}%`);
      parts.push(`RAM ${memPct}%`);
      this.statusBarItem.text = `$(circuit-board) ${parts.join(" | ")}`;

      // HTML tooltip with colored VRAM bars
      this.statusBarItem.tooltip = buildHtmlTooltip(
        data.gpuData.gpus,
        data.gpuData.processes,
        data.containers,
        data.system.cpuPercent,
        memPct,
        data.system.memUsedMib,
        data.system.memTotalMib,
      );
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this.statusBarItem.dispose();
  }
}
