import { spawn } from "child_process";
import * as vscode from "vscode";
import { DiskInfo, DirUsage } from "../types";
import { logDebug } from "../utils/logger";

/** Map a directory path to the df mount with the longest matching prefix. */
export function bestMount(path: string, mounts: DiskInfo[]): string {
  let best = "/";
  let bestLen = -1;
  for (const m of mounts) {
    const mp = m.mount;
    const matches = path === mp || path.startsWith(mp === "/" ? "/" : mp + "/");
    if (matches && mp.length > bestLen) {
      best = mp;
      bestLen = mp.length;
    }
  }
  return best;
}

/**
 * Measure first-level subfolder sizes under each base path with `du`.
 * Cancellable: when the token is cancelled the running du process is killed
 * immediately, so collapsing the Disk Manager actually stops the work.
 */
export async function computeDiskUsers(
  paths: string[],
  mounts: DiskInfo[],
  token: vscode.CancellationToken,
  onProgress: (msg: string) => void,
): Promise<DirUsage[]> {
  const result: DirUsage[] = [];
  for (const base of paths) {
    if (token.isCancellationRequested) break;
    // Only allow simple absolute paths — avoid surprises
    if (!/^\/[\w./-]*$/.test(base)) {
      logDebug(`[disk] skipping invalid diskUsagePaths entry: ${base}`);
      continue;
    }
    onProgress(`Scanning ${base}…`);
    const stdout = await runDu(base, token);
    if (token.isCancellationRequested) break;
    for (const line of stdout.trim().split("\n")) {
      const m = line.match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      const bytes = parseInt(m[1]);
      const path = m[2].trim();
      if (path === base) continue; // skip the rolled-up total line
      const sizeGib = parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(1));
      if (sizeGib < 0.1) continue;
      const name = path.split("/").filter(Boolean).pop() || path;
      result.push({ path, name, sizeGib, mount: bestMount(path, mounts) });
    }
  }
  return result.sort((a, b) => b.sizeGib - a.sizeGib);
}

/** Run `du -x -d1 -B1 <base>` without a shell so the child can be killed cleanly. */
function runDu(base: string, token: vscode.CancellationToken): Promise<string> {
  return new Promise<string>((resolve) => {
    // -x stay on one filesystem, -d1 one level deep, -B1 report actual bytes
    const child = spawn("du", ["-x", "-d1", "-B1", base]);
    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", () => {}); // ignore "permission denied" noise
    const onCancel = token.onCancellationRequested(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    });
    const done = () => {
      onCancel.dispose();
      resolve(out);
    };
    child.on("close", done);
    child.on("error", (e) => {
      logDebug(`[disk] du spawn failed for ${base}: ${e}`);
      done();
    });
  });
}
