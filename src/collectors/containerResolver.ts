import { readFileSync } from "fs";

function readProcFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Resolves a PID to its container ID by parsing /proc/{pid}/cgroup.
 * Works when running on the host with access to host /proc.
 * Returns empty id when /proc is not accessible (e.g. inside a container).
 */
export function resolveContainerFromPid(
  pid: number,
  containerNameMap: Map<string, string>,
): { id: string; name: string } {
  try {
    const cgroup = readProcFile(`/proc/${pid}/cgroup`);
    if (!cgroup) return { id: "", name: "host" };
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
    return { id: cid, name: containerNameMap.get(cid) || cid };
  } catch {
    return { id: "", name: "host" };
  }
}
