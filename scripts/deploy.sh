#!/usr/bin/env bash
# DevPulse Monitor — auto-bump + compile + package + install on the LIVE Stable server.
# Usage: ./scripts/deploy.sh
#
# - Auto-bumps the package.json PATCH version (so the build is always higher than
#   what's installed; VS Code keeps the highest version).
# - Auto-detects the *currently running* code-server binary instead of a hardcoded
#   commit hash (VS Code self-updates, so the commit in the path changes over time).
set -euo pipefail
cd "$(dirname "$0")/.."

AGENT_FOLDER="/tier01/data/labhome/yani/vscode-server-fix/.vscode-server"

# Detect the live code-server binary from the running process; fall back to the
# most-recently-modified server build under the agent folder.
detect_code_server() {
  local pid args bin
  for pid in $(pgrep -f 'cli/servers/Stable.*/server/bin/code-server' 2>/dev/null || true); do
    args="$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -m1 'bin/code-server$' || true)"
    if [ -n "$args" ] && [[ "$args" == "$AGENT_FOLDER"* ]] && [ -x "$args" ]; then
      echo "$args"; return 0
    fi
  done
  # Fallback: newest server bin in the cli/servers tree
  bin="$(ls -dt "$AGENT_FOLDER"/cli/servers/Stable-*/server/bin/code-server 2>/dev/null | grep -v '\.staging/' | head -1 || true)"
  [ -n "$bin" ] && echo "$bin"
}

CODE_SERVER="$(detect_code_server)"
if [ -z "$CODE_SERVER" ]; then
  echo "✗ Could not locate a running code-server binary under $AGENT_FOLDER" >&2
  exit 1
fi
echo "→ Using live server: $CODE_SERVER"

# 1. Auto-bump patch version (no git tag) and capture the new version
NEW_VERSION="$(npm version patch --no-git-tag-version | tail -1 | sed 's/^v//')"
echo "→ Version bumped to $NEW_VERSION"

# 2. Compile
npm run compile

# 3. Package
npx vsce package --no-dependencies -o "devpulse-monitor-${NEW_VERSION}.vsix"

# 4. Remove any older installed copies so only the fresh build remains
for d in "$AGENT_FOLDER"/extensions/anisoft.devpulse-monitor-*; do
  [ -d "$d" ] && [[ "$d" != *"$NEW_VERSION" ]] && rm -rf "$d" && echo "→ Removed stale install: $(basename "$d")"
done

# 5. Install on the live server
VSCODE_AGENT_FOLDER="$AGENT_FOLDER" "$CODE_SERVER" --install-extension "devpulse-monitor-${NEW_VERSION}.vsix"

echo
echo "✓ Installed devpulse-monitor ${NEW_VERSION}"
echo "  In VS Code run: Ctrl+Shift+P → 'Developer: Restart Extension Host'"
echo "  (a plain 'Reload Window' sometimes keeps the old extension host warm)"
