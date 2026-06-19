#!/usr/bin/env bash
set -euo pipefail

# pi-cursor one-line/source installer.
# Usage from a checkout: ./install.sh
# Usage from GitHub: curl -fsSL https://raw.githubusercontent.com/xycld/pi-cursor/main/install.sh | bash

REPO_URL="${PI_CURSOR_REPO_URL:-https://github.com/xycld/pi-cursor.git}"
INSTALL_DIR="${PI_CURSOR_INSTALL_DIR:-${HOME}/.local/share/pi-cursor}"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required for the pi-cursor installer." >&2
  exit 1
fi

if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "Warning: cursor-agent was not found in PATH. Install Cursor Agent before using the provider." >&2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/bin/pi-cursor.js" ]; then
  node "$SCRIPT_DIR/bin/pi-cursor.js" install "$@"
  exit $?
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required when installing from the remote one-line script." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only origin main
else
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

node "$INSTALL_DIR/bin/pi-cursor.js" install "$@"
