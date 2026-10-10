#!/bin/bash
# Installs dependencies in Claude Code cloud sessions so tests and the build work immediately.
set -euo pipefail
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund
