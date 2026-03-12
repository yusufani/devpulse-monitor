#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Read current version from package.json
CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

# Bump patch version
PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$PATCH"

echo "=== DevPulse Dev Build ==="
echo "  $CURRENT -> $NEW_VERSION"
echo ""

# Update version in package.json
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Clean
rm -rf out dist

# Compile
echo "[1/2] Compiling..."
npx tsc -p ./

# Package
echo "[2/2] Packaging..."
mkdir -p dist
npx @vscode/vsce package --no-dependencies -o dist/

VSIX="dist/devpulse-monitor-${NEW_VERSION}.vsix"
echo ""
echo "=== Done: $VSIX ==="
echo ""
echo "Install with:"
echo "  code --install-extension $VSIX"
