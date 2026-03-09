export function fmtMem(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)}G`;
  return `${mib}M`;
}

export function fmtPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function toMib(s: string): number {
  s = s.trim();
  if (s.endsWith("GiB")) return parseFloat(s) * 1024;
  if (s.endsWith("MiB")) return parseFloat(s);
  if (s.endsWith("KiB")) return parseFloat(s) / 1024;
  if (s.endsWith("TiB")) return parseFloat(s) * 1024 * 1024;
  return parseFloat(s) || 0;
}
