#!/usr/bin/env bash
# pre-compact.sh — Claude Code PreCompact hook: asks the memory daemon to
# extract before context is compacted (publishes mesh.memory.extract_request
# through bin/openclaw-extract-now.mjs).

set -uo pipefail

# A deployed copy (workspace/.claude/hooks) has no checkout around it: the
# installer writes the checkout's path here when it deploys this hook.
DEPLOYED_REPO_DIR=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${OPENCLAW_REPO_DIR:-${DEPLOYED_REPO_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}}"
CLI="$REPO_DIR/bin/openclaw-extract-now.mjs"
[ -f "$CLI" ] || exit 0

# Detached and silent: compaction must never wait on, or fail because of, the bus.
nohup node "$CLI" --triggered-by=claude-code-pre-compact >/dev/null 2>&1 &

exit 0
