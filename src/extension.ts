import * as vscode from "vscode";
import { createCollectors } from "./collectors/factory";
import { MonitorService } from "./services/monitorService";
import { StatusBarController } from "./views/statusBar";
import { GpuSidebarProvider } from "./views/gpuSidebar";
import { ContainerTableViewProvider } from "./views/containerTableView";
import { GpuMonitorPanel } from "./views/webview/gpuMonitorPanel";
import { ProcessItem, ContainerItem } from "./views/treeItems";
import { getOutputChannel, log } from "./utils/logger";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = getOutputChannel();
  context.subscriptions.push(outputChannel);
  log("Extension activating...");
  log(`platform = ${process.platform}, cwd = ${process.cwd()}`);

  // ── Create collectors (platform-aware) ────────────────────────
  const collectors = await createCollectors();

  // ── MonitorService (single refresh loop) ──────────────────────
  const monitor = new MonitorService(collectors.system, collectors.gpu, collectors.docker);
  context.subscriptions.push(monitor);

  // ── Container Resources table (webview sidebar) ───────────────
  const containerTable = new ContainerTableViewProvider(monitor);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ContainerTableViewProvider.viewType, containerTable),
    containerTable,
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerServices.refresh", () => monitor.refresh()),
  );

  // ── GPU / System Monitor sidebar ──────────────────────────────
  const gpuSidebar = new GpuSidebarProvider(monitor);
  const gpuSidebarView = vscode.window.createTreeView("gpuMonitor", { treeDataProvider: gpuSidebar });
  context.subscriptions.push(gpuSidebarView, gpuSidebar);

  // ── Status bar ────────────────────────────────────────────────
  const statusBar = new StatusBarController(monitor);
  context.subscriptions.push(statusBar);

  // Start monitoring
  monitor.startAutoRefresh();

  // ── WebView panel ─────────────────────────────────────────────
  const gpuPanel = new GpuMonitorPanel(monitor);
  context.subscriptions.push(gpuPanel);

  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.show", () => gpuPanel.show()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.refresh", () => {
      monitor.refresh();
    }),
  );

  // ── Kill / Stop commands ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.killProcess", async (item: ProcessItem) => {
      if (!(item instanceof ProcessItem)) return;
      const p = item.proc;
      if (
        (await vscode.window.showWarningMessage(
          `Kill PID ${p.pid} (${p.processName}, ${p.memMib}M VRAM)?`,
          { modal: true },
          "Kill",
        )) === "Kill"
      ) {
        try {
          await monitor.killProcess(p.pid);
          vscode.window.showInformationMessage(`Killed PID ${p.pid}`);
          monitor.refresh();
        } catch (e) {
          vscode.window.showErrorMessage(`${e}`);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.stopContainer", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      if (
        (await vscode.window.showWarningMessage(`Stop container ${item.container.name}?`, { modal: true }, "Stop")) ===
        "Stop"
      ) {
        try {
          await monitor.stopContainer(item.container.id);
          vscode.window.showInformationMessage(`Stopped ${item.container.name}`);
          monitor.refresh();
        } catch (e) {
          vscode.window.showErrorMessage(`${e}`);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.killContainer", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      if (
        (await vscode.window.showWarningMessage(
          `Force kill ${item.container.name}? Data loss possible.`,
          { modal: true },
          "Force Kill",
        )) === "Force Kill"
      ) {
        try {
          await monitor.killContainer(item.container.id);
          vscode.window.showInformationMessage(`Killed ${item.container.name}`);
          monitor.refresh();
        } catch (e) {
          vscode.window.showErrorMessage(`${e}`);
        }
      }
    }),
  );

  // ── Restart container ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.restartContainer", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      if (
        (await vscode.window.showWarningMessage(
          `Restart container ${item.container.name}?`,
          { modal: true },
          "Restart",
        )) === "Restart"
      ) {
        try {
          await monitor.restartContainer(item.container.id);
          vscode.window.showInformationMessage(`Restarted ${item.container.name}`);
          monitor.refresh();
        } catch (e) {
          vscode.window.showErrorMessage(`${e}`);
        }
      }
    }),
  );

  // ── Container logs ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.showContainerLogs", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      const terminal = vscode.window.createTerminal(`Logs: ${item.container.name}`);
      terminal.sendText(`docker logs -f --tail 100 ${item.container.id}`);
      terminal.show();
    }),
  );

  log("Extension activated.");
}

export function deactivate(): void {
  // All subscriptions are disposed by VS Code
}
