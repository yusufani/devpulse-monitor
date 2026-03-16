# DevPulse

Real-time system and container resource monitoring — GPU, CPU, RAM, VRAM — right in your VS Code sidebar.

## Why DevPulse?

Working on a shared GPU server? Running dozens of containers? DevPulse gives you a live dashboard without leaving your editor. See who's using what GPU, which container is eating your RAM, and kill runaway processes — all from the sidebar.

## Features

- **Container Resources Table** — Sortable table of all running containers with VRAM, CPU, RAM. Click column headers to sort. Group by owner to see per-user resource usage.
- **GPU Monitoring** — NVIDIA (nvidia-smi), AMD (rocm-smi), Apple Silicon. Per-GPU VRAM maps with user color coding.
- **System Metrics** — CPU and RAM usage in the status bar and sidebar with visual bars.
- **Process Management** — Kill GPU processes, stop/restart/force-kill containers, view logs — directly from the sidebar.
- **WebView Dashboard** — Full GPU/process visualization panel (`Ctrl+Shift+P` → "Open GPU Monitor").
- **Container-Aware** — Works both on the host and from inside Docker containers (automatic fallback via `docker top`).

## Platform Support

| Platform | CPU/RAM | GPU | Containers |
|----------|---------|-----|------------|
| Linux | /proc | nvidia-smi, rocm-smi | docker CLI |
| macOS | sysctl, vm_stat | system_profiler | docker CLI |
| WSL2 | /proc | nvidia-smi (passthrough) | docker CLI |

No GPU? Shows system metrics and containers only. No Docker? Shows GPU and system metrics. Everything degrades gracefully.

## Installation

### VS Code Marketplace
Search for **DevPulse** in the Extensions panel, or:
```
ext install ANISOFT.devpulse
```

### From VSIX
```bash
code --install-extension devpulse-*.vsix
```

### From Source
```bash
git clone https://github.com/yusufani/devpulse-monitor.git
cd vscode-docker-monitor
npm install
npm run package
code --install-extension dist/devpulse-*.vsix
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `dockerMonitor.refreshInterval` | `10` | Sidebar refresh interval (seconds) |
| `dockerMonitor.webviewRefreshInterval` | `5` | WebView refresh interval (seconds) |
| `dockerMonitor.gpuMonitoring` | `true` | Enable GPU monitoring |
| `dockerMonitor.dockerBinary` | `""` | Custom docker binary path (auto-detected if empty) |
| `dockerMonitor.enableNotifications` | `false` | Enable automatic notifications (VRAM alerts, container stop, idle GPU, memory leak) |

## Requirements

- **Docker CLI** — for container monitoring (optional)
- **nvidia-smi** — for NVIDIA GPU monitoring (optional)
- **rocm-smi** — for AMD GPU monitoring (optional)

None of these are strictly required. DevPulse shows whatever is available.

## License

Source Available — free for personal and non-commercial use. Commercial use requires written permission from ANISOFT. See [LICENSE](LICENSE) for details.
