#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is not installed; skipping dependency install" >&2
  exit 0
fi

bun install
