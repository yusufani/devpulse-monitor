import { readFile } from "fs/promises";
import { IGpuCollector } from "./interfaces";
import { GpuInfo, GpuProcess } from "../types";
import { findBinary, execCommand } from "../utils/exec";
import { log } from "../utils/logger";

async function readProcFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

// UID resolution cache
let _uidMap: Map<number, string> | null = null;

async function resolveUid(uid: number): Promise<string> {
  if (!_uidMap) {
    _uidMap = new Map();
    try {
      const passwd = await readProcFile("/etc/passwd");
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

async function resolveContainer(
  pid: number,
  cnameMap: Map<string, string>,
): Promise<{ id: string; name: string }> {
  try {
    const cgroup = await readProcFile(`/proc/${pid}/cgroup`);
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

async function getProcessDetail(
  pid: number,
): Promise<{ cmdline: string; cwd: string; ramMib: number; uid: number }> {
  let cmdline = "",
    cwd = "",
    ramMib = 0,
    uid = -1;

  try {
    const raw = await readProcFile(`/proc/${pid}/cmdline`);
    cmdline = raw.replace(/\0/g, " ").trim();
  } catch {
    // no access
  }

  try {
    const { stdout } = await execCommand(`readlink -f /proc/${pid}/cwd 2>/dev/null`, { timeout: 3000 });
    cwd = stdout.trim();
  } catch {
    // no access
  }

  try {
    const status = await readProcFile(`/proc/${pid}/status`);
    const ramMatch = status.match(/VmRSS:\s+(\d+)\s+kB/);
    if (ramMatch) ramMib = Math.round(parseInt(ramMatch[1]) / 1024);
    const uidMatch = status.match(/Uid:\s+(\d+)/);
    if (uidMatch) uid = parseInt(uidMatch[1]);
  } catch {
    // no access
  }

  return { cmdline, cwd, ramMib, uid };
}

export class NvidiaCollector implements IGpuCollector {
  private smiPath: string | null = null;
  private uuidToIndex = new Map<string, number>();

  async isAvailable(): Promise<boolean> {
    this.smiPath = await findBinary("nvidia-smi");
    return this.smiPath !== null;
  }

  async collectGpus(): Promise<GpuInfo[]> {
    if (!this.smiPath) return [];
    const gpus: GpuInfo[] = [];

    try {
      // Batched: GPU info + UUID in one query (was 2 separate calls before)
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

      const detailPromises = rawProcs.map(async (r) => {
        const container = await resolveContainer(r.pid, containerNameMap);
        const detail = await getProcessDetail(r.pid);
        const username = detail.uid >= 0 ? await resolveUid(detail.uid) : "?";
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
    } catch (e) {
      log(`nvidia-smi process query failed: ${e}`);
    }

    return processes;
  }
}
