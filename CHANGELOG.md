# Changelog

## [1.0.0](https://github.com/yusuf-ani/vscode-docker-monitor/releases/tag/v1.0.0) (2025-03-09)

### Features

* Cross-platform architecture with strategy pattern collectors (Linux, macOS)
* NVIDIA GPU monitoring via nvidia-smi (batched: 2 calls instead of 3)
* AMD GPU monitoring via rocm-smi
* Apple GPU detection via system_profiler
* Real-time CPU/RAM monitoring from /proc (Linux) or sysctl/vm_stat (macOS)
* Docker container management (list, stats, stop, kill)
* Configurable services panel via `.vscode/docker-services.json`
* Auto-discovery of docker-compose services
* Single MonitorService with EventEmitter (no duplicate collection)
* Status bar with GPU/CPU/RAM at a glance
* Sidebar tree views for system monitor and services
* WebView panel with detailed GPU/process/container visualization
* Configurable refresh intervals via VS Code settings
