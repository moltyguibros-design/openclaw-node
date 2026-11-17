#!/usr/bin/env bash
# openclaw-restart.sh — restart the memory daemon and the health watch through
# their service manager (launchd on macOS, systemd user units on Linux).
#
# Usage:
#   bin/openclaw-restart.sh           # restart both
#   bin/openclaw-restart.sh --status  # show status only
#
# For the whole stack use `openclaw-stack down/up`.

set -euo pipefail

LABELS=(
  "ai.openclaw.memory-daemon"
  "ai.openclaw.health-watch"
)

OS="$(uname -s)"

unit_for() {
  echo "openclaw-${1#ai.openclaw.}.service"
}

status_launchd() {
  local label="$1"
  if launchctl list "$label" >/dev/null 2>&1; then
    local pid
    # `launchctl list <label>` prints a dict, not the table row; the PID line is
    # absent when the job is not running.
    pid=$(launchctl list "$label" 2>/dev/null | sed -n 's/.*"PID"[[:space:]]*=[[:space:]]*\([0-9][0-9]*\);.*/\1/p')
    if [ -n "$pid" ]; then
      echo "running (pid=$pid)"
    else
      echo "registered (not running)"
    fi
  else
    echo "not registered"
  fi
}

status_systemd() {
  local unit out load active pid
  unit="$(unit_for "$1")"
  if ! out=$(systemctl --user show -p LoadState -p ActiveState -p MainPID -- "$unit" 2>/dev/null); then
    echo "unobservable (systemctl --user failed)"
    return
  fi
  load=$(printf '%s\n' "$out" | sed -n 's/^LoadState=//p')
  active=$(printf '%s\n' "$out" | sed -n 's/^ActiveState=//p')
  pid=$(printf '%s\n' "$out" | sed -n 's/^MainPID=//p')
  if [ "$load" != "loaded" ]; then
    echo "not installed"
  elif [ "$active" = "active" ] && [ -n "$pid" ] && [ "$pid" != "0" ]; then
    echo "running (pid=$pid)"
  else
    echo "installed ($active)"
  fi
}

show_status() {
  echo "=== OpenClaw memory daemon + health watch ==="
  echo ""
  for label in "${LABELS[@]}"; do
    case "$OS" in
      Darwin) printf "  %-45s %s\n" "$label" "$(status_launchd "$label")" ;;
      *)      printf "  %-45s %s\n" "$(unit_for "$label")" "$(status_systemd "$label")" ;;
    esac
  done
  echo ""
}

restart_all() {
  local failed=0
  echo "=== Restarting ==="
  for label in "${LABELS[@]}"; do
    case "$OS" in
      Darwin)
        if launchctl kickstart -k "gui/$(id -u)/$label"; then
          echo "  $label restarted (launchctl kickstart -k)"
        else
          echo "  $label: kickstart failed (not loaded?)" >&2
          failed=1
        fi
        ;;
      *)
        if systemctl --user restart -- "$(unit_for "$label")"; then
          echo "  $(unit_for "$label") restarted (systemctl --user restart)"
        else
          echo "  $(unit_for "$label"): restart failed (not installed?)" >&2
          failed=1
        fi
        ;;
    esac
  done
  echo ""
  show_status
  return "$failed"
}

if [ "$OS" != "Darwin" ] && [ "$OS" != "Linux" ]; then
  echo "openclaw-restart.sh: unsupported OS $OS (launchd or systemd required)" >&2
  exit 1
fi

case "${1:-restart}" in
  --status|-s|status)
    show_status
    ;;
  restart|--restart)
    restart_all
    ;;
  *)
    echo "Usage: openclaw-restart.sh [--status | restart]" >&2
    exit 1
    ;;
esac
