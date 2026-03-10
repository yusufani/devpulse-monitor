import * as vscode from "vscode";

let _channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!_channel) {
    _channel = vscode.window.createOutputChannel("DevPulse");
  }
  return _channel;
}

export function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  getOutputChannel().appendLine(`[${ts}] ${msg}`);
}
