import * as vscode from "vscode";
import { createCollectors } from "./collectors/factory";
import { MonitorService } from "./services/monitorService";
import { ServiceRegistry } from "./services/serviceRegistry";
import { StatusBarController } from "./views/statusBar";
import { GpuSidebarProvider } from "./views/gpuSidebar";
import { ServicesTreeProvider } from "./views/servicesSidebar";
import { GpuMonitorPanel } from "./views/webview/gpuMonitorPanel";
import { ProcessItem, ContainerItem } from "./views/treeItems";
import { ServiceDefinition } from "./types";
import { getOutputChannel, log } from "./utils/logger";

let servicesInterval: ReturnType<typeof setInterval> | undefined;

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

  // ── ServiceRegistry ───────────────────────────────────────────
  const registry = new ServiceRegistry();
  await registry.load();

  // ── Services panel ────────────────────────────────────────────
  const servicesProvider = new ServicesTreeProvider(registry);
  const servicesView = vscode.window.createTreeView("dockerServices", {
    treeDataProvider: servicesProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(servicesView);

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerServices.runService", (service: ServiceDefinition) => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
      }
      if (service.script) {
        const terminal = vscode.window.createTerminal({ name: service.label, cwd: root });
        terminal.show();
        terminal.sendText(`bash "${root}/${service.script}"`);
      } else if (service.composeName) {
        const terminal = vscode.window.createTerminal({ name: service.label, cwd: root });
        terminal.show();
        terminal.sendText(`docker compose up -d ${service.composeName}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerServices.refresh", () => servicesProvider.refresh()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("dockerServices.stopAll", () => {
      const stopEntry = registry.getServices().find((s) => s.category === "action");
      if (stopEntry) {
        vscode.commands.executeCommand("dockerServices.runService", stopEntry);
      }
    }),
  );

  servicesProvider.refresh();
  servicesInterval = setInterval(() => servicesProvider.refresh(), 30_000);

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

  // ── Cleanup ───────────────────────────────────────────────────
  context.subscriptions.push({
    dispose: () => {
      if (servicesInterval) clearInterval(servicesInterval);
    },
  });

  log("Extension activated.");
}

export function deactivate(): void {
  if (servicesInterval) {
    clearInterval(servicesInterval);
    servicesInterval = undefined;
  }
}
