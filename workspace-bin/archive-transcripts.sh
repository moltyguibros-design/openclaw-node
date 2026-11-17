#!/bin/sh
# Append-only archive of conversation transcripts.
# Guards against Claude Code's 30-day cleanup + gateway session pruning.
# rsync WITHOUT --delete: only ever adds/updates the archive, never removes.
set -eu
ARCHIVE="$HOME/.openclaw/transcript-archive"
LOG="$ARCHIVE/archive.log"
mkdir -p "$ARCHIVE/claude-projects" "$ARCHIVE/gateway-sessions"
failed=0

# rsync 23/24 (partial transfer, files vanished mid-copy) is normal while
# sessions are being written; anything else means the archive did not happen.
archive() {
  [ -d "$1" ] || return 0
  rc=0
  rsync -a -m --include='*/' --include='*.jsonl' --exclude='*' "$1" "$2" || rc=$?
  case "$rc" in 0|23|24) ;; *) failed=$rc ;; esac
}

# Claude Code transcripts (every project slug), .jsonl only
archive "$HOME/.claude/projects/" "$ARCHIVE/claude-projects/"

# OpenClaw gateway sessions
archive "$HOME/.openclaw/agents/main/sessions/" "$ARCHIVE/gateway-sessions/"

ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
if [ "$failed" -ne 0 ]; then
  echo "$ts  archive FAILED (rsync rc=$failed)" >> "$LOG"
  echo "archive FAILED (rsync rc=$failed)" >&2
  exit 1
fi
count=$(find "$ARCHIVE/claude-projects" "$ARCHIVE/gateway-sessions" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
size=$(du -sh "$ARCHIVE" 2>/dev/null | cut -f1)
echo "$ts  archived ok — $count transcripts, $size total" >> "$LOG"
