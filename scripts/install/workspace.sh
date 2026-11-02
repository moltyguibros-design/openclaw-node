# ============================================================
# Step 2: Directory Structure
# ============================================================

step "Step 2: Directory Structure"

DIRS=(
  "$OPENCLAW_ROOT"
  "$OPENCLAW_ROOT/config"
  "$OPENCLAW_ROOT/services"
  "$OPENCLAW_ROOT/souls"
  "$OPENCLAW_ROOT/cron"
  "$OPENCLAW_ROOT/devices"
  "$OPENCLAW_ROOT/logs"
  "$OPENCLAW_ROOT/agents/main/sessions"
  "$WORKSPACE"
  "$WORKSPACE/.tmp"
  "$WORKSPACE/.tmp/active-sessions"
  "$WORKSPACE/memory"
  "$WORKSPACE/memory/archive"
  "$WORKSPACE/.learnings"
  "$WORKSPACE/.boot"
  "$WORKSPACE/bin"
  "$WORKSPACE/bin/hooks"
  "$WORKSPACE/bin/lib"
  "$WORKSPACE/skills"
  "$WORKSPACE/projects"
  "$WORKSPACE/memory-vault"
)

for dir in "${DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    run mkdir -p "$dir"
    info "Created $dir"
  fi
done
info "Directory structure ready"

# ============================================================
# Step 3: Copy bin/ scripts
# ============================================================

step "Step 3: Install Workspace Scripts"

if ! $DRY_RUN && [ "$(uname -s)" = Darwin ]; then
  _timer_copy_lock="$OPENCLAW_ROOT/timer-source-copy.lock"
  (umask 077; : >> "$_timer_copy_lock")
  exec 9>>"$_timer_copy_lock"
  if ! /usr/bin/lockf -s -t 0 9; then
    error "Timer source handoff holds the workspace copy lock"
    exit 1
  fi
  if [ -e "$OPENCLAW_ROOT/timer-transition-active" ] || [ -e "$OPENCLAW_ROOT/timer-entry-installed" ]; then
    error "Timer entry handoff is active or installed; use its reviewed update path"
    exit 1
  fi
fi

run rsync -av --exclude='*.bak' --exclude='*.bak.*' --exclude='routing-eval-tests.json' \
  "$REPO_DIR/workspace-bin/" "$WORKSPACE/bin/"
# The node-watch/acceptance service units exec ${OPENCLAW_WORKSPACE}/bin/node-watch.mjs —
# these live in repo bin/ (not workspace-bin/) and must land at that path too.
# openclaw-notify.mjs rides along: the viewer, the notify shim, and node-watch
# all resolve it next to themselves (or at ../bin/) in the deployed tree.
# -ef guard: when the workspace copy is a symlink/same inode as the repo file
# (live-dev setups), macOS cp exits 1 ("are identical") and set -e kills the
# install (observed 2026-07-14 on the VM). Same file = already deployed = skip.
for _wsbin in node-watch.mjs node-acceptance.mjs openclaw-notify.mjs \
              obsidian-graph-cache.mjs observer.mjs consolidation-scheduler.mjs \
              hyperagent.mjs embed-probe.mjs scheduler-heartbeat.mjs \
              mc-session-init.mjs nats-legacy-lock.py; do
  if [ ! "$REPO_DIR/bin/$_wsbin" -ef "$WORKSPACE/bin/$_wsbin" ]; then
    run cp "$REPO_DIR/bin/$_wsbin" "$WORKSPACE/bin/$_wsbin"
  fi
done
run chmod +x "$WORKSPACE/bin/"*
run chmod +x "$WORKSPACE/bin/hooks/"* 2>/dev/null || true
info "Workspace scripts installed to $WORKSPACE/bin/"

# Shared libs → ~/.openclaw/workspace/lib/  (workspace daemons import from ../lib/)
# mcp-knowledge MUST be included — memory-daemon.mjs statically imports it;
# excluding it killed every fresh install (2026-07-11 audit).
run mkdir -p "$WORKSPACE/lib"
run rsync -av --exclude='node_modules' \
  "$REPO_DIR/lib/" "$WORKSPACE/lib/"
info "Shared libraries installed to $WORKSPACE/lib/ (incl. mcp-knowledge)"

# Event schemas — local-event-log.mjs imports ../packages/event-schemas/dist;
# without it the daemon's event spine silently degrades off (2026-07-11 boot test)
if [ -d "$REPO_DIR/packages" ]; then
  run rsync -av --exclude='node_modules' "$REPO_DIR/packages/" "$WORKSPACE/packages/"
  info "Event schemas installed to $WORKSPACE/packages/"
fi

OPENCLAW_MESH_HOME="${OPENCLAW_MESH_HOME:-$OPENCLAW_RUNTIME_DIR}"
MESH_NM="$OPENCLAW_RUNTIME_DIR/node_modules"
WS_NM="$WORKSPACE/node_modules"
link_dependency_tree() {
  local src="$1" dest="$2"
  if $DRY_RUN; then
    info "[dry-run] would bind $dest to the independent runtime dependency tree"
  else
    "$NODE_BIN" "$REPO_DIR/bin/deploy-runtime.mjs" --source "$src" --root "$OPENCLAW_ROOT" --bind "$dest"
  fi
}
link_dependency_tree "$MESH_NM" "$WS_NM"

MESH_BIN="$OPENCLAW_MESH_HOME/bin"
MESH_LIB="$OPENCLAW_MESH_HOME/lib"
if [ ! "$REPO_DIR/bin" -ef "$MESH_BIN" ]; then
  if [ -e "$OPENCLAW_MESH_HOME/.git" ]; then
    error "Configured mesh home is a Git checkout; select a separate managed runtime before updating"
    exit 1
  fi
  run mkdir -p "$MESH_BIN" "$MESH_LIB"
  run rsync -av "$REPO_DIR/bin/" "$MESH_BIN/"
  run rsync -av --exclude='node_modules' "$REPO_DIR/lib/" "$MESH_LIB/"
fi
MESH_HOME_NM="$OPENCLAW_MESH_HOME/node_modules"
link_dependency_tree "$MESH_NM" "$MESH_HOME_NM"
info "Runtime code and dependencies selected from $OPENCLAW_RUNTIME_DIR"

# ============================================================
# Step 4: Copy Identity Files
# ============================================================

step "Step 4: Identity Files"

for f in CLAUDE.md SOUL.md PRINCIPLES.md AGENTS.md DELEGATION.md HEARTBEAT.md MEMORY_SPEC.md TOOLS.md; do
  if [ -f "$REPO_DIR/identity/$f" ]; then
    if [ ! -f "$WORKSPACE/$f" ]; then
      run cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f"
      info "Installed $f"
    elif ! diff -q "$WORKSPACE/$f" "$REPO_DIR/identity/$f" >/dev/null 2>&1; then
      run cp "$REPO_DIR/identity/$f" "$WORKSPACE/$f.repo"
      warn "$f differs from repo — saved repo version as $f.repo (merge manually)"
    else
      info "$f up to date"
    fi
  fi
done

# ============================================================
# Step 5: Copy Souls
# ============================================================

step "Step 5: Soul Definitions"

run rsync -av "$REPO_DIR/souls/" "$OPENCLAW_ROOT/souls/"
info "Souls installed to $OPENCLAW_ROOT/souls/"

# ============================================================
# Step 6: Copy Skills
# ============================================================

step "Step 6: Skills"

run rsync -av --exclude='dist/' --exclude='scripts/' "$REPO_DIR/skills/" "$WORKSPACE/skills/"
info "Skills installed to $WORKSPACE/skills/ ($(ls -d "$REPO_DIR/skills"/*/ 2>/dev/null | grep -v dist | grep -v scripts | wc -l | tr -d ' ') skills)"

# Install skill-specific dependencies (npm/pip where needed)
if $SANDBOX; then
  info "Sandbox: skipping skill dependencies"
else
info "Installing skill dependencies..."
for skill_dir in "$WORKSPACE/skills"/*/; do
  skill_name=$(basename "$skill_dir")
  # npm-based skills
  if [ -f "$skill_dir/package.json" ] && [ ! -d "$skill_dir/node_modules" ]; then
    (cd "$skill_dir" && run npm install --production 2>/dev/null) && info "  npm: $skill_name" || warn "  npm failed: $skill_name"
  fi
  # pip-based skills
  if [ -f "$skill_dir/requirements.txt" ]; then
    run pip3 install --user -r "$skill_dir/requirements.txt" 2>/dev/null || warn "  pip failed: $skill_name"
    info "  pip: $skill_name"
  fi
done
fi
