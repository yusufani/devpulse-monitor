import * as vscode from "vscode";
import { MonitorService } from "../services/monitorService";
import { MonitorData } from "../types";

interface ContainerRow {
  name: string;
  owner: string;
  vram: number;
  gpuIdx: string;
  cpuPct: number;
  ramMib: number;
  ramLimitMib: number;
  ramPct: number;
  hasStats: boolean;
  hasGpu: boolean;
}

export class ContainerTableViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "dockerServices";
  private _view?: vscode.WebviewView;
  private _subscription: vscode.Disposable;

  constructor(private readonly monitor: MonitorService) {
    this._subscription = monitor.onDataUpdated(() => {
      this._updateView();
    });
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._updateView();
      }
    });

    this._updateView();
  }

  private _updateView(): void {
    if (!this._view) return;
    this._view.webview.html = this._buildHtml();
  }

  private _buildRows(): ContainerRow[] {
    const data: MonitorData = this.monitor.getLatestData();
    const containers = data.containers;
    const gpuProcesses = data.gpuData.processes;
    const containerStats = data.gpuData.containerStats;

    const gpuByContainer = new Map<string, { vram: number; gpus: Set<number> }>();
    for (const p of gpuProcesses) {
      if (!p.containerId) continue;
      if (!gpuByContainer.has(p.containerId)) {
        gpuByContainer.set(p.containerId, { vram: 0, gpus: new Set() });
      }
      const entry = gpuByContainer.get(p.containerId)!;
      entry.vram += p.memMib;
      entry.gpus.add(p.gpuIndex);
    }

    return containers.map((c) => {
      const gpu = gpuByContainer.get(c.id);
      const stats = containerStats.get(c.id);
      return {
        name: c.name,
        owner: c.ownerName,
        vram: gpu?.vram || 0,
        gpuIdx: gpu ? [...gpu.gpus].sort().join(",") : "",
        cpuPct: stats?.cpuPercent ?? 0,
        ramMib: stats?.memUsedMib ?? 0,
        ramLimitMib: stats?.memLimitMib ?? 0,
        ramPct: stats?.memPercent ?? 0,
        hasStats: !!stats,
        hasGpu: (gpu?.vram || 0) > 0,
      };
    });
  }

  private _buildHtml(): string {
    const rows = this._buildRows();

    // Build JSON data for client-side sorting
    const jsonData = JSON.stringify(rows);

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
  .red { color: var(--vscode-errorForeground, #f44); }
  .yellow { color: var(--vscode-editorWarning-foreground, #cc0); }
  .cyan { color: #4ec9b0; }
  .dim { opacity: 0.4; }
  .empty {
    text-align: center;
    padding: 20px;
    opacity: 0.5;
  }
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
</style>
</head>
<body>
  <div class="toolbar">
    <span id="countLabel"></span>
    <button id="groupBtn" title="Group by owner">Group by Owner</button>
  </div>
  <table>
    <thead>
      <tr>
        <th data-col="name">Container <span class="arrow"></span></th>
        <th data-col="owner" id="ownerTh">Owner <span class="arrow"></span></th>
        <th data-col="vram">VRAM <span class="arrow"></span></th>
        <th data-col="gpuIdx">GPU <span class="arrow"></span></th>
        <th data-col="cpuPct">CPU <span class="arrow"></span></th>
        <th data-col="ramMib">RAM <span class="arrow"></span></th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

<script>
(function() {
  const rows = ${jsonData};
  let sortCol = 'vram';
  let sortAsc = false;
  let grouped = false;
  const collapsedGroups = new Set();

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
  function ramCls(r) { return r.ramLimitMib > 0 && (r.ramMib / r.ramLimitMib) * 100 > 80 ? 'red' : ''; }
  function vramCls(r) { return r.hasGpu ? 'cyan' : 'dim'; }

  function rowHtml(r, showOwner) {
    return '<tr>' +
      '<td class="name" title="' + esc(r.name) + '">' + esc(r.name) + '</td>' +
      (showOwner ? '<td class="owner-cell">' + esc(r.owner) + '</td>' : '') +
      '<td class="' + vramCls(r) + '">' + (r.vram > 0 ? fmtMem(r.vram) : '\\u2014') + '</td>' +
      '<td class="' + vramCls(r) + '">' + (r.gpuIdx || '\\u2014') + '</td>' +
      '<td class="' + cpuCls(r.cpuPct) + '">' + (r.hasStats ? r.cpuPct.toFixed(1) + '%' : '\\u2014') + '</td>' +
      '<td class="' + ramCls(r) + '">' + (r.hasStats ? fmtMem(r.ramMib) : '\\u2014') + '</td>' +
      '</tr>';
  }

  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function render() {
    const tbody = document.getElementById('tbody');
    const countLabel = document.getElementById('countLabel');
    const ownerTh = document.getElementById('ownerTh');
    countLabel.textContent = rows.length + ' container' + (rows.length !== 1 ? 's' : '');

    // Update sort arrows
    document.querySelectorAll('th[data-col]').forEach(th => {
      const arrow = th.querySelector('.arrow');
      if (th.dataset.col === sortCol) {
        arrow.textContent = sortAsc ? '\\u25B2' : '\\u25BC';
      } else {
        arrow.textContent = '';
      }
    });

    const sorted = sortRows(rows);

    if (!grouped) {
      ownerTh.style.display = '';
      let html = '';
      if (sorted.length === 0) {
        html = '<tr><td colspan="6" class="empty">No containers running</td></tr>';
      } else {
        for (const r of sorted) html += rowHtml(r, true);
      }
      tbody.innerHTML = html;
    } else {
      ownerTh.style.display = 'none';
      // Group by owner
      const groups = new Map();
      for (const r of sorted) {
        if (!groups.has(r.owner)) groups.set(r.owner, []);
        groups.get(r.owner).push(r);
      }
      // Sort groups by total RAM desc
      const sortedGroups = [...groups.entries()].sort((a, b) => {
        const aTotal = a[1].reduce((s, r) => s + r.vram + r.ramMib, 0);
        const bTotal = b[1].reduce((s, r) => s + r.vram + r.ramMib, 0);
        return bTotal - aTotal;
      });

      let html = '';
      const colSpan = 5; // no owner column
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
  }

  // Sort click handlers
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) { sortAsc = !sortAsc; }
      else { sortCol = col; sortAsc = col === 'name' || col === 'owner'; }
      render();
    });
  });

  // Group toggle
  const groupBtn = document.getElementById('groupBtn');
  groupBtn.addEventListener('click', () => {
    grouped = !grouped;
    groupBtn.classList.toggle('active', grouped);
    render();
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
