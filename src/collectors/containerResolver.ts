import { readFileSync } from "fs";
import { PodIndex } from "./interfaces";

function readProcFile(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Extracts a container short id (first 12 hex) from a /proc/{pid}/cgroup body.
 * Handles Docker (`docker-<id>.scope` / bare 64-hex) and CRI runtimes used by
 * Kubernetes: containerd (`cri-containerd-<id>.scope`) and CRI-O (`crio-<id>.scope`).
 * Returns "" when no container id can be found (host process).
 */
export function extractContainerShortId(cgroup: string): string {
  for (const segment of cgroup.split(/[/\n]/)) {
    const s = segment.trim();
    // containerd (k3s/k8s): cri-containerd-<64hex>.scope
    if (s.startsWith("cri-containerd-") && s.endsWith(".scope")) {
      const inner = s.slice("cri-containerd-".length, -".scope".length);
      if (inner.length === 64 && /^[0-9a-f]+$/.test(inner)) return inner.substring(0, 12);
    }
    // CRI-O: crio-<64hex>.scope
    if (s.startsWith("crio-") && s.endsWith(".scope")) {
      const inner = s.slice(5, -6);
      if (inner.length === 64 && /^[0-9a-f]+$/.test(inner)) return inner.substring(0, 12);
    }
    // Docker: docker-<64hex>.scope
    if (s.startsWith("docker-") && s.endsWith(".scope")) {
      const inner = s.slice(7, -6);
      if (inner.length === 64) return inner.substring(0, 12);
    }
    // Bare 64-hex segment (cgroup v1 docker, some containerd layouts)
    if (s.length === 64 && /^[0-9a-f]+$/.test(s)) return s.substring(0, 12);
  }
  return "";
}

/**
 * Resolves a PID to its container ID by parsing /proc/{pid}/cgroup.
 * Works when running on the host with access to host /proc.
 * Returns empty id when /proc is not accessible (e.g. inside a container).
 *
 * When a podIndex is supplied and the container belongs to a pod, the result is
 * remapped to the pod (id = "k8s:<namespace>/<pod>") so attribution lands on the pod.
 */
export function resolveContainerFromPid(
  pid: number,
  containerNameMap: Map<string, string>,
  podIndex?: PodIndex,
): { id: string; name: string } {
  try {
    const cgroup = readProcFile(`/proc/${pid}/cgroup`);
    if (!cgroup) return { id: "", name: "host" };
    const cid = extractContainerShortId(cgroup);
    if (!cid) return { id: "", name: "host" };
    const pod = podIndex?.get(cid);
    if (pod) return { id: pod.id, name: pod.name };
    return { id: cid, name: containerNameMap.get(cid) || cid };
  } catch {
    return { id: "", name: "host" };
  }
}
