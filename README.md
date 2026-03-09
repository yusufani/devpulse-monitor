# Docker Monitor for VS Code

Real-time GPU, CPU, and RAM monitoring with Docker container management — right in your VS Code sidebar.

## Features

- **System Monitoring** — CPU and RAM usage in the status bar and sidebar
- **GPU Monitoring** — NVIDIA (nvidia-smi), AMD (rocm-smi), Apple Silicon (system_profiler)
- **Docker Containers** — Live container list with CPU/RAM/VRAM stats, stop/kill actions
- **GPU Processes** — Per-process VRAM usage, container mapping, kill from sidebar
- **Container Resources Table** — Sortable table view of all containers with VRAM/CPU/RAM, group by owner
- **WebView Dashboard** — Detailed GPU/process visualization (`Ctrl+Shift+P` → "Open GPU Monitor")

## Cross-Platform Support

| Platform | CPU/RAM | GPU | Docker | Process→Container |
|----------|---------|-----|--------|--------------------|
| Linux | /proc | nvidia-smi, rocm-smi | docker CLI | /proc/cgroup |
| macOS | sysctl, vm_stat | system_profiler | docker CLI | — |
| WSL2 | /proc | nvidia-smi (passthrough) | docker CLI | /proc/cgroup |

The extension gracefully degrades — no GPU? Shows system metrics only. No Docker? Shows GPU only.

## Installation

### From VSIX
```bash
code --install-extension docker-monitor-1.0.0.vsix
```

### From Source
```bash
git clone https://github.com/yusuf-ani/vscode-docker-monitor.git
cd vscode-docker-monitor
npm install
npm run compile
npm run package
code --install-extension docker-monitor-*.vsix
```

## Configuration

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `dockerMonitor.refreshInterval` | `10` | Sidebar refresh interval (seconds) |
| `dockerMonitor.webviewRefreshInterval` | `5` | WebView refresh interval (seconds) |
| `dockerMonitor.gpuMonitoring` | `true` | Enable GPU monitoring |
| `dockerMonitor.dockerBinary` | `""` | Custom docker binary path (auto-detected if empty) |

## License

Source Available — free for personal and non-commercial use. Commercial use requires written permission. See [LICENSE](LICENSE) for details.
