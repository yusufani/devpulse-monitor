import * as vscode from "vscode";
import { MonitorService } from "../../services/monitorService";
import { getGpuMonitorHtml, buildGpuMonitorData } from "./gpuMonitorHtml";

export class GpuMonitorPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private refreshIntervalSec = 5;
  private firstRender = true;

  constructor(
    private monitor: MonitorService,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = vscode.window.createWebviewPanel("gpuMonitor", "GPU Monitor", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.firstRender = true;
      if (this.interval) clearInterval(this.interval);
    });

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.command === "killProcess") {
          if (
            (await vscode.window.showWarningMessage(`Kill PID ${msg.pid}?`, { modal: true }, "Kill")) === "Kill"
          ) {
            await this.monitor.killProcess(msg.pid);
            this.refresh();
          }
        } else if (msg.command === "stopContainer") {
          if (
            (await vscode.window.showWarningMessage(`Stop ${msg.name}?`, { modal: true }, "Stop")) === "Stop"
          ) {
            await this.monitor.stopContainer(msg.containerId);
            this.refresh();
          }
        } else if (msg.command === "killContainer") {
          if (
            (await vscode.window.showWarningMessage(`Force kill ${msg.name}?`, { modal: true }, "Force Kill")) ===
            "Force Kill"
          ) {
            await this.monitor.killContainer(msg.containerId);
            this.refresh();
          }
        } else if (msg.command === "restartContainer") {
          if (
            (await vscode.window.showWarningMessage(`Restart ${msg.name}?`, { modal: true }, "Restart")) ===
            "Restart"
          ) {
            await this.monitor.restartContainer(msg.containerId);
            this.refresh();
          }
        } else if (msg.command === "exec") {
          vscode.commands.executeCommand("gpuMonitor.execContainer", msg.containerId, msg.name);
        } else if (msg.command === "logs") {
          const terminal = vscode.window.createTerminal(`Logs: ${msg.name}`);
          terminal.sendText(`docker logs -f --tail 100 ${msg.containerId}`);
          terminal.show();
        } else if (msg.command === "attach") {
          vscode.commands.executeCommand("gpuMonitor.attachContainer", msg.containerId, msg.name);
        } else if (msg.command === "refresh") {
          this.refresh();
        } else if (msg.command === 'exportHistory') {
          vscode.commands.executeCommand('gpuMonitor.exportHistory');
        }
      } catch (e) {
        vscode.window.showErrorMessage(`${e}`);
      }
    });

    this.firstRender = true;
    this.refresh();
    this.refreshIntervalSec = vscode.workspace
      .getConfiguration("dockerMonitor")
      .get<number>("webviewRefreshInterval", 5);
    this.interval = setInterval(() => this.refresh(), this.refreshIntervalSec * 1000);
  }

  async refresh(): Promise<void> {
    await this.monitor.refresh();
    if (!this.panel) return;

    if (this.firstRender) {
      this.panel.webview.html = getGpuMonitorHtml(
        this.monitor.getGpuData(),
        this.refreshIntervalSec,
        this.monitor.getGpuHistory(),
      );
      this.firstRender = false;
    } else {
      // Send JSON data for incremental DOM updates
      const data = buildGpuMonitorData(
        this.monitor.getGpuData(),
        this.refreshIntervalSec,
        this.monitor.getGpuHistory(),
      );
      this.panel.webview.postMessage({ type: "update", ...data });
    }
  }

  dispose(): void {
    if (this.interval) clearInterval(this.interval);
    this.panel?.dispose();
  }
}
