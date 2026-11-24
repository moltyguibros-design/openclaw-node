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

# Every other enabled source in the registry the memory daemon ingests from,
# into sources/<name>/. Sources under the two roots above are already covered.
REGISTRY="$HOME/.openclaw/config/transcript-sources.json"
registry_failed=0
if [ -f "$REGISTRY" ]; then
  if listed=$(python3 -I -S -c '
import json, os, re, sys
home = os.path.expanduser("~")
covered = [os.path.join(home, ".claude", "projects"), os.path.join(home, ".openclaw", "agents", "main", "sessions")]
with open(sys.argv[1]) as f:
    sources = json.load(f).get("sources") or []
for s in sources:
    if not isinstance(s, dict) or s.get("enabled") is False or not isinstance(s.get("path"), str):
        continue
    p = s["path"]
    p = os.path.join(home, p[1:].lstrip("/")) if p.startswith("~") else p
    p = os.path.normpath(p)
    if not os.path.isabs(p) or any(c in p for c in "\t\n"):
        continue
    if any(p == c or p.startswith(c + os.sep) for c in covered):
        continue
    name = re.sub(r"[^A-Za-z0-9._-]", "_", str(s.get("name") or "")).strip(".") or "unnamed"
    print(name + "\t" + p)
' "$REGISTRY"); then
    tab=$(printf '\t')
    while IFS="$tab" read -r name dir; do
      [ -n "$dir" ] || continue
      mkdir -p "$ARCHIVE/sources/$name"
      archive "$dir/" "$ARCHIVE/sources/$name/"
    done <<EOF
$listed
EOF
  else
    registry_failed=1
  fi
fi

ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
if [ "$failed" -ne 0 ]; then
  echo "$ts  archive FAILED (rsync rc=$failed)" >> "$LOG"
  echo "archive FAILED (rsync rc=$failed)" >&2
  exit 1
fi
if [ "$registry_failed" -ne 0 ]; then
  echo "$ts  archive FAILED (unreadable $REGISTRY)" >> "$LOG"
  echo "archive FAILED (unreadable $REGISTRY)" >&2
  exit 1
fi
count=$(find "$ARCHIVE/claude-projects" "$ARCHIVE/gateway-sessions" "$ARCHIVE/sources" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
size=$(du -sh "$ARCHIVE" 2>/dev/null | cut -f1)
echo "$ts  archived ok — $count transcripts, $size total" >> "$LOG"
