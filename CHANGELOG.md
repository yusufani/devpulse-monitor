# Changelog

## [1.0.2](https://github.com/yusufani/vscode-docker-monitor/compare/v1.0.1...v1.0.2) (2026-03-10)


### Bug Fixes

* prevent update view from executing when the webview is not initialized ([d741655](https://github.com/yusufani/vscode-docker-monitor/commit/d74165512517477f73ab4fdbc26758f250ee02ba))
* update VSIX paths in CI workflows to ensure correct artifact handling ([568fbc8](https://github.com/yusufani/vscode-docker-monitor/commit/568fbc8bd4a3a3e226a18367f04bb72c1dc1edb4))

## [1.0.1](https://github.com/yusufani/vscode-docker-monitor/compare/v1.0.0...v1.0.1) (2026-03-09)


### Bug Fixes

* update VSIX paths in CI workflows to ensure correct artifact handling ([568fbc8](https://github.com/yusufani/vscode-docker-monitor/commit/568fbc8bd4a3a3e226a18367f04bb72c1dc1edb4))

## 1.0.0 (2026-03-09)


### Features

* enhance GPU monitoring with user-specific VRAM tracking and visualization ([84c3a98](https://github.com/yusufani/vscode-docker-monitor/commit/84c3a9883bba150fbc0feb782c73053f670b01de))


### Bug Fixes

* add .vscode/ to .gitignore ([08b5103](https://github.com/yusufani/vscode-docker-monitor/commit/08b51031375e550faabadd8f670dc001d6078fad))
* **ci:** remove npm cache and use npm install instead of npm ci ([5d75481](https://github.com/yusufani/vscode-docker-monitor/commit/5d75481384efcd098ac0a1eafea91b2d1688fadf))

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
