import { exec } from "child_process";
import { promisify } from "util";
import { detectPlatform } from "./platform";

const execAsync = promisify(exec);

const binaryCache = new Map<string, string | null>();

export function getShell(): string {
  return detectPlatform() === "win32" ? "cmd.exe" : "/bin/bash";
}

export async function findBinary(name: string): Promise<string | null> {
  if (binaryCache.has(name)) return binaryCache.get(name)!;

  const cmd = detectPlatform() === "win32" ? `where ${name}` : `which ${name}`;
  try {
    const { stdout } = await execAsync(cmd, { shell: getShell(), timeout: 5000 });
    const path = stdout.trim().split("\n")[0].trim();
    if (path) {
      binaryCache.set(name, path);
      return path;
    }
  } catch {
    // binary not found
  }
  binaryCache.set(name, null);
  return null;
}

export async function execCommand(
  command: string,
  options: { timeout?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    shell: getShell(),
    timeout: options.timeout ?? 30000,
  });
}

export function clearBinaryCache(): void {
  binaryCache.clear();
}
