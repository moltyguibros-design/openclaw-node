#!/usr/bin/env bash
# session-start.sh — Load project context at session start.
# Hook: SessionStart
# Output goes to Claude's context as system information.

set -euo pipefail

WORKSPACE="${HOME}/.openclaw/workspace"

echo "=== Session Context ==="
echo ""

# Git state
if command -v git &>/dev/null && git rev-parse --is-inside-work-tree &>/dev/null 2>&1; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
  echo "Branch: ${BRANCH}"
  echo ""
  echo "Recent commits:"
  git log --oneline -3 2>/dev/null || true
  echo ""
fi

# Active tasks (first 20 lines)
TASKS="${WORKSPACE}/memory/active-tasks.md"
if [ -f "$TASKS" ]; then
  echo "Active tasks:"
  head -20 "$TASKS"
  echo ""
fi

# Daemon state (per-node, written by memory-daemon)
_NODE_ID="${OPENCLAW_NODE_ID:-}"
ENV_FILE="${HOME}/.openclaw/openclaw.env"
if [ -z "$_NODE_ID" ] && [ -f "$ENV_FILE" ]; then
  _NODE_ID="$(sed -n 's/^[[:space:]]*OPENCLAW_NODE_ID[[:space:]]*=//p' "$ENV_FILE" | tail -n 1 | tr -d "\"'[:space:]")"
fi
[ -n "$_NODE_ID" ] || _NODE_ID="$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
STATE="${WORKSPACE}/.daemon-state-${_NODE_ID}.md"
if [ -f "$STATE" ]; then
  echo "Session state:"
  cat "$STATE"
  echo ""
fi

# Last session recap (first 15 lines)
RECAP="${WORKSPACE}/memory/last-session-recap.md"
if [ -f "$RECAP" ]; then
  echo "Last session recap:"
  head -15 "$RECAP"
fi

exit 0
