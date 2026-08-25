# ============================================================
# Step 1: System Dependencies
# ============================================================
#
# Delegates to scripts/install/prereqs.sh, which is the single implementation
# for both platforms.
#
# What used to live here silently lied on macOS: Git, SQLite3 and curl sat in
# `if [ "$OS" = "linux" ]` blocks with no else branch, so they no-opped without
# a warning; build tools were never checked at all (which is why better-sqlite3
# would fail to compile much later with an unrelated-looking error); and
# Node/Python just `exit 1`. On Linux, `apt-get update` ran only inside the
# node-missing branch, so a box already carrying Node 22 installed against stale
# package lists and died mid-run under `set -e`.
#
# prereqs.sh gates on whether each BINARY is actually on PATH, never on the
# package manager's exit code, and returns non-zero if anything is still absent.

if ! $UPDATE_ONLY; then
  step "Step 1: System Dependencies"

  PREREQ_SCRIPT="$REPO_DIR/scripts/install/prereqs.sh"

  if [ ! -f "$PREREQ_SCRIPT" ]; then
    error "missing $PREREQ_SCRIPT — package is incomplete"
    exit 1
  fi

  if $DRY_RUN; then
    info "[dry-run] would run: bash $PREREQ_SCRIPT"
    info "[dry-run] checking current state instead (installs nothing):"
    OPENCLAW_SKIP_LLM=$($SKIP_LLM && echo 1 || echo 0) \
      bash "$PREREQ_SCRIPT" --check || warn "[dry-run] prerequisites are NOT satisfied on this machine"
  else
    if ! OPENCLAW_SKIP_LLM=$($SKIP_LLM && echo 1 || echo 0) bash "$PREREQ_SCRIPT"; then
      error "System dependencies are incomplete — refusing to continue."
      error "A partial install is what produces the 'it said it worked' failures."
      echo ""
      if [ "$OS" = "macos" ]; then
        error "On a machine with nothing on it (no Homebrew, no Node), run the"
        error "one-command bootstrap instead, which installs Homebrew first:"
        echo ""
        echo "    curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/bootstrap.sh | bash"
      else
        error "Re-run after resolving the items above, or use the one-command bootstrap:"
        echo ""
        echo "    curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/bootstrap.sh | bash"
      fi
      echo ""
      exit 1
    fi
    info "All system dependencies verified present"
  fi
fi
