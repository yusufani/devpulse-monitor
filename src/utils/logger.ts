import * as vscode from "vscode";

let _channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("DevPulse");
  }
  return _channel;
}

// ── Ring buffer: auto-clear when line count exceeds limit ──

const MAX_LINES = 2000;
let _lineCount = 0;

function appendLine(line: string): void {
  const ch = getOutputChannel();
  if (_lineCount >= MAX_LINES) {
    ch.clear();
    _lineCount = 0;
    ch.appendLine(`[${ts()}] Log cleared (>${MAX_LINES} lines)`);
    _lineCount++;
  }
  ch.appendLine(line);
  _lineCount++;
}

// ── Throttle: suppress repeated identical messages ──

let _lastMsg = "";
let _lastMsgTime = 0;
let _suppressCount = 0;
const THROTTLE_MS = 30_000; // same message suppressed for 30s

function shouldThrottle(msg: string): boolean {
  const now = Date.now();
  if (msg === _lastMsg && now - _lastMsgTime < THROTTLE_MS) {
    _suppressCount++;
    return true;
  }
  if (_suppressCount > 0) {
    appendLine(`[${ts()}]   ↑ suppressed ${_suppressCount} identical message(s)`);
    _suppressCount = 0;
  }
  _lastMsg = msg;
  _lastMsgTime = now;
  return false;
}

// ── Timestamp helper ──

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

// ── Public API ──

/** General log (always written) */
export function log(msg: string): void {
  if (shouldThrottle(msg)) return;
  appendLine(`[${ts()}] ${msg}`);
}

/** Debug log — only written when dockerMonitor.debugLogging is enabled */
export function logDebug(msg: string): void {
  const enabled = vscode.workspace.getConfiguration("dockerMonitor").get<boolean>("debugLogging", false);
  if (!enabled) return;
  if (shouldThrottle(msg)) return;
  appendLine(`[${ts()}] [DEBUG] ${msg}`);
}
