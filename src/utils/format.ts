export function fmtMem(mib: number): string {
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)}G`;
  return `${mib}M`;
}

export function fmtPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function fmtUptime(startTime: number): string {
  if (!startTime) return "";
  const elapsed = Date.now() - startTime;
  if (elapsed < 0) return "";
  const sec = Math.floor(elapsed / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const days = Math.floor(hr / 24);
  return `${days}d ${hr % 24}h`;
}

export function fmtStartDate(startTime: number): string {
  if (!startTime) return "";
  const d = new Date(startTime);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toMib(s: string): number {
  s = s.trim();
  if (s.endsWith("GiB")) return parseFloat(s) * 1024;
  if (s.endsWith("MiB")) return parseFloat(s);
  if (s.endsWith("KiB")) return parseFloat(s) / 1024;
  if (s.endsWith("TiB")) return parseFloat(s) * 1024 * 1024;
  return parseFloat(s) || 0;
}
