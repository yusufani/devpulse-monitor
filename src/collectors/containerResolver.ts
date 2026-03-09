import { readFile } from "fs/promises";

async function readProcFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Resolves a PID to its container ID by parsing /proc/{pid}/cgroup.
 * Linux only — returns empty string on other platforms.
 */
export async function resolveContainerFromPid(
  pid: number,
  containerNameMap: Map<string, string>,
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
    return { id: cid, name: containerNameMap.get(cid) || cid };
  } catch {
    return { id: "", name: "host" };
  }
}
