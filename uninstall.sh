#!/usr/bin/env bash
# uninstall.sh — Remove OpenClaw Node installation
#
# Usage:
#   bash uninstall.sh              # Remove services and scripts (keep data)
#   bash uninstall.sh --purge      # Also remove the toolkit's data; asks again before OpenClaw's own files

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$(uname -s)" = Darwin ]; then
  NATS_WRITER_LOCK=/private/var/db/openclaw-nats-writer.lock
  if [ -e "$NATS_WRITER_LOCK" ] || [ -L "$NATS_WRITER_LOCK" ]; then
    if [ -n "${OPENCLAW_NATS_LEGACY_LOCK_HELD:-}" ] &&
       /usr/bin/python3 "$REPO_DIR/bin/nats-legacy-lock.py" --verify >/dev/null 2>&1; then
      unset OPENCLAW_NATS_LEGACY_REEXEC_ATTEMPT
    else
      if [ "${OPENCLAW_NATS_LEGACY_REEXEC_ATTEMPT:-}" = 1 ]; then
        echo 'legacy writer lock verification failed after re-exec' >&2
        exit 1
      fi
      unset OPENCLAW_NATS_LEGACY_LOCK_HELD
      export OPENCLAW_NATS_LEGACY_REEXEC_ATTEMPT=1
      exec /usr/bin/python3 "$REPO_DIR/bin/nats-legacy-lock.py" -- /bin/bash "$REPO_DIR/uninstall.sh" "$@"
    fi
  fi
  /usr/bin/python3 "$REPO_DIR/bin/nats-legacy-lock.py" --check-marker
fi

OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/.openclaw}"
WORKSPACE="$OPENCLAW_ROOT/workspace"
BOOTSTRAP_SRC="$HOME/.openclaw-src/openclaw-node"
# bootstrap.sh keeps .old when install.sh fails and leaves .new after a cut download.
BOOTSTRAP_TREES=("$BOOTSTRAP_SRC" "$BOOTSTRAP_SRC.old" "$BOOTSTRAP_SRC.new")
PURGE=false

for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }

echo ""
echo "OpenClaw Node Uninstaller"
echo ""

# ~/.openclaw is shared with the OpenClaw gateway, which stays installed: --purge removes
# only what the toolkit writes there and asks again before the rest (credentials,
# pairings, agents and their sessions, openclaw.json).
TOOLKIT_PATHS=(
  workspace config services souls logs nats rules plan-templates share notifications foreman
  retired 'skills.retired-*' transcript-archive preservation roles eval worktrees mesh-leases
  obsidian-local artifacts run backups .tmp harness
  'state.db' 'state.db-*' 'graph-cache.db' 'graph-cache.db-*' openclaw.env harness-rules.json
  identity.key identity-registry.json .mesh-secret mesh-aliases.json mesh-providers.json
  dogfood-metrics.jsonl 'watcher.jsonl' 'watcher.jsonl.1' .deploy-state.json .last-deploy.json
  .embed-migration-checkpoint.json '.node-watch.*' .node-acceptance.md .install-acceptance.md
  timer-transition-active timer-source-copy.lock timer-entry-installed
  skills/mesh state/observer.jsonl state/memory-activity.jsonl state/observer-logpos.json
)

if $PURGE; then
  PURGE_TARGETS=("$OPENCLAW_ROOT (the toolkit's files)" "$HOME/openclaw")
  for tree in "${BOOTSTRAP_TREES[@]}"; do
    if [ -d "$tree" ]; then PURGE_TARGETS+=("$tree"); fi
  done
  warn "PURGE mode: this deletes:"
  for target in "${PURGE_TARGETS[@]}"; do echo "    $target"; done
  echo "The OpenClaw gateway's own files in $OPENCLAW_ROOT are asked about separately."
  echo ""
  read -r -p "Are you sure? [y/N] " confirm || confirm=""
  case "$confirm" in
    y|Y) ;;
    *) info "Aborted, nothing changed."; exit 0 ;;
  esac
fi

# Stop and remove services
OS="$(uname -s)"
LEGACY=()
if [ "$OS" = "Linux" ]; then
  # --- Current services: openclaw-*.service under user systemd ---
  SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
  if [ -d "$SYSTEMD_USER_DIR" ]; then
    for unit in "$SYSTEMD_USER_DIR"/openclaw-*.service "$SYSTEMD_USER_DIR"/openclaw-*.timer; do
      [ -f "$unit" ] || continue
      UNIT_NAME="$(basename "$unit")"
      info "Stopping $UNIT_NAME..."
      systemctl --user stop "$UNIT_NAME" 2>/dev/null || true
      systemctl --user disable "$UNIT_NAME" 2>/dev/null || true
      rm -f "$unit"
      info "Removed $UNIT_NAME"
    done
    systemctl --user daemon-reload 2>/dev/null || true
  fi
  if systemctl is-active --quiet openclaw-agent 2>/dev/null || [ -e /etc/systemd/system/openclaw-agent.service ]; then
    LEGACY+=("system service openclaw-agent (/etc/systemd/system/openclaw-agent.service)")
  fi
elif [ "$OS" = "Darwin" ]; then
  # --- Current services: ai.openclaw.*.plist under ~/Library/LaunchAgents ---
  LAUNCHD_AGENTS_DIR="$HOME/Library/LaunchAgents"
  if [ -d "$LAUNCHD_AGENTS_DIR" ]; then
    for plist in "$LAUNCHD_AGENTS_DIR"/ai.openclaw.*.plist; do
      [ -f "$plist" ] || continue
      PLIST_NAME="$(basename "$plist")"
      info "Unloading $PLIST_NAME..."
      launchctl unload "$plist" 2>/dev/null || true
      rm -f "$plist"
      info "Removed $PLIST_NAME"
    done
  fi
  if [ -e /Library/LaunchDaemons/com.openclaw.agent.plist ]; then
    LEGACY+=("LaunchDaemon com.openclaw.agent (/Library/LaunchDaemons/com.openclaw.agent.plist)")
  fi
fi
for cmd in mesh mesh-health mesh-repair; do
  if [ -L "/usr/local/bin/$cmd" ]; then
    LEGACY+=("symlink /usr/local/bin/$cmd -> $(readlink "/usr/local/bin/$cmd")")
  fi
done
if [ -e /etc/sudoers.d/openclaw-mesh ]; then
  LEGACY+=("sudoers fragment /etc/sudoers.d/openclaw-mesh")
fi
# The retired openclaw-mesh setup.sh created these as root; the runbook retires them with
# the checks (target, visudo, open root shell) a blind removal would skip.
if [ "${#LEGACY[@]}" -gt 0 ]; then
  warn "Legacy openclaw-mesh leftovers found, left in place:"
  for item in "${LEGACY[@]}"; do echo "    $item"; done
  warn "Retire them by hand: $REPO_DIR/memory-plan/plans/node-state-recovery/audits/step12_jetstream/LEGACY_AGENT_RETIREMENT_RUNBOOK.md"
fi

# The stack launchers live outside $OPENCLAW_ROOT, so --purge does not reach them either.
rm -rf "$HOME/Applications/OpenClaw Stack.app"
rm -f "$HOME/.local/share/applications/openclaw-stack.desktop"

if $PURGE; then
  shopt -s nullglob dotglob
  for pattern in "${TOOLKIT_PATHS[@]}"; do
    for entry in "$OPENCLAW_ROOT"/$pattern; do rm -rf "$entry"; done
  done
  rmdir "$OPENCLAW_ROOT/skills" "$OPENCLAW_ROOT/state" 2>/dev/null || true
  info "Removed the toolkit's files from $OPENCLAW_ROOT"
  rm -rf "$HOME/openclaw"
  info "Removed $HOME/openclaw (mesh shared folder + agent)"
  for tree in "${BOOTSTRAP_TREES[@]}"; do
    if [ -d "$tree" ]; then
      rm -rf "$tree"
      info "Removed $tree (bootstrap source tree)"
    fi
  done
  rmdir "$HOME/.openclaw-src" 2>/dev/null || true
  REMAINING=("$OPENCLAW_ROOT"/*)
  shopt -u nullglob dotglob
  if [ "${#REMAINING[@]}" -eq 0 ]; then
    rmdir "$OPENCLAW_ROOT" 2>/dev/null || true
    info "Removed $OPENCLAW_ROOT"
  else
    echo ""
    warn "Still in $OPENCLAW_ROOT: the OpenClaw gateway's own files (credentials, pairings, agents and sessions, openclaw.json) and anything else the toolkit did not write:"
    for entry in "${REMAINING[@]}"; do echo "    ${entry#"$OPENCLAW_ROOT"/}"; done
    read -r -p "Delete these too? OpenClaw then needs setting up again. [y/N] " confirm_product || confirm_product=""
    case "$confirm_product" in
      y|Y) rm -rf "$OPENCLAW_ROOT"; info "Removed $OPENCLAW_ROOT" ;;
      *) info "Kept OpenClaw's own files in $OPENCLAW_ROOT" ;;
    esac
  fi
else
  info "Removing scripts and services (keeping memory data)..."
  rm -rf "$WORKSPACE/bin"
  # The scanner gate installs ClawHub skills into the same dir install.sh copies the repo's into.
  KEPT_SKILLS=()
  if [ -d "$WORKSPACE/skills" ]; then
    for skill in "$REPO_DIR/skills"/*/; do
      name="$(basename "$skill")"
      case "$name" in dist|scripts|_quarantine) continue ;; esac
      rm -rf "${WORKSPACE:?}/skills/$name"
    done
    # A skill the repo quarantined or deleted stays installed until an update retires it.
    while read -r group name; do
      [ "$group" = skills ] || continue
      case "$name" in ''|/*|.*|*/.*|*..*|*/|*/*/*|*.bak*) continue ;; esac
      rm -rf "${WORKSPACE:?}/skills/$name"
    done < "$REPO_DIR/scripts/install/retired-files.txt"
    for skill in "$WORKSPACE/skills"/*; do
      if [ -e "$skill" ]; then KEPT_SKILLS+=("$(basename "$skill")"); fi
    done
    rmdir "$WORKSPACE/skills" 2>/dev/null || true
  fi
  rm -rf "$WORKSPACE/projects/mission-control/node_modules"
  rm -rf "$WORKSPACE/projects/mission-control/.next"
  rm -rf "$WORKSPACE/.boot"
  rm -rf "$WORKSPACE/lib" "$WORKSPACE/packages" "$WORKSPACE/node_modules"
  rm -rf "$HOME/openclaw/bin" "$HOME/openclaw/lib"
  rm -rf "$HOME/.openclaw/skills/mesh"
  info "Removed scripts, repo-shipped skills, mesh CLI, and build artifacts"
  if [ "${#KEPT_SKILLS[@]}" -gt 0 ]; then
    info "Kept operator-installed skills in $WORKSPACE/skills: ${KEPT_SKILLS[*]}"
  fi
  info "Memory data preserved at $WORKSPACE/memory/"
  info "Run with --purge to remove the toolkit's data too"
fi

echo ""
info "Uninstall complete."
