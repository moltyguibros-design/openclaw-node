# ============================================================
# Helpers
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*"; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

run() {
  if $DRY_RUN; then
    echo "  [dry-run] $*"
    # Verify source paths exist for cp/rsync commands (catches path bugs)
    case "$1" in
      cp)
        if [ ! -e "$2" ]; then
          error "[dry-run] SOURCE MISSING: $2"
          DRY_RUN_ERRORS=$((${DRY_RUN_ERRORS:-0} + 1))
        fi
        ;;
      rsync)
        # rsync source is the last arg before the destination
        local src="${@:(-2):1}"
        if [ ! -e "${src%/}" ] && [ ! -d "${src%/}" ]; then
          error "[dry-run] SOURCE MISSING: ${src}"
          DRY_RUN_ERRORS=$((${DRY_RUN_ERRORS:-0} + 1))
        fi
        ;;
    esac
  else
    "$@"
  fi
}
DRY_RUN_ERRORS=0

# Heredoc-safe writer (review P4-3): `write_file "$dest" <<EOF … EOF`. The
# raw `cat > "$dest" <<EOF` form bypassed run()'s dry-run guard, so
# --dry-run was rewriting MEMORY.md, active-tasks.md, .env.local and the
# notification config on real installs. Dry-run prints and discards.
# set_env_key VAR VALUE [FILE] — set or replace one KEY=value line in an env
# file (default $ENV_FILE). Idempotent; honours --dry-run through run().
set_env_key() {
  local var="$1" value="$2" file="${3:-$ENV_FILE}"
  if grep -q "^${var}=" "$file" 2>/dev/null; then
    run sed -i.bak "s|^${var}=.*|${var}=${value}|" "$file" && run rm -f "$file.bak"
  elif [ "${DRY_RUN:-false}" = true ]; then
    echo "  [dry-run] would set ${var}=${value} in ${file}"
  else
    echo "${var}=${value}" >> "$file"
  fi
}

write_file() {
  local dest="$1"
  if $DRY_RUN; then
    echo "  [dry-run] would write $dest"
    cat >/dev/null
  else
    cat > "$dest"
  fi
}

detect_os() {
  case "$(uname -s)" in
    Darwin)  echo "macos" ;;
    Linux)   echo "linux" ;;
    *)       echo "unknown" ;;
  esac
}

OS=$(detect_os)

trim_env_field() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_file() {
  local file="$1" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" = *=* ]] || continue
    key="$(trim_env_field "${line%%=*}")"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(trim_env_field "${line#*=}")"
    if [ "${#value}" -ge 2 ]; then
      case "$value" in
      \"*\") value="${value:1:${#value}-2}" ;;
      \'*\') value="${value:1:${#value}-2}" ;;
      esac
    fi
    export "$key=$value"
  done < "$file"
}

saved_unit_role() {
  local unit
  if [ "$OS" = linux ]; then
    unit="${OPENCLAW_SYSTEMD_DIR:-$HOME/.config/systemd/user}/openclaw-mesh-deploy-listener.service"
  else
    unit="$HOME/Library/LaunchAgents/ai.openclaw.mesh-deploy-listener.plist"
  fi
  [ -f "$unit" ] || return 0
  "$NODE_BIN" -e '
    const text = require("fs").readFileSync(process.argv[1], "utf8");
    const match = text.match(/^Environment=["\x27]?OPENCLAW_NODE_ROLE=(lead|worker)["\x27]?\s*$/m)
      || text.match(/<key>OPENCLAW_NODE_ROLE<\/key>\s*<string>(lead|worker)<\/string>/);
    if (match) process.stdout.write(match[1]);
  ' "$unit"
}

backup_installer_config() {
  local relative source destination=""
  if $DRY_RUN; then
    info "[dry-run] would privately back up existing installer configuration"
    return
  fi
  for relative in openclaw.env openclaw.json config/daemon.json config/transcript-sources.json \
    config/obsidian-sync.json config/notify.json config/nats.conf config/nats-1.conf \
    config/nats-2.conf config/nats-3.conf config/nats-auth.conf config/nats-writer-cohort.json; do
    source="$OPENCLAW_ROOT/$relative"
    [ -f "$source" ] || continue
    if [ -z "$destination" ]; then
      (umask 077; mkdir -p "$OPENCLAW_ROOT/config-backups")
      destination="$(mktemp -d "$OPENCLAW_ROOT/config-backups/install-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
      chmod 700 "$destination"
    fi
    (umask 077; mkdir -p "$destination/$(dirname "$relative")")
    cp "$source" "$destination/$relative"
    chmod 600 "$destination/$relative"
  done
  if [ -n "$destination" ]; then
    info "Private configuration backup: $destination"
  fi
}


_INSTALLER_LOCK_PATH=""
_INSTALLER_LOCK_HELD=false

installer_exit_cleanup() {
  local result=$?
  if [ -n "${PENDING_CLUSTER_DIR:-}" ]; then
    rm -rf "$PENDING_CLUSTER_DIR" || warn "Could not clean the owned cluster candidate: $PENDING_CLUSTER_DIR"
  fi
  if $_INSTALLER_LOCK_HELD; then
    if [ ! -e "$_INSTALLER_LOCK_PATH/owner.txt" ]; then
      rmdir "$_INSTALLER_LOCK_PATH" 2>/dev/null || warn "Installer lock retained: $_INSTALLER_LOCK_PATH"
    elif grep -Fxq "pid=$$" "$_INSTALLER_LOCK_PATH/owner.txt" &&
      grep -Fxq "nonce=${OPENCLAW_INSTALLER_LOCK_NONCE:-}" "$_INSTALLER_LOCK_PATH/owner.txt"; then
      rm -f "$_INSTALLER_LOCK_PATH/owner.txt"
      rmdir "$_INSTALLER_LOCK_PATH" 2>/dev/null || warn "Installer lock contains unexpected files; retained: $_INSTALLER_LOCK_PATH"
    else
      warn "Installer lock ownership changed; retained: $_INSTALLER_LOCK_PATH"
    fi
  fi
  return "$result"
}

acquire_installer_lock() {
  if $DRY_RUN; then
    info "[dry-run] would acquire the installer lock"
    return
  fi
  (umask 077; mkdir -p "$OPENCLAW_ROOT")
  _INSTALLER_LOCK_PATH="$OPENCLAW_ROOT/.installer-lock"
  if ! (umask 077; mkdir "$_INSTALLER_LOCK_PATH") 2>/dev/null; then
    error "Another or interrupted installer owns $_INSTALLER_LOCK_PATH; reconcile its owner record before continuing"
    return 1
  fi
  _INSTALLER_LOCK_HELD=true
  PENDING_CLUSTER_DIR=""
  trap installer_exit_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export OPENCLAW_INSTALLER_LOCK_PID="$$"
  export OPENCLAW_INSTALLER_LOCK_NONCE="$$-$RANDOM-$RANDOM"
  (umask 077; printf '%s\n' "pid=$$" "nonce=$OPENCLAW_INSTALLER_LOCK_NONCE" "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)" "source=$REPO_DIR" > "$_INSTALLER_LOCK_PATH/owner.txt")
}
