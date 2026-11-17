#!/usr/bin/env bash
# Builds dist/claude-read-aloud-<version>.zip from extension/
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
mkdir -p dist
rm -f "dist/claude-read-aloud-$version.zip"
(cd extension && zip -qr "../dist/claude-read-aloud-$version.zip" . -x '.*')
echo "dist/claude-read-aloud-$version.zip"
