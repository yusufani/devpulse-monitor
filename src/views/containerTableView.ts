import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { MonitorData } from "../types";

interface ContainerRow {
  id: string;
  name: string;
  owner: string;
  health: string;
  composeProject: string;
  uptime: string;
  image: string;
  ports: string;
  vram: number;
  gpuIdx: string;
  gpuBreakdown: Array<{ gpuIndex: number; vram: number }>;
  gpuUtil: number;
  cpuPct: number;
  ramMib: number;
  ramLimitMib: number;
  ramPct: number;
  netIO: string;
  blockIO: string;
  hasStats: boolean;
  hasGpu: boolean;
}

export class ContainerTableViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "dockerServices";
  private _view?: vscode.WebviewView;
  private _subscription: vscode.Disposable;
  private _firstRender = true;

  constructor(private readonly monitor: MonitorService) {
    this._subscription = monitor.onDataUpdated(() => {
      this._updateView();
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "exec") {
        vscode.commands.executeCommand("gpuMonitor.execContainer", msg.containerId, msg.name);
      } else if (msg.command === "logs") {
        const terminal = vscode.window.createTerminal(`Logs: ${msg.name}`);
        terminal.sendText(`docker logs -f --tail 100 ${msg.containerId}`);
        terminal.show();
      } else if (msg.command === "attach") {
        vscode.commands.executeCommand("gpuMonitor.attachContainer", msg.containerId, msg.name);
      } else if (msg.command === "toggleNotifications") {
        const config = vscode.workspace.getConfiguration("dockerMonitor");
        const current = config.get<boolean>("enableNotifications", false);
        await config.update("enableNotifications", !current, vscode.ConfigurationTarget.Global);
        webviewView.webview.postMessage({ type: "notificationsState", enabled: !current });
      } else if (msg.command === "inspect") {
        try {
          const inspect = await this.monitor.inspectContainer(msg.containerId);
          webviewView.webview.postMessage({ type: "inspectResult", containerId: msg.containerId, data: inspect });
        } catch {
          webviewView.webview.postMessage({ type: "inspectResult", containerId: msg.containerId, data: { env: [], mounts: [] } });
        }
      } else if (msg.command === "bulkStop") {
        const ids: string[] = msg.containerIds || [];
        for (const id of ids) {
          try { await this.monitor.stopContainer(id); } catch { /* skip failed */ }
        }
        this.monitor.refresh();
      } else if (msg.command === "bulkRestart") {
        const ids: string[] = msg.containerIds || [];
        for (const id of ids) {
          try { await this.monitor.restartContainer(id); } catch { /* skip failed */ }
        }
        this.monitor.refresh();
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._firstRender = true;
        this._updateView();
      }
    });

    this._firstRender = true;
    this._updateView();
  }

  private _updateView(): void {
    if (!this._view) return;
    const rows = this._buildRows();
    const data: MonitorData = this.monitor.getLatestData();
    const gpuIndices = data.gpuData.gpus.map((g) => g.index).sort((a, b) => a - b);

    if (this._firstRender) {
      this._view.webview.html = this._buildHtml(rows, gpuIndices);
      this._firstRender = false;
    } else {
      // Incremental update via postMessage for smooth transitions
      this._view.webview.postMessage({
        type: "update",
        rows: JSON.parse(JSON.stringify(rows)),
        gpuIndices,
      });
    }
  }

  private _buildRows(): ContainerRow[] {
    const data: MonitorData = this.monitor.getLatestData();
    const containers = data.containers;
    const gpuProcesses = data.gpuData.processes;
    const containerStats = data.gpuData.containerStats;
    const gpus = data.gpuData.gpus;

    // Build per-GPU utilization map
    const gpuUtilMap = new Map<number, number>();
    for (const g of gpus) {
      gpuUtilMap.set(g.index, g.util);
    }

    const gpuByContainer = new Map<string, { vram: number; gpus: Set<number>; perGpu: Map<number, number>; vramByGpu: Map<number, number> }>();
    for (const p of gpuProcesses) {
      if (!p.containerId) continue;
      if (!gpuByContainer.has(p.containerId)) {
        gpuByContainer.set(p.containerId, { vram: 0, gpus: new Set(), perGpu: new Map(), vramByGpu: new Map() });
      }
      const entry = gpuByContainer.get(p.containerId)!;
      entry.vram += p.memMib;
      entry.gpus.add(p.gpuIndex);
      entry.vramByGpu.set(p.gpuIndex, (entry.vramByGpu.get(p.gpuIndex) || 0) + p.memMib);
    }

    return containers.map((c) => {
      const gpu = gpuByContainer.get(c.id);
      const stats = containerStats.get(c.id);

      // Build per-GPU VRAM breakdown
      const gpuBreakdown: Array<{ gpuIndex: number; vram: number }> = [];
      if (gpu) {
        for (const [gpuIndex, vram] of gpu.vramByGpu) {
          gpuBreakdown.push({ gpuIndex, vram });
        }
        gpuBreakdown.sort((a, b) => a.gpuIndex - b.gpuIndex);
      }

      // Weighted GPU util%: average util of GPUs this container uses
      let gpuUtil = 0;
      if (gpu && gpu.gpus.size > 0) {
        let totalUtil = 0;
        for (const gi of gpu.gpus) {
          totalUtil += gpuUtilMap.get(gi) || 0;
        }
        gpuUtil = totalUtil / gpu.gpus.size;
      }

      return {
        id: c.id,
        name: c.name,
        owner: c.ownerName,
        health: c.health,
        composeProject: c.composeProject,
        uptime: c.uptime,
        image: c.image,
        ports: c.ports,
        vram: gpu?.vram || 0,
        gpuIdx: gpu ? [...gpu.gpus].sort().join(",") : "",
        gpuBreakdown,
        gpuUtil,
        cpuPct: stats?.cpuPercent ?? 0,
        ramMib: stats?.memUsedMib ?? 0,
        ramLimitMib: stats?.memLimitMib ?? 0,
        ramPct: stats?.memPercent ?? 0,
        netIO: stats?.netIO ?? "",
        blockIO: stats?.blockIO ?? "",
        hasStats: !!stats,
        hasGpu: (gpu?.vram || 0) > 0,
      };
    });
  }

  private _buildHtml(rows: ContainerRow[], gpuIndices: number[]): string {
    const jsonData = JSON.stringify(rows);
    const gpuIndicesJson = JSON.stringify(gpuIndices);
    const notificationsEnabled = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("enableNotifications", false);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, monospace);
    font-size: var(--vscode-font-size, 12px);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 6px;
    font-size: 10px;
    opacity: 0.6;
    border-bottom: 1px solid var(--vscode-widget-border, #333);
    gap: 6px;
  }
  .search-input {
    background: var(--vscode-input-background, #1e1e1e);
    border: 1px solid var(--vscode-input-border, #555);
    color: var(--vscode-input-foreground, #ccc);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: inherit;
    width: 140px;
    outline: none;
  }
  .search-input:focus {
    border-color: var(--vscode-focusBorder, #007fd4);
  }
  .search-input::placeholder {
    color: var(--vscode-input-placeholderForeground, #888);
  }
  .toolbar button {
    background: none;
    border: 1px solid var(--vscode-widget-border, #555);
    color: var(--vscode-foreground);
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.7;
  }
  .toolbar button:hover { opacity: 1; }
  .toolbar button.active {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    opacity: 1;
    border-color: var(--vscode-button-background, #0e639c);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    opacity: 0.6;
    white-space: nowrap;
    position: sticky;
    top: 0;
    background: var(--vscode-sideBar-background, #1e1e1e);
    cursor: pointer;
    user-select: none;
  }
  th:hover { opacity: 1; }
  th .arrow { font-size: 8px; margin-left: 2px; }
  td {
    padding: 3px 6px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.05));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.3s, background 0.3s;
  }
  td.name {
    max-width: 140px;
    font-weight: 500;
  }
  td.owner-cell {
    max-width: 80px;
    opacity: 0.7;
    font-size: 10px;
  }
  tr:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }
  tr { transition: opacity 0.3s ease; }
  tr.fade-in { animation: fadeIn 0.3s ease forwards; }
  tr.fade-out { animation: fadeOut 0.3s ease forwards; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; height: 0; } }
  .red { color: var(--vscode-errorForeground, #f44); }
  .yellow { color: var(--vscode-editorWarning-foreground, #cc0); }
  .cyan { color: #4ec9b0; }
  .dim { opacity: 0.4; }
  .empty {
    text-align: center;
    padding: 20px;
    opacity: 0.5;
  }
  .changed { animation: pulse 0.6s ease; }
  @keyframes pulse { 0% { background: rgba(78,201,176,0.15); } 100% { background: transparent; } }
  /* grouped view */
  .group-header {
    background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
    font-weight: 600;
    font-size: 11px;
  }
  .group-header td {
    padding: 5px 6px;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
    cursor: pointer;
    user-select: none;
  }
  .group-header .toggle { opacity: 0.5; margin-right: 4px; font-size: 9px; }
  .group-summary { opacity: 0.6; font-weight: normal; font-size: 10px; }
  /* context menu */
  .ctx-menu {
    position: fixed;
    background: var(--vscode-menu-background, #252526);
    border: 1px solid var(--vscode-menu-border, #454545);
    border-radius: 4px;
    padding: 4px 0;
    min-width: 140px;
    z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    font-size: 11px;
  }
  .ctx-menu-item {
    padding: 4px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--vscode-menu-foreground, #ccc);
  }
  .ctx-menu-item:hover {
    background: var(--vscode-menu-selectionBackground, #094771);
    color: var(--vscode-menu-selectionForeground, #fff);
  }
  .ctx-menu-sep {
    height: 1px;
    background: var(--vscode-menu-separatorBackground, #454545);
    margin: 4px 0;
  }
  /* GPU util bar */
  .util-bar {
    display: inline-block;
    width: 30px;
    height: 8px;
    background: #333;
    border-radius: 2px;
    overflow: hidden;
    vertical-align: middle;
    margin-right: 3px;
  }
  .util-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  }
  .util-bar-fill.green { background: #4ec9b0; }
  .util-bar-fill.yellow { background: #dcdcaa; }
  .util-bar-fill.red { background: #f44747; }
  /* health & metadata badges */
  .health-ok, .health-bad, .health-wait { font-size: 9px; vertical-align: middle; }
  .compose-tag {
    display: inline-block;
    font-size: 8px;
    padding: 0 3px;
    margin-left: 4px;
    border-radius: 2px;
    background: var(--vscode-badge-background, #4d4d4d);
    color: var(--vscode-badge-foreground, #ccc);
    vertical-align: middle;
  }
  .uptime {
    display: inline-block;
    font-size: 8px;
    opacity: 0.4;
    margin-left: 4px;
    vertical-align: middle;
  }
  .image-tag {
    display: inline-block;
    font-size: 8px;
    opacity: 0.35;
    margin-left: 4px;
    vertical-align: middle;
  }
  .io-cell {
    font-size: 10px;
    max-width: 90px;
  }
  /* multi-select */
  .sel-cell {
    width: 20px;
    padding: 2px 4px;
    text-align: center;
  }
  input[type="checkbox"].row-check {
    cursor: pointer;
    accent-color: var(--vscode-focusBorder, #007fd4);
    width: 12px;
    height: 12px;
  }
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    background: var(--vscode-editor-selectionBackground, rgba(0,122,204,0.15));
    border-bottom: 1px solid var(--vscode-focusBorder, #007fd4);
    font-size: 10px;
    flex-wrap: wrap;
  }
  .bulk-bar button {
    background: none;
    border: 1px solid var(--vscode-widget-border, #555);
    color: var(--vscode-foreground);
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 3px;
    cursor: pointer;
  }
  .bulk-bar button:hover { opacity: 0.8; }
  .bulk-bar .bulk-stop { border-color: var(--vscode-editorWarning-foreground, #cc0); color: var(--vscode-editorWarning-foreground, #cc0); }
  .bulk-bar .bulk-restart { border-color: #4ec9b0; color: #4ec9b0; }
  .hidden { display: none !important; }
  /* inspect dropdown panel */
  .inspect-row td {
    padding: 0;
    border-bottom: 2px solid var(--vscode-focusBorder, #007fd4);
    background: var(--vscode-sideBar-background, #1e1e1e);
  }
  .inspect-panel {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .inspect-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 600;
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .inspect-header .inspect-name {
    color: var(--vscode-focusBorder, #007fd4);
    font-size: 11px;
    opacity: 1;
    text-transform: none;
    letter-spacing: 0;
  }
  .inspect-close {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    opacity: 0.5;
    font-size: 12px;
    padding: 0 2px;
    line-height: 1;
  }
  .inspect-close:hover { opacity: 1; }
  .inspect-search {
    background: var(--vscode-input-background, #1e1e1e);
    border: 1px solid var(--vscode-input-border, #555);
    color: var(--vscode-input-foreground, #ccc);
    font-size: 10px;
    padding: 3px 7px;
    border-radius: 3px;
    font-family: inherit;
    width: 100%;
    outline: none;
    box-sizing: border-box;
  }
  .inspect-search:focus { border-color: var(--vscode-focusBorder, #007fd4); }
  .inspect-search::placeholder { color: var(--vscode-input-placeholderForeground, #888); }
  .inspect-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--vscode-widget-border, #444);
    padding-bottom: 4px;
  }
  .inspect-tab {
    background: none;
    border: 1px solid transparent;
    color: var(--vscode-foreground);
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.6;
    font-family: inherit;
  }
  .inspect-tab:hover { opacity: 1; }
  .inspect-tab.active {
    border-color: var(--vscode-focusBorder, #007fd4);
    color: var(--vscode-focusBorder, #007fd4);
    opacity: 1;
  }
  .inspect-list {
    max-height: 180px;
    overflow-y: auto;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .inspect-list::-webkit-scrollbar { width: 4px; }
  .inspect-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
  .inspect-item {
    padding: 2px 4px;
    border-radius: 2px;
    line-height: 1.6;
    word-break: break-all;
    white-space: pre-wrap;
  }
  .inspect-item:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }
  .inspect-item .ikey { color: var(--vscode-variable-foreground, #9cdcfe); }
  .inspect-item .ival { color: var(--vscode-foreground); opacity: 0.75; }
  .inspect-item .ipath { color: #4ec9b0; }
  .inspect-item .imode { opacity: 0.4; font-size: 9px; margin-left: 4px; }
  .inspect-empty { opacity: 0.4; padding: 6px 4px; font-size: 10px; }
  .inspect-loading { opacity: 0.5; padding: 6px 4px; font-size: 10px; }
  .inspect-count { font-size: 9px; opacity: 0.4; margin-left: 4px; }
</style>
</head>
<body>
  <div class="toolbar">
    <span id="countLabel"></span>
    <div style="display:flex;align-items:center;gap:4px;">
      <input type="text" id="searchInput" class="search-input" placeholder="\uD83D\uDD0D Search containers..." />
      <button id="notifyBtn" class="${notificationsEnabled ? "active" : ""}" title="Enable automatic notifications (VRAM, container stop, idle GPU, memory leak)">\uD83D\uDD14 Alerts</button>
      <button id="groupBtn" title="Group by owner">\uD83D\uDC65 Group</button>
    </div>
  </div>
  <div id="bulkBar" class="bulk-bar hidden">
    <span id="bulkCount"></span>
    <button class="bulk-stop" id="bulkStopBtn">&#9632; Stop</button>
    <button class="bulk-restart" id="bulkRestartBtn">&#8634; Restart</button>
    <button id="clearSelBtn">&#10005; Clear</button>
  </div>
  <table>
    <thead>
      <tr id="headerRow">
        <th class="sel-cell"><input type="checkbox" id="selectAllInit"></th>
        <th data-col="name">Container <span class="arrow"></span></th>
        <th data-col="owner" id="ownerTh">Owner <span class="arrow"></span></th>
        <th data-col="vram">VRAM <span class="arrow"></span></th>
        <th data-col="gpuIdx">GPU <span class="arrow"></span></th>
        <th data-col="gpuUtil">Util% <span class="arrow"></span></th>
        <th data-col="cpuPct">CPU <span class="arrow"></span></th>
        <th data-col="ramMib">RAM <span class="arrow"></span></th>
        <th data-col="netIO">Net <span class="arrow"></span></th>
        <th data-col="blockIO">Disk <span class="arrow"></span></th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

<script>
(function() {
  const vscode = acquireVsCodeApi();
  let rows = ${jsonData};
  let gpuIndices = ${gpuIndicesJson};
  let sortCol = 'vram';
  let sortAsc = false;
  let grouped = false;
  let searchQuery = '';
  const collapsedGroups = new Set();
  let prevValues = new Map(); // track previous cell values for change detection
  let selectedIds = new Set();

  function updateBulkBar() {
    const count = selectedIds.size;
    const bar = document.getElementById('bulkBar');
    const cnt = document.getElementById('bulkCount');
    if (bar) bar.classList.toggle('hidden', count === 0);
    if (cnt) cnt.textContent = count + ' container' + (count !== 1 ? 's' : '') + ' selected';
    const sa = document.getElementById('selectAll');
    if (sa) {
      const visibleRows = document.querySelectorAll('tr[data-id]');
      sa.indeterminate = count > 0 && count < visibleRows.length;
      sa.checked = count > 0 && count === visibleRows.length;
    }
  }

  // Inspect panel state
  let openInspectId = null;
  let inspectCache = new Map(); // containerId -> { env, mounts }
  let inspectSearchQuery = '';
  let inspectTab = 'env'; // 'env' | 'mounts'

  const fmtMem = (mib) => {
    if (mib <= 0) return '\\u2014';
    if (mib >= 1024) return (mib / 1024).toFixed(1) + 'G';
    if (mib >= 10) return mib.toFixed(1) + 'M';
    return mib.toFixed(2) + 'M';
  };

  function sortRows(arr) {
    const col = sortCol;
    const dir = sortAsc ? 1 : -1;
    return [...arr].sort((a, b) => {
      let av = a[col], bv = b[col];
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  function cpuCls(v) { return v > 80 ? 'red' : v > 50 ? 'yellow' : ''; }
  function utilCls(v) { return v > 80 ? 'red' : v > 50 ? 'yellow' : ''; }
  function ramCls(r) { return r.ramLimitMib > 0 && (r.ramMib / r.ramLimitMib) * 100 > 80 ? 'red' : ''; }
  function vramCls(r) { return r.hasGpu ? 'cyan' : 'dim'; }

  function healthBadge(h) {
    if (h === 'healthy') return '<span class="health-ok" title="healthy">\\u2705</span>';
    if (h === 'unhealthy') return '<span class="health-bad" title="unhealthy">\\u274C</span>';
    if (h === 'starting') return '<span class="health-wait" title="starting">\\u23F3</span>';
    return '';
  }

  function ramLabel(r) {
    if (!r.hasStats) return '\\u2014';
    let label = fmtMem(r.ramMib);
    if (r.ramLimitMib > 0) {
      label += '/' + fmtMem(r.ramLimitMib);
      const pct = (r.ramMib / r.ramLimitMib) * 100;
      if (pct > 85) label += ' \\u26A0';
    }
    return label;
  }

  function rowHtml(r, showOwner) {
    let perGpuCols = '';
    if (gpuIndices.length > 1) {
      for (const gi of gpuIndices) {
        const bd = r.gpuBreakdown.find(b => b.gpuIndex === gi);
        perGpuCols += '<td class="' + (bd && bd.vram > 0 ? 'cyan' : 'dim') + '">' + (bd && bd.vram > 0 ? fmtMem(bd.vram) : '\\u2014') + '</td>';
      }
    }
    const utilPct = r.gpuUtil;
    const utilBarCls = utilPct > 80 ? 'red' : utilPct > 50 ? 'yellow' : 'green';
    const utilHtml = r.hasGpu ? '<span class="util-bar"><span class="util-bar-fill ' + utilBarCls + '" style="width:' + utilPct + '%"></span></span>' + utilPct.toFixed(0) + '%' : '\\u2014';
    const badge = healthBadge(r.health);
    const nameLabel = badge + ' ' + esc(r.name);
    const uptimeHtml = r.uptime ? '<span class="uptime">' + esc(r.uptime) + '</span>' : '';
    const composeHtml = r.composeProject ? '<span class="compose-tag">' + esc(r.composeProject) + '</span>' : '';
    const imgShort = r.image ? r.image.replace(/^.*\\//, '').substring(0, 24) : '';
    const tooltip = esc(r.name) + (r.image ? '\\n' + esc(r.image) : '') + (r.ports ? '\\nPorts: ' + esc(r.ports) : '') + (r.composeProject ? '\\n[' + esc(r.composeProject) + ']' : '');
    return '<tr data-id="' + esc(r.id) + '">' +
      '<td class="sel-cell"><input type="checkbox" class="row-check" data-id="' + esc(r.id) + '"' + (selectedIds.has(r.id) ? ' checked' : '') + '></td>' +
      '<td class="name" title="' + tooltip + '">' + nameLabel + composeHtml + uptimeHtml + (imgShort ? '<span class="image-tag">' + esc(imgShort) + '</span>' : '') + '</td>' +
      (showOwner ? '<td class="owner-cell">' + esc(r.owner) + '</td>' : '') +
      '<td class="' + vramCls(r) + '">' + (r.vram > 0 ? fmtMem(r.vram) : '\\u2014') + '</td>' +
      perGpuCols +
      '<td class="' + vramCls(r) + '">' + (r.gpuIdx || '\\u2014') + '</td>' +
      '<td class="' + utilCls(utilPct) + '">' + utilHtml + '</td>' +
      '<td class="' + cpuCls(r.cpuPct) + '">' + (r.hasStats ? r.cpuPct.toFixed(1) + '%' : '\\u2014') + '</td>' +
      '<td class="' + ramCls(r) + '">' + ramLabel(r) + '</td>' +
      '<td class="io-cell dim">' + (r.netIO ? esc(r.netIO) : '\\u2014') + '</td>' +
      '<td class="io-cell dim">' + (r.blockIO ? esc(r.blockIO) : '\\u2014') + '</td>' +
      '</tr>';
  }

  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  function getTotalCols() {
    return 9 + (grouped ? 0 : 1) + (gpuIndices.length > 1 ? gpuIndices.length : 0);
  }

  function inspectRowHtml(containerId, name) {
    const data = inspectCache.get(containerId);
    const colSpan = getTotalCols();
    let content = '';
    if (!data) {
      content = '<div class="inspect-loading">\\u23F3 Inspect verisi y\\u00FCkleniyor...</div>';
    } else {
      const q = inspectSearchQuery.toLowerCase();
      const envItems = data.env.filter(e => !q || e.toLowerCase().indexOf(q) >= 0);
      const mountItems = data.mounts.filter(m => !q || (m.source + m.destination + m.mode).toLowerCase().indexOf(q) >= 0);

      const envCount = envItems.length;
      const mountCount = mountItems.length;

      let listHtml = '';
      if (inspectTab === 'env') {
        if (envCount === 0) {
          listHtml = '<div class="inspect-empty">' + (q ? 'Sonuç bulunamadı' : 'Env var yok') + '</div>';
        } else {
          for (const e of envItems) {
            const eq = e.indexOf('=');
            if (eq > 0) {
              const k = esc(e.substring(0, eq));
              const v = esc(e.substring(eq + 1));
              listHtml += '<div class="inspect-item"><span class="ikey">' + k + '</span><span class="ival">=' + v + '</span></div>';
            } else {
              listHtml += '<div class="inspect-item"><span class="ikey">' + esc(e) + '</span></div>';
            }
          }
        }
      } else {
        if (mountCount === 0) {
          listHtml = '<div class="inspect-empty">' + (q ? 'Sonuç bulunamadı' : 'Mount yok') + '</div>';
        } else {
          for (const m of mountItems) {
            listHtml += '<div class="inspect-item"><span class="ipath">' + esc(m.destination) + '</span> <span class="ival">\\u2190 ' + esc(m.source) + '</span><span class="imode">' + esc(m.mode) + '</span></div>';
          }
        }
      }

      content = \`
        <div class="inspect-tabs">
          <button class="inspect-tab \${inspectTab === 'env' ? 'active' : ''}" data-tab="env">ENV <span class="inspect-count">\${data.env.length}</span></button>
          <button class="inspect-tab \${inspectTab === 'mounts' ? 'active' : ''}" data-tab="mounts">Mounts <span class="inspect-count">\${data.mounts.length}</span></button>
        </div>
        <div class="inspect-list">\${listHtml}</div>
      \`;
    }

    return '<tr class="inspect-row" data-inspect-for="' + esc(containerId) + '">' +
      '<td colspan="' + colSpan + '">' +
      '<div class="inspect-panel">' +
      '<div class="inspect-header"><span>Inspect <span class="inspect-name">' + esc(name) + '</span></span><button class="inspect-close" data-close-inspect="' + esc(containerId) + '">\\u2715</button></div>' +
      '<input type="text" class="inspect-search" placeholder="Ara... (env key, value, path)" value="' + esc(inspectSearchQuery) + '">' +
      content +
      '</div></td></tr>';
  }

  function removeInspectRow() {
    const existing = document.querySelector('.inspect-row');
    if (existing) existing.remove();
  }

  function insertInspectRow(containerId, name) {
    removeInspectRow();
    const tr = document.querySelector('tr[data-id="' + containerId + '"]');
    if (!tr) return;
    const inspectTr = document.createElement('tbody');
    inspectTr.innerHTML = inspectRowHtml(containerId, name);
    const newTr = inspectTr.firstElementChild;
    tr.after(newTr);

    // Attach search handler
    const searchEl = newTr.querySelector('.inspect-search');
    if (searchEl) {
      searchEl.focus();
      searchEl.addEventListener('input', () => {
        inspectSearchQuery = searchEl.value;
        const r = rows.find(r => r.id === containerId);
        insertInspectRow(containerId, r ? r.name : containerId);
      });
    }

    // Attach tab handlers
    newTr.querySelectorAll('.inspect-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        inspectTab = btn.dataset.tab;
        const r = rows.find(r => r.id === containerId);
        insertInspectRow(containerId, r ? r.name : containerId);
      });
    });

    // Attach close handler
    const closeBtn = newTr.querySelector('.inspect-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        openInspectId = null;
        inspectSearchQuery = '';
        removeInspectRow();
      });
    }
  }

  function openInspect(containerId, name) {
    if (openInspectId === containerId) {
      // Toggle off
      openInspectId = null;
      inspectSearchQuery = '';
      removeInspectRow();
      return;
    }
    openInspectId = containerId;
    inspectSearchQuery = '';
    inspectTab = 'env';
    insertInspectRow(containerId, name);
    if (!inspectCache.has(containerId)) {
      vscode.postMessage({ command: 'inspect', containerId, name });
    }
  }

  function buildHeaders() {
    const headerRow = document.getElementById('headerRow');
    let html = '<th class="sel-cell"><input type="checkbox" id="selectAll"></th>';
    html += '<th data-col="name">Container <span class="arrow"></span></th>';
    if (!grouped) html += '<th data-col="owner" id="ownerTh">Owner <span class="arrow"></span></th>';
    html += '<th data-col="vram">VRAM <span class="arrow"></span></th>';
    if (gpuIndices.length > 1) {
      for (const gi of gpuIndices) {
        html += '<th data-col="gpu' + gi + '">G' + gi + '</th>';
      }
    }
    html += '<th data-col="gpuIdx">GPU <span class="arrow"></span></th>';
    html += '<th data-col="gpuUtil">Util% <span class="arrow"></span></th>';
    html += '<th data-col="cpuPct">CPU <span class="arrow"></span></th>';
    html += '<th data-col="ramMib">RAM <span class="arrow"></span></th>';
    html += '<th data-col="netIO">Net <span class="arrow"></span></th>';
    html += '<th data-col="blockIO">Disk <span class="arrow"></span></th>';
    headerRow.innerHTML = html;

    // Re-attach sort handlers
    headerRow.querySelectorAll('th[data-col]').forEach(th => {
      if (th.dataset.col === 'actions') return;
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (sortCol === col) { sortAsc = !sortAsc; }
        else { sortCol = col; sortAsc = col === 'name' || col === 'owner'; }
        render();
      });
    });
  }

  function filterRows(arr) {
    if (!searchQuery) return arr;
    const q = searchQuery.toLowerCase();
    return arr.filter(r => {
      return (r.name + ' ' + r.owner + ' ' + r.image + ' ' + r.composeProject + ' ' + r.gpuIdx + ' ' + r.ports).toLowerCase().indexOf(q) >= 0;
    });
  }

  function render() {
    const tbody = document.getElementById('tbody');
    const countLabel = document.getElementById('countLabel');

    buildHeaders();

    // Re-attach select-all handler
    const sa = document.getElementById('selectAll');
    if (sa) {
      sa.addEventListener('change', () => {
        selectedIds.clear();
        if (sa.checked) {
          document.querySelectorAll('tr[data-id]').forEach(tr => selectedIds.add(tr.dataset.id));
        }
        render();
      });
    }
    updateBulkBar();

    // Update sort arrows
    document.querySelectorAll('th[data-col]').forEach(th => {
      const arrow = th.querySelector('.arrow');
      if (!arrow) return;
      if (th.dataset.col === sortCol) {
        arrow.textContent = sortAsc ? '\\u25B2' : '\\u25BC';
      } else {
        arrow.textContent = '';
      }
    });

    const filtered = filterRows(rows);
    countLabel.textContent = filtered.length + '/' + rows.length + ' container' + (rows.length !== 1 ? 's' : '');
    const sorted = sortRows(filtered);
    const totalCols = getTotalCols();

    if (!grouped) {
      let html = '';
      if (sorted.length === 0) {
        html = '<tr><td colspan="' + totalCols + '" class="empty">No containers running</td></tr>';
      } else {
        for (const r of sorted) html += rowHtml(r, true);
      }
      tbody.innerHTML = html;
    } else {
      // Group by owner
      const groups = new Map();
      for (const r of sorted) {
        if (!groups.has(r.owner)) groups.set(r.owner, []);
        groups.get(r.owner).push(r);
      }
      const sortedGroups = [...groups.entries()].sort((a, b) => {
        const aTotal = a[1].reduce((s, r) => s + r.vram + r.ramMib, 0);
        const bTotal = b[1].reduce((s, r) => s + r.vram + r.ramMib, 0);
        return bTotal - aTotal;
      });

      let html = '';
      const colSpan = totalCols - 1; // no owner column
      for (const [owner, items] of sortedGroups) {
        const totalVram = items.reduce((s, r) => s + r.vram, 0);
        const totalRam = items.reduce((s, r) => s + r.ramMib, 0);
        const collapsed = collapsedGroups.has(owner);
        const toggle = collapsed ? '\\u25B6' : '\\u25BC';
        const summary = items.length + ' ct' +
          (totalVram > 0 ? ' \\u00B7 VRAM ' + fmtMem(totalVram) : '') +
          ' \\u00B7 RAM ' + fmtMem(totalRam);
        html += '<tr class="group-header" data-owner="' + esc(owner) + '">' +
          '<td colspan="' + colSpan + '">' +
          '<span class="toggle">' + toggle + '</span>' +
          esc(owner) + ' <span class="group-summary">(' + summary + ')</span>' +
          '</td></tr>';
        if (!collapsed) {
          for (const r of items) html += rowHtml(r, false);
        }
      }
      if (sortedGroups.length === 0) {
        html = '<tr><td colspan="' + colSpan + '" class="empty">No containers running</td></tr>';
      }
      tbody.innerHTML = html;

      // Group toggle handlers
      tbody.querySelectorAll('.group-header').forEach(tr => {
        tr.addEventListener('click', () => {
          const o = tr.dataset.owner;
          if (collapsedGroups.has(o)) collapsedGroups.delete(o);
          else collapsedGroups.add(o);
          render();
        });
      });
    }

    // Re-insert inspect row after render if one was open
    if (openInspectId) {
      const r = rows.find(r => r.id === openInspectId);
      if (r) insertInspectRow(openInspectId, r.name);
      else { openInspectId = null; inspectSearchQuery = ''; }
    }
  }

  // Double-click to open inspect dropdown
  document.getElementById('tbody').addEventListener('dblclick', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) {
      const id = tr.dataset.id;
      const r = rows.find(r => r.id === id);
      if (r) openInspect(r.id, r.name);
    }
  });

  document.getElementById('tbody').addEventListener('change', (e) => {
    const cb = e.target.closest('.row-check');
    if (cb) {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
      updateBulkBar();
      e.stopPropagation();
    }
  });

  // Sort click handlers (initial)
  document.querySelectorAll('th[data-col]').forEach(th => {
    if (th.dataset.col === 'actions') return;
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) { sortAsc = !sortAsc; }
      else { sortCol = col; sortAsc = col === 'name' || col === 'owner'; }
      render();
    });
  });

  // Search filter
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    render();
  });

  // Group toggle
  const groupBtn = document.getElementById('groupBtn');
  groupBtn.addEventListener('click', () => {
    grouped = !grouped;
    groupBtn.classList.toggle('active', grouped);
    render();
  });

  // Notification toggle
  const notifyBtn = document.getElementById('notifyBtn');
  notifyBtn.addEventListener('click', () => {
    vscode.postMessage({ command: 'toggleNotifications' });
  });

  const bulkStopBtn = document.getElementById('bulkStopBtn');
  const bulkRestartBtn = document.getElementById('bulkRestartBtn');
  const clearSelBtn = document.getElementById('clearSelBtn');
  if (bulkStopBtn) bulkStopBtn.addEventListener('click', () => {
    if (!selectedIds.size) return;
    vscode.postMessage({ command: 'bulkStop', containerIds: [...selectedIds] });
    selectedIds.clear();
    render();
  });
  if (bulkRestartBtn) bulkRestartBtn.addEventListener('click', () => {
    if (!selectedIds.size) return;
    vscode.postMessage({ command: 'bulkRestart', containerIds: [...selectedIds] });
    selectedIds.clear();
    render();
  });
  if (clearSelBtn) clearSelBtn.addEventListener('click', () => {
    selectedIds.clear();
    render();
  });

  // Context menu
  let ctxMenu = null;
  function showContextMenu(e, containerId, name) {
    e.preventDefault();
    hideContextMenu();
    ctxMenu = document.createElement('div');
    ctxMenu.className = 'ctx-menu';
    ctxMenu.style.left = e.clientX + 'px';
    ctxMenu.style.top = e.clientY + 'px';
    const items = [
      { icon: '\\u25B6', label: 'Exec', cmd: 'exec' },
      { icon: '\\u2261', label: 'Logs', cmd: 'logs' },
      { icon: '\\u2192', label: 'Attach', cmd: 'attach' },
    ];
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'ctx-menu-item';
      el.innerHTML = '<span>' + item.icon + '</span><span>' + item.label + '</span>';
      el.addEventListener('click', () => {
        vscode.postMessage({ command: item.cmd, containerId: containerId, name: name });
        hideContextMenu();
      });
      ctxMenu.appendChild(el);
    }
    document.body.appendChild(ctxMenu);
    // Adjust if menu goes off-screen
    const rect = ctxMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) ctxMenu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) ctxMenu.style.top = (window.innerHeight - rect.height - 4) + 'px';
  }
  function hideContextMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('contextmenu', function(e) {
    const tr = e.target.closest('tr[data-id]');
    if (tr) {
      const id = tr.dataset.id;
      const r = rows.find(r => r.id === id);
      if (r) showContextMenu(e, r.id, r.name);
    } else {
      hideContextMenu();
    }
  });

  // Listen for incremental updates
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      rows = msg.rows;
      gpuIndices = msg.gpuIndices;
      render();
    } else if (msg.type === 'notificationsState') {
      notifyBtn.classList.toggle('active', msg.enabled);
    } else if (msg.type === 'inspectResult') {
      inspectCache.set(msg.containerId, msg.data);
      if (openInspectId === msg.containerId) {
        const r = rows.find(r => r.id === msg.containerId);
        insertInspectRow(msg.containerId, r ? r.name : msg.containerId);
      }
    }
  });

  render();
})();
</script>
</body>
</html>`;
  }

  dispose(): void {
    this._subscription.dispose();
  }
}
