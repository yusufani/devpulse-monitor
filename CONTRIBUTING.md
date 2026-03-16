# Contributing

Thank you for your interest in contributing to DevPulse Monitor!

## Development Setup

1. Clone the repository
2. Run `npm install`
3. Open in VS Code
4. Press `F5` to launch the Extension Development Host

## Building

```bash
npm run compile    # TypeScript compilation
npm run lint       # ESLint check
npm run typecheck  # Type checking without emit
npm run package    # Build .vsix package
```

## Project Structure

- `src/collectors/` — Platform-specific data collectors (system, GPU, Docker)
- `src/services/` — MonitorService (orchestrator) and ServiceRegistry
- `src/views/` — UI components (status bar, sidebars, webview)
- `src/utils/` — Shared utilities (exec, format, platform detection)

## Pull Requests

- Use [conventional commits](https://www.conventionalcommits.org/) for PR titles
- Run `npm run lint && npm run typecheck` before submitting
- Test on Linux if possible (primary platform)

## Architecture

The extension uses a **strategy pattern** for platform collectors behind interfaces.
A single `MonitorService` collects data once per refresh cycle and broadcasts to all
UI consumers via EventEmitter, avoiding duplicate shell calls.
