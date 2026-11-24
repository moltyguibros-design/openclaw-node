#!/usr/bin/env bash
set -euo pipefail

if ! command -v openclaw >/dev/null 2>&1; then
  echo "ERROR: openclaw CLI not found"
  exit 1
fi

echo "== Channel Triage Snapshot =="
echo "Timestamp: $(date)"

printf '\n[1/3] Deep status\n'
openclaw status --deep || true

printf '\n[2/3] Recent Discord/Telegram log lines\n'
openclaw logs --limit 250 --plain --max-bytes 500000 \
  | grep -Ei "discord|telegram|gateway/channels|unresolved|allowlist|reconnect|code 1005|code 1006" \
  | tail -n 120 || true

printf '\n[3/3] Key hints\n'
echo "- If you see 'discord channels unresolved', verify exact channel label/ID."
echo "- If probes are OK but no replies, check dm/guild allowlists."
echo "- If repeated 1005/1006, restart once and retest after stable PID."
