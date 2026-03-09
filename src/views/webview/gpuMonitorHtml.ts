import { GpuData, GpuInfo, GpuProcess } from "../../types";
import { fmtMem } from "../../utils/format";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function bar(used: number, total: number): string {
  const pct = total > 0 ? (used / total) * 100 : 0;
  const cls = pct > 90 ? "red" : pct > 70 ? "yellow" : "green";
  return `<div class="bar"><div class="bar-fill ${cls}" style="width:${pct}%"></div></div>`;
}

function memClass(mib: number): string {
  return mib > 40000 ? "red" : mib > 10000 ? "yellow" : "";
}

function renderGpuCards(gpus: GpuInfo[]): string {
  let html = "";
  for (const gpu of gpus) {
    const pct = gpu.memTotal > 0 ? Math.round((gpu.memUsed / gpu.memTotal) * 100) : 0;
    html += `<div class="gpu-card">
      <div class="gpu-header">GPU ${gpu.index}: ${esc(gpu.name)}</div>
      <div class="gpu-stats">
        <div class="gpu-stat"><span class="label">VRAM</span>${bar(gpu.memUsed, gpu.memTotal)}<span class="value">${fmtMem(gpu.memUsed)} / ${fmtMem(gpu.memTotal)} (${pct}%)</span></div>
        <div class="gpu-stat"><span class="label">Util</span>${bar(gpu.util, 100)}<span class="value ${gpu.util > 80 ? "red" : gpu.util > 50 ? "yellow" : "green"}">${gpu.util}%</span></div>
        <div class="gpu-inline">
          <span>Temp: <b class="${gpu.temp > 80 ? "red" : gpu.temp > 65 ? "yellow" : ""}">${gpu.temp}\u00B0C</b></span>
          <span>Power: <b>${gpu.power.toFixed(0)}W</b></span>
          <span>Free: <b>${fmtMem(gpu.memFree)}</b></span>
        </div>
      </div>
    </div>`;
  }
  return html;
}

function renderContainerSummary(data: GpuData): string {
  const { processes, containerStats, gpus } = data;
  const containerGpu: Record<string, Record<number, number>> = {};
  const cnameToId: Record<string, string> = {};
  for (const p of processes) {
    const cn = p.containerName === "host" ? "(host)" : p.containerName;
    if (!containerGpu[cn]) containerGpu[cn] = {};
    containerGpu[cn][p.gpuIndex] = (containerGpu[cn][p.gpuIndex] || 0) + p.memMib;
    if (p.containerId) cnameToId[cn] = p.containerId;
  }

  const gpuIndices = gpus.map((g) => g.index).sort((a, b) => a - b);
  const sc = Object.entries(containerGpu).sort(
    (a, b) =>
      Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0),
  );

  let headers = `<th>Container</th>`;
  for (const gi of gpuIndices) headers += `<th>G${gi}</th>`;
  headers += `<th>VRAM</th><th>CPU</th><th>RAM</th>`;

  let rows = "";
  for (const [cn, gm] of sc) {
    const tv = Object.values(gm).reduce((s, v) => s + v, 0);
    const cs = cnameToId[cn] ? containerStats.get(cnameToId[cn]) : undefined;
    let cols = `<td class="name">${esc(cn)}</td>`;
    for (const gi of gpuIndices) cols += `<td class="${memClass(gm[gi] || 0)}">${gm[gi] ? fmtMem(gm[gi]) : "\u2014"}</td>`;
    cols += `<td class="${memClass(tv)}"><b>${fmtMem(tv)}</b></td>`;
    cols += `<td>${cs ? cs.cpuPercent.toFixed(1) + "%" : "\u2014"}</td>`;
    cols += `<td>${cs ? fmtMem(cs.memUsedMib) : "\u2014"}</td>`;
    rows += `<tr>${cols}</tr>`;
  }

  return `<table><tr>${headers}</tr>${rows}</table>`;
}

function renderProcessGroups(data: GpuData): string {
  const { processes } = data;
  const cnameToId: Record<string, string> = {};
  const groups: Record<string, GpuProcess[]> = {};
  for (const p of processes) {
    const cn = p.containerName === "host" ? "(host)" : p.containerName;
    if (!groups[cn]) groups[cn] = [];
    groups[cn].push(p);
    if (p.containerId) cnameToId[cn] = p.containerId;
  }

  const sortedGroups = Object.entries(groups).sort(
    (a, b) => b[1].reduce((s, p) => s + p.memMib, 0) - a[1].reduce((s, p) => s + p.memMib, 0),
  );

  let html = "";
  for (const [cn, procs] of sortedGroups) {
    const tv = procs.reduce((s, p) => s + p.memMib, 0);
    const tr = procs.reduce((s, p) => s + p.ramMib, 0);
    const gu = [...new Set(procs.map((p) => p.gpuIndex))].sort().join(",");
    const cid = cnameToId[cn] || "";
    let act = "";
    if (cn !== "(host)" && cid) {
      act = `<button class="btn btn-warn" onclick="stopContainer('${cid}','${esc(cn)}')">Stop</button>`;
      act += `<button class="btn btn-danger" onclick="killContainerAction('${cid}','${esc(cn)}')">Kill</button>`;
    }
    html += `<div class="group-header"><span class="group-name">${esc(cn)}</span><span class="group-meta">${procs.length} procs \u00B7 VRAM ${fmtMem(tv)} \u00B7 RAM ${fmtMem(tr)} \u00B7 GPU ${gu}</span>${act}</div>`;
    for (let i = 0; i < procs.length; i++) {
      const p = procs[i];
      const last = i === procs.length - 1;
      const br = last ? "\u2514\u2500" : "\u251C\u2500";
      const co = last ? "  " : "\u2502 ";
      const cmd = p.cmdline.length > 80 ? p.cmdline.substring(0, 77) + "..." : p.cmdline;
      const cw = p.cwd.length > 40 ? "..." + p.cwd.substring(p.cwd.length - 37) : p.cwd;
      html += `<div class="proc-row"><span class="tree">${br}</span><span class="pid">${p.pid}</span><span class="mem ${memClass(p.memMib)}">${fmtMem(p.memMib)}</span><span class="ram">${fmtMem(p.ramMib)}</span><span class="gpu-idx">G${p.gpuIndex}</span><span class="pname">${esc(p.processName)}</span><button class="btn-kill" onclick="killProc(${p.pid},'${esc(p.processName)}',${p.memMib})">\u00D7</button></div>`;
      html += `<div class="proc-detail"><span class="tree dim">${co}</span><span class="dim">\u2514 ${esc(cw)}$ ${esc(cmd)}</span></div>`;
    }
  }
  return html;
}

export function getGpuMonitorHtml(data: GpuData): string {
  const { gpus, processes, error } = data;
  const gpuRows = renderGpuCards(gpus);
  const hasProcesses = processes.length > 0;

  let processHtml = "";
  if (hasProcesses) {
    processHtml = `<div class="section-title">Container Summary</div>${renderContainerSummary(data)}<div class="section-title">GPU Processes</div>${renderProcessGroups(data)}`;
  } else if (!error) {
    processHtml = `<div class="no-data">No GPU processes.</div>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
:root{--bg:var(--vscode-editor-background);--fg:var(--vscode-editor-foreground);--border:var(--vscode-panel-border,#333);--green:#4ec9b0;--yellow:#dcdcaa;--red:#f44747;--cyan:#9cdcfe;--dim:var(--vscode-disabledForeground,#666);--card-bg:var(--vscode-sideBar-background,#1e1e1e)}
body{font-family:var(--vscode-editor-font-family,monospace);font-size:13px;color:var(--fg);background:var(--bg);padding:12px;margin:0}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.header h2{margin:0;color:var(--cyan);font-size:15px}
.header .meta{color:var(--dim);font-size:12px}
.refresh-btn{background:none;border:1px solid var(--border);color:var(--fg);padding:4px 12px;cursor:pointer;border-radius:3px;font-size:12px}
.refresh-btn:hover{background:var(--border)}
.error{color:var(--red);padding:8px;border:1px solid var(--red);border-radius:4px;margin-bottom:12px}
.section-title{color:var(--cyan);font-weight:bold;margin:16px 0 6px 0;font-size:13px;border-bottom:1px solid var(--border);padding-bottom:4px}
.gpu-card{background:var(--card-bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px;margin-bottom:10px}
.gpu-header{font-weight:bold;margin-bottom:8px}
.gpu-stats{display:flex;flex-direction:column;gap:4px}
.gpu-stat{display:flex;align-items:center;gap:8px}
.gpu-stat .label{width:40px;color:var(--dim)}
.gpu-stat .value{min-width:140px}
.gpu-inline{display:flex;gap:20px;margin-top:4px;color:var(--dim)}
.gpu-inline b{color:var(--fg)}
.bar{width:160px;height:14px;background:#333;border-radius:3px;overflow:hidden;flex-shrink:0}
.bar-fill{height:100%;border-radius:3px;transition:width .3s}
.bar-fill.green{background:var(--green)}.bar-fill.yellow{background:var(--yellow)}.bar-fill.red{background:var(--red)}
table{border-collapse:collapse;width:100%;margin-bottom:8px}
th,td{text-align:right;padding:3px 10px;border-bottom:1px solid var(--border);font-size:12px}
th{color:var(--dim);font-weight:normal;text-transform:uppercase;font-size:11px}
td.name{text-align:left;font-weight:bold;color:var(--cyan)}
.group-header{background:var(--card-bg);border:1px solid var(--border);border-radius:4px;padding:6px 10px;margin:8px 0 2px 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.group-name{color:var(--cyan);font-weight:bold}
.group-meta{color:var(--dim);font-size:12px}
.proc-row{display:flex;align-items:center;gap:8px;padding:2px 0 2px 16px;font-family:monospace}
.proc-detail{padding:0 0 4px 16px;font-family:monospace;font-size:11px}
.tree{color:var(--dim);width:20px;flex-shrink:0}
.pid{color:var(--dim);width:70px;text-align:right}
.mem{width:70px;text-align:right;font-weight:bold}
.ram{width:60px;text-align:right;color:var(--dim)}
.gpu-idx{width:24px;color:var(--dim)}
.pname{color:var(--fg);flex:1}
.dim{color:var(--dim)}
.green{color:var(--green)}.yellow{color:var(--yellow)}.red{color:var(--red)}
.no-data{color:var(--dim);padding:12px}
.btn{border:1px solid var(--border);background:none;color:var(--fg);padding:2px 8px;border-radius:3px;cursor:pointer;font-size:11px}
.btn-warn{border-color:var(--yellow);color:var(--yellow)}.btn-warn:hover{background:var(--yellow);color:#000}
.btn-danger{border-color:var(--red);color:var(--red)}.btn-danger:hover{background:var(--red);color:#fff}
.btn-kill{background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;padding:0 4px;opacity:.5}.btn-kill:hover{opacity:1}
</style></head><body>
<div class="header">
  <h2>GPU / Docker VRAM Monitor</h2>
  <div>
    <span class="meta">${new Date().toLocaleTimeString()} \u00B7 ${processes.length} procs \u00B7 auto-refresh 5s</span>
    <button class="refresh-btn" onclick="vscode.postMessage({command:'refresh'})">\u21BB Refresh</button>
  </div>
</div>
${error ? `<div class="error">${esc(error)}</div>` : ""}
<div class="section-title">GPU Overview</div>
${gpuRows}
${processHtml}
<script>
const vscode=acquireVsCodeApi();
function killProc(p,n,m){vscode.postMessage({command:'killProcess',pid:p,name:n,mem:m})}
function stopContainer(c,n){vscode.postMessage({command:'stopContainer',containerId:c,name:n})}
function killContainerAction(c,n){vscode.postMessage({command:'killContainer',containerId:c,name:n})}
</script>
</body></html>`;
}
