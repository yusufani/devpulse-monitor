# Docker Monitor for VS Code

Real-time GPU, CPU, and RAM monitoring with Docker container management — right in your VS Code sidebar.

## Features

- **System Monitoring** — CPU and RAM usage in the status bar and sidebar
- **GPU Monitoring** — NVIDIA (nvidia-smi), AMD (rocm-smi), Apple Silicon (system_profiler)
- **Docker Containers** — Live container list with CPU/RAM/VRAM stats, stop/kill actions
- **GPU Processes** — Per-process VRAM usage, container mapping, kill from sidebar
- **Services Panel** — Configurable service launcher with status indicators
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
| `dockerMonitor.servicesConfigPath` | `.vscode/docker-services.json` | Path to services config |
| `dockerMonitor.autoDiscoverServices` | `true` | Auto-discover docker-compose services |
| `dockerMonitor.gpuMonitoring` | `true` | Enable GPU monitoring |
| `dockerMonitor.dockerBinary` | `""` | Custom docker binary path (auto-detected if empty) |

### Services Configuration

Create `.vscode/docker-services.json` in your workspace:

```json
{
  "categories": [
    { "id": "db", "label": "DATABASES", "sortOrder": 0 },
    { "id": "app", "label": "APPLICATIONS", "sortOrder": 1 }
  ],
  "services": [
    {
      "id": "postgres",
      "label": "PostgreSQL",
      "category": "db",
      "dockerService": "postgres",
      "script": "scripts/run-postgres.sh",
      "description": "Database :5432"
    },
    {
      "id": "api",
      "label": "API Server",
      "category": "app",
      "composeName": "api",
      "description": "Backend API :8080"
    }
  ]
}
```

If no config file exists and `autoDiscoverServices` is enabled, the extension will find `docker-compose*.yml` files and list their services automatically.

## License

MIT
