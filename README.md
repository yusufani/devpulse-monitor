# DevPulse

[![Version](https://img.shields.io/visual-studio-marketplace/v/ANISOFT.devpulse-monitor?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=ANISOFT.devpulse-monitor)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/ANISOFT.devpulse-monitor)](https://marketplace.visualstudio.com/items?itemName=ANISOFT.devpulse-monitor)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/ANISOFT.devpulse-monitor)](https://marketplace.visualstudio.com/items?itemName=ANISOFT.devpulse-monitor)
[![GitHub Release](https://img.shields.io/github/v/release/yusufani/devpulse-monitor)](https://github.com/yusufani/devpulse-monitor/releases)
[![License](https://img.shields.io/badge/license-Source%20Available-blue)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-red?logo=github)](https://github.com/sponsors/yusufani)

Real-time system and container resource monitoring — GPU, CPU, RAM, VRAM — right in your VS Code sidebar.

**If you find DevPulse useful, please consider [sponsoring the project](https://github.com/sponsors/yusufani) to support development!**

## Why DevPulse?

Working on a shared GPU server? Running dozens of containers? DevPulse gives you a live dashboard without leaving your editor. See who's using what GPU, which container is eating your RAM, and kill runaway processes — all from the sidebar.

## Features
<img alt="image" src="https://github.com/user-attachments/assets/96ec3218-b9de-4ba2-8a08-a61636fc1cc2" style="max-width: 100%; height: auto;" />
<img alt="image" src="https://github.com/user-attachments/assets/0c374a6c-15d1-4d50-9db1-c6dab8366a73" style="max-width: 100%; height: auto;" />

<img alt="image" src="https://github.com/user-attachments/assets/a420eec4-fe3f-4dd7-ad22-93f8082f6c66" style="max-width: 100%; height: auto;" />

### Container Resources Table
Sortable table of all running containers showing VRAM, CPU, RAM, Net I/O, and Disk I/O. Click column headers to sort by any metric. Use the **Group by Owner** button to see per-user resource totals — great for shared servers where you need to know who's using what.

### GPU Monitoring
Full support for **NVIDIA** (nvidia-smi), **AMD** (rocm-smi), and **Apple Silicon** (system_profiler). Each GPU shows:
- VRAM usage with a color-coded visual map per user
- Temperature, power draw, and utilization percentage
- Per-user breakdown: expand any GPU to see which user/container is consuming VRAM
- Multi-GPU summary line when multiple GPUs are present

### System Metrics
CPU and RAM usage displayed in the **status bar** and **sidebar** with visual bars. Always visible at a glance while you work.

### Container Management
Right-click any container in the sidebar for a full set of actions:
- **Stop / Restart / Force Kill** — manage container lifecycle
- **Exec** — open a shell inside the container
- **Attach** — attach to the container's main process
- **Logs** — tail the last 100 lines in a VS Code terminal
- **Open Port** — open exposed ports directly in your browser
- **Show Environment Variables** — view all env vars set in the container
- **Show Volume Mounts** — inspect bind mounts and volumes
- **Copy Container ID / Name / Image** — quick copy to clipboard

### Smart Alerts (Opt-in)
All notifications are **disabled by default**. Enable them with the **Alerts** toggle button in the container table toolbar. Once enabled, DevPulse watches for:
- **VRAM Critical** — warns when any GPU exceeds 90% VRAM usage (resets at 85%)
- **Container Stopped** — notifies when containers disappear between refresh cycles. Use `notifyOnlyMyContainers` to filter by your OS user.
- **Idle GPU** — detects GPUs with VRAM allocated but near-zero utilization for 3+ consecutive samples — helps find forgotten jobs
- **Memory Leak** — flags GPUs with monotonically increasing VRAM over 10 samples with 5%+ growth — early warning for leaky training runs

### WebView Dashboard
Full GPU/process visualization panel with detailed charts. Open it via `Ctrl+Shift+G` or Command Palette → "Open GPU Monitor".

### Quick Commands
| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+G` | Open GPU Monitor panel |
| `Ctrl+Shift+D` | Find Container (quick pick) |
| `Ctrl+Shift+T` | Show Top GPU Consumers |

### Graceful Degradation
No GPU? Shows system metrics and containers only. No Docker? Shows GPU and system metrics. Running inside a container? Automatically falls back to `docker top` for process detection. Everything works with whatever is available.

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
cd devpulse-monitor
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
| `dockerMonitor.notifyOnlyMyContainers` | `true` | Only show container stop notifications for containers owned by the current OS user |

## Requirements

- **Docker CLI** — for container monitoring (optional)
- **nvidia-smi** — for NVIDIA GPU monitoring (optional)
- **rocm-smi** — for AMD GPU monitoring (optional)

None of these are strictly required. DevPulse shows whatever is available.

## Links

- [GitHub Repository](https://github.com/yusufani/devpulse-monitor)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ANISOFT.devpulse-monitor)
- [Report Issues](https://github.com/yusufani/devpulse-monitor/issues)
- [Sponsor](https://github.com/sponsors/yusufani)

## License

Source Available — free for personal and non-commercial use. Commercial use requires written permission from ANISOFT. See [LICENSE](LICENSE) for details.
