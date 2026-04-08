# DevPulse Monitor

VS Code extension for real-time GPU, CPU, RAM, and Docker container monitoring.

## Build & Test Workflow

After making changes, always build, package, install, and test locally before pushing:

```bash
# 1. Compile
npm run compile

# 2. Package VSIX (bump version in package.json first if needed)
npx vsce package --no-dependencies

# 3. Install on remote VS Code Server Insiders
/tier01/data/labhome/yani/.vscode-server-insiders/cli/servers/Insiders-53fb310ae033b6fc8f6a3599a168028cb08ad37d/server/bin/code-server-insiders --install-extension devpulse-monitor-*.vsix

# 4. User reloads window: Ctrl+Shift+P -> Developer: Reload Window
```

**Important:** There is already an installed version. Always bump `version` in `package.json` higher than the current installed version, otherwise the old version will be used.

## One-liner (compile + package + install)

```bash
npm run compile && npx vsce package --no-dependencies && /tier01/data/labhome/yani/.vscode-server-insiders/cli/servers/Insiders-53fb310ae033b6fc8f6a3599a168028cb08ad37d/server/bin/code-server-insiders --install-extension devpulse-monitor-*.vsix
```

## Architecture

- `src/collectors/` - Data collectors (nvidia, apple, rocm, docker, system)
- `src/services/` - MonitorService orchestrates all collectors
- `src/views/` - UI: sidebar tree view, webview panel, status bar, container table
- `src/views/webview/` - Webview HTML/JS (GPU Monitor panel)
- `src/views/treeItems.ts` - Sidebar tree item classes
- `src/views/gpuSidebar.ts` - Sidebar tree data provider
- `src/utils/` - Shared utilities (format, logger)
- `package.json` - Commands, menus, keybindings, configuration

## Sidebar Tree View Notes

- Adding buttons to sidebar items requires: command in `package.json` contributes.commands, menu entry in `contributes.menus.view/item/context` with `group: "inline"`, matching `contextValue` on the TreeItem, and command handler in `extension.ts`
- Webview (HTML panel) and sidebar (TreeView API) are completely different - HTML/CSS/JS only works in webview

## Webview Notes

- `navigator.clipboard` does NOT work in VS Code webviews. Use `vscode.postMessage({command:'copyText', text})` and handle in panel with `vscode.env.clipboard.writeText()`
- First render uses `getGpuMonitorHtml()`, subsequent updates use `postMessage` for incremental DOM updates
- `retainContextWhenHidden: true` means old HTML persists - panel must be closed and reopened to see structural HTML changes
