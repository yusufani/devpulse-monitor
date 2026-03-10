import { readFileSync } from "fs";
import { IGpuCollector } from "./interfaces";
import { GpuInfo, GpuProcess } from "../types";
import { findBinary, execCommand } from "../utils/exec";
import { log } from "../utils/logger";

function readProcFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/** Returns true if host /proc is accessible (i.e. we're not in a PID-namespaced container) */
function canAccessHostProc(pid: number): boolean {
  return readProcFile(`/proc/${pid}/status`).length > 0;
}

// UID resolution cache
let _uidMap: Map<number, string> | null = null;

function resolveUidFromPasswd(uid: number): string {
  if (!_uidMap) {
    _uidMap = new Map();
    try {
      const passwd = readProcFile("/etc/passwd");
      for (const line of passwd.split("\n")) {
        const p = line.split(":");
        if (p.length >= 3) _uidMap.set(parseInt(p[2]), p[0]);
      }
    } catch {
      // no passwd file
    }
  }
  return _uidMap.get(uid) || `uid:${uid}`;
}

// ── /proc-based resolution (works on host) ─────────────────────

function resolveContainerFromProc(
  pid: number,
  cnameMap: Map<string, string>,
): { id: string; name: string } {
  try {
    const cgroup = readProcFile(`/proc/${pid}/cgroup`);
    let cid = "";
    for (const segment of cgroup.split(/[/\n]/)) {
      const s = segment.trim();
      if (s.length === 64 && /^[0-9a-f]+$/.test(s)) {
        cid = s.substring(0, 12);
        break;
      }
      if (s.startsWith("docker-") && s.endsWith(".scope")) {
        const inner = s.slice(7, -6);
        if (inner.length === 64) {
          cid = inner.substring(0, 12);
          break;
        }
      }
    }
    if (!cid) return { id: "", name: "host" };
    return { id: cid, name: cnameMap.get(cid) || cid };
  } catch {
    return { id: "", name: "host" };
  }
}

function getProcessDetailFromProc(
  pid: number,
): { cmdline: string; cwd: string; ramMib: number; uid: number } {
  let cmdline = "", cwd = "", ramMib = 0, uid = -1;

  const raw = readProcFile(`/proc/${pid}/cmdline`);
  if (raw) cmdline = raw.replace(/\0/g, " ").trim();

  try {
    // cwd via readlink is sync-safe but we need exec for symlink
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readlinkSync } = require("fs");
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    // no access
  }

  const status = readProcFile(`/proc/${pid}/status`);
  if (status) {
    const ramMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
    if (ramMatch) ramMib = Math.round(parseInt(ramMatch[1]) / 1024);
    const uidMatch = status.match(/Uid:\s+(\d+)/);
    if (uidMatch) uid = parseInt(uidMatch[1]);
  }

  return { cmdline, cwd, ramMib, uid };
}

// ── docker-based resolution (fallback for container environments) ──

interface DockerPidMap {
  pidToContainer: Map<number, { id: string; name: string }>;
  pidToUser: Map<number, string>;
}

async function buildDockerPidMap(
  docker: string,
  cnameMap: Map<string, string>,
): Promise<DockerPidMap> {
  const pidToContainer = new Map<number, { id: string; name: string }>();
  const pidToUser = new Map<number, string>();

  try {
    // Get all container IDs
    const { stdout } = await execCommand(`${docker} ps --no-trunc --format "{{.ID}}|{{.Names}}"`);
    const lines = stdout.trim().split("\n").filter((l) => l.includes("|"));

    // For each container, get its PIDs and users via docker top
    const promises = lines.map(async (line) => {
      const [fullId, name] = line.split("|", 2);
      const cid = fullId.substring(0, 12);
      try {
        const { stdout: topOut } = await execCommand(
          `${docker} top ${cid} aux`,
          { timeout: 5000 },
        );
        const topLines = topOut.trim().split("\n");
        // Skip header (first line)
        for (let i = 1; i < topLines.length; i++) {
          const parts = topLines[i].trim().split(/\s+/);
          if (parts.length >= 2) {
            const user = parts[0];
            const pid = parseInt(parts[1]);
            if (!isNaN(pid)) {
              pidToContainer.set(pid, { id: cid, name: cnameMap.get(cid) || name });
              pidToUser.set(pid, user);
            }
          }
        }
      } catch {
        // container may have stopped
      }
    });

    await Promise.all(promises);
  } catch (e) {
    log(`[pidmap] buildDockerPidMap failed: ${e}`);
  }

  return { pidToContainer, pidToUser };
}

// ── NvidiaCollector ────────────────────────────────────────────

export class NvidiaCollector implements IGpuCollector {
  private smiPath: string | null = null;
  private uuidToIndex = new Map<string, number>();
  private _procAccessible: boolean | null = null;

  async isAvailable(): Promise<boolean> {
    this.smiPath = await findBinary("nvidia-smi");
    return this.smiPath !== null;
  }

  async collectGpus(): Promise<GpuInfo[]> {
    if (!this.smiPath) return [];
    const gpus: GpuInfo[] = [];

    try {
      const { stdout } = await execCommand(
        `${this.smiPath} --query-gpu=index,name,memory.used,memory.total,memory.free,utilization.gpu,temperature.gpu,power.draw,uuid --format=csv,noheader,nounits`,
      );
      this.uuidToIndex.clear();
      for (const line of stdout.trim().split("\n")) {
        const p = line.split(",").map((s) => s.trim());
        if (p.length < 9) continue;
        const index = parseInt(p[0]);
        gpus.push({
          index,
          name: p[1],
          vendor: "nvidia",
          memUsed: parseInt(p[2]),
          memTotal: parseInt(p[3]),
          memFree: parseInt(p[4]),
          util: parseInt(p[5]),
          temp: parseInt(p[6]),
          power: parseFloat(p[7]),
        });
        this.uuidToIndex.set(p[8], index);
      }
    } catch (e) {
      log(`nvidia-smi GPU query failed: ${e}`);
    }

    return gpus;
  }

  async collectProcesses(containerNameMap: Map<string, string>): Promise<GpuProcess[]> {
    if (!this.smiPath) return [];
    const processes: GpuProcess[] = [];

    try {
      const { stdout: procCsv } = await execCommand(
        `${this.smiPath} --query-compute-apps=pid,used_memory,gpu_uuid,process_name --format=csv,noheader,nounits`,
      ).catch(() => ({ stdout: "", stderr: "" }));

      const rawProcs: Array<{ pid: number; mem: number; gpuIdx: number; pname: string }> = [];
      for (const line of procCsv.trim().split("\n")) {
        if (!line.trim()) continue;
        const p = line.split(",", 4).map((s) => s.trim());
        if (p.length < 4 || !p[0]) continue;
        const pid = parseInt(p[0]),
          mem = parseInt(p[1]);
        if (isNaN(pid) || isNaN(mem)) continue;
        rawProcs.push({ pid, mem, gpuIdx: this.uuidToIndex.get(p[2]) ?? -1, pname: p[3] });
      }
      rawProcs.sort((a, b) => b.mem - a.mem);

      if (rawProcs.length === 0) return [];

      // Check if /proc is accessible (cache result)
      if (this._procAccessible === null) {
        this._procAccessible = canAccessHostProc(rawProcs[0].pid);
        if (!this._procAccessible) {
          log("[nvidia] /proc not accessible, using docker fallback for process resolution");
        }
      }

      if (this._procAccessible) {
        // Fast path: direct /proc access
        const detailPromises = rawProcs.map(async (r) => {
          const container = resolveContainerFromProc(r.pid, containerNameMap);
          const detail = getProcessDetailFromProc(r.pid);
          const username = detail.uid >= 0 ? resolveUidFromPasswd(detail.uid) : "?";
          return {
            pid: r.pid,
            gpuIndex: r.gpuIdx,
            memMib: r.mem,
            processName: r.pname.split("/").pop() || r.pname,
            containerId: container.id,
            containerName: container.name,
            cmdline: detail.cmdline || r.pname,
            cwd: detail.cwd || "?",
            cpuPercent: 0,
            ramMib: detail.ramMib,
            uid: detail.uid,
            username,
          } as GpuProcess;
        });
        processes.push(...(await Promise.all(detailPromises)));
      } else {
        // Fallback: use docker top to build PID→container map
        const docker = (await findBinary("docker")) || "docker";
        const pidMap = await buildDockerPidMap(docker, containerNameMap);

        for (const r of rawProcs) {
          const container = pidMap.pidToContainer.get(r.pid) || { id: "", name: "host" };
          const username = pidMap.pidToUser.get(r.pid) || "?";
          processes.push({
            pid: r.pid,
            gpuIndex: r.gpuIdx,
            memMib: r.mem,
            processName: r.pname.split("/").pop() || r.pname,
            containerId: container.id,
            containerName: container.name,
            cmdline: r.pname,
            cwd: "?",
            cpuPercent: 0,
            ramMib: 0,
            uid: -1,
            username,
          });
        }
      }
    } catch (e) {
      log(`nvidia-smi process query failed: ${e}`);
    }

    return processes;
  }
}
