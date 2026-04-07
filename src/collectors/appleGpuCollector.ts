import { IGpuCollector } from "./interfaces";
import { GpuInfo, GpuProcess } from "../types";
import { execCommand } from "../utils/exec";
import { log } from "../utils/logger";
import { detectPlatform } from "../utils/platform";

export class AppleGpuCollector implements IGpuCollector {
  async isAvailable(): Promise<boolean> {
    return detectPlatform() === "darwin";
  }

  async collectGpus(): Promise<GpuInfo[]> {
    const gpus: GpuInfo[] = [];

    try {
      const { stdout } = await execCommand("system_profiler SPDisplaysDataType -json", { timeout: 10000 });
      const data = JSON.parse(stdout);
      const displays = data?.SPDisplaysDataType || [];

      for (let i = 0; i < displays.length; i++) {
        const d = displays[i];
        const name = d._name || `Apple GPU ${i}`;
        // Apple reports VRAM in string format like "16 GB" or as unified memory
        const vramStr = d.sppci_vram || d["spdisplays_vram"] || "0";
        const vramMatch = vramStr.match(/(\d+)\s*(GB|MB)/i);
        let memTotalMib = 0;
        if (vramMatch) {
          const val = parseInt(vramMatch[1]);
          memTotalMib = vramMatch[2].toUpperCase() === "GB" ? val * 1024 : val;
        }

        gpus.push({
          index: i,
          name,
          vendor: "apple",
          memUsed: 0,
          memTotal: memTotalMib,
          memFree: memTotalMib,
          util: 0,
          temp: 0,
          power: 0,
        });
      }
    } catch (e) {
      log(`system_profiler query failed: ${e}`);
    }

    // Enhance with ioreg data (GPU utilization, power)
    if (gpus.length > 0) {
      try {
        const { stdout: ioregOut } = await execCommand(
          "ioreg -r -d 1 -c IOGPUDevice -w 0",
          { timeout: 5000 },
        );
        const utilMatch = ioregOut.match(/"Device Utilization %"\s*=\s*(\d+)/);
        if (utilMatch) gpus[0].util = parseInt(utilMatch[1]);

        const powerMatch = ioregOut.match(/"gpu-power"\s*=\s*(\d+)/);
        if (powerMatch) gpus[0].power = parseInt(powerMatch[1]) / 1000; // mW to W
      } catch (e) {
        log(`[apple] ioreg IOGPUDevice query failed: ${e}`);
      }

      // Try AGXAccelerator as alternative source
      if (gpus[0].util === 0) {
        try {
          const { stdout: agxOut } = await execCommand(
            "ioreg -r -d 1 -n AGXAccelerator -w 0",
            { timeout: 5000 },
          );
          const utilMatch = agxOut.match(/"Device Utilization %"\s*=\s*(\d+)/);
          if (utilMatch) gpus[0].util = parseInt(utilMatch[1]);
        } catch (e) {
          log(`[apple] AGXAccelerator query failed: ${e}`);
        }
      }

      // Unified memory: use vm_stat to estimate GPU-relevant memory usage
      // (wired + compressed pages ≈ active use including GPU buffers)
      try {
        const { stdout: vmStat } = await execCommand("vm_stat", { timeout: 3000 });
        const pageSize = parseInt(vmStat.match(/page size of (\d+) bytes/)?.[1] || "16384");
        const wiredMatch = vmStat.match(/Pages wired down:\s+(\d+)/);
        const compressedMatch = vmStat.match(/Pages occupied by compressor:\s+(\d+)/);
        const wiredPages = parseInt(wiredMatch?.[1] || "0");
        const compressedPages = parseInt(compressedMatch?.[1] || "0");
        const usedMib = Math.round(((wiredPages + compressedPages) * pageSize) / (1024 * 1024));
        if (usedMib > 0 && gpus[0].memTotal > 0) {
          gpus[0].memUsed = Math.min(usedMib, gpus[0].memTotal);
          gpus[0].memFree = gpus[0].memTotal - gpus[0].memUsed;
        }
      } catch (e) {
        log(`[apple] vm_stat memory query failed: ${e}`);
      }

      // Temperature via ioreg thermal sensors (best-effort, no sudo)
      try {
        const { stdout: thermalOut } = await execCommand(
          "ioreg -r -n AppleARMIODevice -w 0",
          { timeout: 5000 },
        );
        const tempMatch = thermalOut.match(/"temperature"\s*=\s*(\d+)/);
        if (tempMatch) {
          const raw = parseInt(tempMatch[1]);
          // Value may be in centi-degrees or raw — normalize
          gpus[0].temp = raw > 1000 ? Math.round(raw / 100) : raw;
        }
      } catch (e) {
        log(`[apple] thermal ioreg query failed: ${e}`);
      }
    }

    return gpus;
  }

  async collectProcesses(_containerNameMap: Map<string, string>): Promise<GpuProcess[]> {
    const processes: GpuProcess[] = [];

    // Method 1: Try ioreg for GPU client PIDs
    try {
      const { stdout: ioregOut } = await execCommand(
        "ioreg -r -c IOGPUDevice -w 0",
        { timeout: 5000 },
      );
      // IOGPUDevice children contain IOGPUNotificationHandler with "pid" property
      const pidMatches = ioregOut.matchAll(/"pid"\s*=\s*(\d+)/g);
      const gpuPids = new Set<number>();
      for (const m of pidMatches) {
        const pid = parseInt(m[1]);
        if (pid > 1) gpuPids.add(pid); // skip kernel (0/1)
      }

      if (gpuPids.size > 0) {
        // Get process details via ps
        const pidList = [...gpuPids].join(",");
        const { stdout: psOut } = await execCommand(
          `ps -o pid=,rss=,user=,uid=,comm= -p ${pidList}`,
          { timeout: 5000 },
        );
        for (const line of psOut.trim().split("\n")) {
          if (!line.trim()) continue;
          const fields = line.trim().split(/\s+/);
          if (fields.length < 5) continue;
          const pid = parseInt(fields[0]);
          if (isNaN(pid)) continue;
          const rssKb = parseInt(fields[1]) || 0;
          const user = fields[2] || "?";
          const uid = parseInt(fields[3]) || -1;
          const comm = fields.slice(4).join(" ");
          const processName = comm.split("/").pop() || comm;

          processes.push({
            pid,
            gpuIndex: 0,
            memMib: 0, // Apple doesn't expose per-process GPU memory
            processName,
            containerId: "",
            containerName: "host",
            cmdline: comm,
            cwd: "?",
            cpuPercent: 0,
            ramMib: Math.round(rssKb / 1024),
            uid,
            username: user,
            startTime: 0,
          });
        }
      }
    } catch (e) {
      log(`[apple] ioreg GPU client PID detection failed: ${e}`);
    }

    // Method 2: If ioreg didn't find PIDs, try finding Metal/GPU-heavy processes
    if (processes.length === 0) {
      try {
        // Look for processes with known GPU frameworks loaded
        const { stdout } = await execCommand(
          "ps -eo pid=,rss=,user=,uid=,comm= | grep -iE '(Metal|GPU|python|torch|tensorflow|mlx)' | head -20",
          { timeout: 5000 },
        );
        for (const line of stdout.trim().split("\n")) {
          if (!line.trim()) continue;
          const fields = line.trim().split(/\s+/);
          if (fields.length < 5) continue;
          const pid = parseInt(fields[0]);
          if (isNaN(pid)) continue;
          const rssKb = parseInt(fields[1]) || 0;
          const user = fields[2] || "?";
          const uid = parseInt(fields[3]) || -1;
          const comm = fields.slice(4).join(" ");
          // Skip the grep process itself
          if (comm.includes("grep")) continue;
          const processName = comm.split("/").pop() || comm;

          processes.push({
            pid,
            gpuIndex: 0,
            memMib: 0,
            processName,
            containerId: "",
            containerName: "host",
            cmdline: comm,
            cwd: "?",
            cpuPercent: 0,
            ramMib: Math.round(rssKb / 1024),
            uid,
            username: user,
            startTime: 0,
          });
        }
      } catch (e) {
        log(`[apple] Metal/GPU process grep fallback failed: ${e}`);
      }
    }

    return processes;
  }
}
