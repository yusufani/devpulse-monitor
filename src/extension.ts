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

  // ── Exec into container ────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.execContainer", async (itemOrId: ContainerItem | string, nameArg?: string) => {
      let containerId: string;
      let containerName: string;
      if (itemOrId instanceof ContainerItem) {
        containerId = itemOrId.container.id;
        containerName = itemOrId.container.name;
      } else if (typeof itemOrId === "string") {
        containerId = itemOrId;
        containerName = nameArg || itemOrId;
      } else {
        return;
      }
      const terminal = vscode.window.createTerminal(`Exec: ${containerName}`);
      terminal.sendText(`docker exec -it ${containerId} /bin/bash || docker exec -it ${containerId} /bin/sh`);
      terminal.show();
    }),
  );

  // ── Attach to container ────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.attachContainer", async (itemOrId: ContainerItem | string, nameArg?: string) => {
      let containerId: string;
      let containerName: string;
      if (itemOrId instanceof ContainerItem) {
        containerId = itemOrId.container.id;
        containerName = itemOrId.container.name;
      } else if (typeof itemOrId === "string") {
        containerId = itemOrId;
        containerName = nameArg || itemOrId;
      } else {
        return;
      }
      const terminal = vscode.window.createTerminal(`Attach: ${containerName}`);
      terminal.sendText(`docker attach ${containerId}`);
      terminal.show();
    }),
  );

  // ── Clipboard copy commands ──────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.copyContainerId", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      await vscode.env.clipboard.writeText(item.container.id);
      vscode.window.showInformationMessage(`Copied: ${item.container.id}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.copyContainerName", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      await vscode.env.clipboard.writeText(item.container.name);
      vscode.window.showInformationMessage(`Copied: ${item.container.name}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.copyContainerImage", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      await vscode.env.clipboard.writeText(item.container.image);
      vscode.window.showInformationMessage(`Copied: ${item.container.image}`);
    }),
  );

  // ── Open port in browser ──────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.openPort", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      const ports = item.container.ports;
      if (!ports) {
        vscode.window.showInformationMessage("No ports exposed.");
        return;
      }
      // Parse port mappings like "0.0.0.0:8888->8888/tcp, 0.0.0.0:6006->6006/tcp"
      const portEntries: Array<{ label: string; url: string }> = [];
      for (const chunk of ports.split(",")) {
        const match = chunk.trim().match(/(?:[\d.]+:)?(\d+)->(\d+)/);
        if (match) {
          const hostPort = match[1];
          const containerPort = match[2];
          portEntries.push({
            label: `localhost:${hostPort} -> ${containerPort}`,
            url: `http://localhost:${hostPort}`,
          });
        }
      }
      if (portEntries.length === 0) {
        vscode.window.showInformationMessage(`Ports: ${ports} (no host mappings found)`);
        return;
      }
      if (portEntries.length === 1) {
        vscode.env.openExternal(vscode.Uri.parse(portEntries[0].url));
        return;
      }
      const selected = await vscode.window.showQuickPick(
        portEntries.map((p) => ({ label: p.label, url: p.url })),
        { placeHolder: "Select port to open in browser" },
      );
      if (selected) {
        vscode.env.openExternal(vscode.Uri.parse(selected.url));
      }
    }),
  );

  // ── On-demand: Show env variables ──────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.showEnvVars", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      const inspect = await monitor.inspectContainer(item.container.id);
      if (inspect.env.length === 0) {
        vscode.window.showInformationMessage("No environment variables.");
        return;
      }
      const items = inspect.env.map((e) => {
        const [key, ...rest] = e.split("=");
        return { label: key, description: rest.join("=") };
      });
      vscode.window.showQuickPick(items, { placeHolder: `Env vars for ${item.container.name}` });
    }),
  );

  // ── On-demand: Show volume mounts ──────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.showVolumes", async (item: ContainerItem) => {
      if (!(item instanceof ContainerItem)) return;
      const inspect = await monitor.inspectContainer(item.container.id);
      if (inspect.mounts.length === 0) {
        vscode.window.showInformationMessage("No volume mounts.");
        return;
      }
      const items = inspect.mounts.map((m) => ({
        label: `${m.destination}`,
        description: `${m.source} (${m.mode})`,
      }));
      vscode.window.showQuickPick(items, { placeHolder: `Volumes for ${item.container.name}` });
    }),
  );

  // ── Quick pick: top GPU consumers ──────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.showTopConsumers", async () => {
      const data = monitor.getLatestData();
      const procs = data.gpuData.processes;
      if (procs.length === 0) {
        vscode.window.showInformationMessage("No GPU processes running.");
        return;
      }
      // Aggregate VRAM by container
      const byContainer = new Map<string, { name: string; vram: number; gpus: Set<number> }>();
      for (const p of procs) {
        const key = p.containerId || `host:${p.username}`;
        if (!byContainer.has(key)) {
          byContainer.set(key, { name: p.containerId ? p.containerName : `(host) ${p.username}`, vram: 0, gpus: new Set() });
        }
        const entry = byContainer.get(key)!;
        entry.vram += p.memMib;
        entry.gpus.add(p.gpuIndex);
      }
      const sorted = [...byContainer.values()].sort((a, b) => b.vram - a.vram);
      const items = sorted.map((c) => ({
        label: `$(package) ${c.name}`,
        description: `VRAM: ${c.vram >= 1024 ? (c.vram / 1024).toFixed(1) + " GB" : c.vram + " MB"} · GPU ${[...c.gpus].sort().join(",")}`,
      }));
      vscode.window.showQuickPick(items, { placeHolder: "Top GPU consumers (by VRAM)" });
    }),
  );

  // ── Quick pick: find container ──────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("gpuMonitor.findContainer", async () => {
      const containers = monitor.getContainers();
      if (containers.length === 0) {
        vscode.window.showInformationMessage("No containers running.");
        return;
      }
      const items = containers.map((c) => ({
        label: `$(package) ${c.name}`,
        description: `${c.ownerName}${c.composeProject ? ` · ${c.composeProject}` : ""}${c.uptime ? ` · ${c.uptime}` : ""}`,
        containerId: c.id,
        containerName: c.name,
      }));
      const selected = await vscode.window.showQuickPick(items, { placeHolder: "Select container..." });
      if (!selected) return;
      const actions = await vscode.window.showQuickPick(
        [
          { label: "$(terminal) Exec", action: "exec" },
          { label: "$(output) Logs", action: "logs" },
          { label: "$(plug) Attach", action: "attach" },
          { label: "$(debug-stop) Stop", action: "stop" },
          { label: "$(debug-restart) Restart", action: "restart" },
        ],
        { placeHolder: `Action for ${selected.containerName}` },
      );
      if (!actions) return;
      const id = selected.containerId, name = selected.containerName;
      if (actions.action === "exec") vscode.commands.executeCommand("gpuMonitor.execContainer", id, name);
      else if (actions.action === "logs") {
        const terminal = vscode.window.createTerminal(`Logs: ${name}`);
        terminal.sendText(`docker logs -f --tail 100 ${id}`);
        terminal.show();
      }
      else if (actions.action === "attach") vscode.commands.executeCommand("gpuMonitor.attachContainer", id, name);
      else if (actions.action === "stop") { await monitor.stopContainer(id); monitor.refresh(); }
      else if (actions.action === "restart") { await monitor.restartContainer(id); monitor.refresh(); }
    }),
  );

  log("Extension activated.");
}

export function deactivate(): void {
  // All subscriptions are disposed by VS Code
}
