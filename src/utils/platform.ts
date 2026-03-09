import { readFileSync } from "fs";

export type Platform = "linux" | "darwin" | "win32";

export function detectPlatform(): Platform {
  return process.platform as Platform;
}

export function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const version = readFileSync("/proc/version", "utf-8").toLowerCase();
    return version.includes("microsoft") || version.includes("wsl");
  } catch {
    return false;
  }
}
