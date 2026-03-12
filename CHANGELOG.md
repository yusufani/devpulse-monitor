# Changelog

## [1.3.0](https://github.com/yusufani/vscode-docker-monitor/compare/v1.2.1...v1.3.0) (2026-03-12)


### Features

* Enhance GPU monitoring with historical data and incremental updates ([a4b123e](https://github.com/yusufani/vscode-docker-monitor/commit/a4b123eee73fbcdc635fac9d66a67f80d0fa88fa))

## [1.2.1](https://github.com/yusufani/vscode-docker-monitor/compare/v1.2.0...v1.2.1) (2026-03-10)


### Bug Fixes

* update display name to include full description in package.json ([100d812](https://github.com/yusufani/vscode-docker-monitor/commit/100d8124f24abbce4e7bdda864170586d41597cb))
* update extension name to devpulse-monitor in package.json ([8a65bfa](https://github.com/yusufani/vscode-docker-monitor/commit/8a65bfab28d7f25ec5f06598d907745c72c0e725))

## [1.2.0](https://github.com/yusufani/vscode-docker-monitor/compare/v1.1.0...v1.2.0) (2026-03-10)


### Features

* rename Docker Monitor to DevPulse and update related assets and documentation ([ac5ff53](https://github.com/yusufani/vscode-docker-monitor/commit/ac5ff53080c9c431b50bda502570a900b5004afe))


### Bug Fixes

* update extension name to devpulse-monitor in package.json ([8a65bfa](https://github.com/yusufani/vscode-docker-monitor/commit/8a65bfab28d7f25ec5f06598d907745c72c0e725))

## [1.1.0](https://github.com/yusufani/vscode-docker-monitor/compare/v1.0.2...v1.1.0) (2026-03-10)


### Features

* rename Docker Monitor to DevPulse and update related assets and documentation ([ac5ff53](https://github.com/yusufani/vscode-docker-monitor/commit/ac5ff53080c9c431b50bda502570a900b5004afe))

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
