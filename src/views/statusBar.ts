import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { fmtMem } from "../utils/format";

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private subscription: vscode.Disposable;

  constructor(monitor: MonitorService) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
    this.statusBarItem.command = "gpuMonitor.refresh";
    this.statusBarItem.tooltip = "Docker Monitor — click to refresh";
    this.statusBarItem.show();

    this.subscription = monitor.onDataUpdated((data) => {
      const parts: string[] = [];
      for (const g of data.gpuData.gpus) {
        parts.push(`G${g.index}:${g.util}% ${fmtMem(g.memUsed)}/${fmtMem(g.memTotal)}`);
      }
      const memPct =
        data.system.memTotalMib > 0 ? Math.round((data.system.memUsedMib / data.system.memTotalMib) * 100) : 0;
      parts.push(`CPU ${data.system.cpuPercent}%`);
      parts.push(`RAM ${memPct}%`);
      this.statusBarItem.text = `$(pulse) ${parts.join(" | ")}`;
    });
  }

  dispose(): void {
    this.subscription.dispose();
    this.statusBarItem.dispose();
  }
}
