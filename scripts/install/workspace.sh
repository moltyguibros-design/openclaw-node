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
# Transcripts, state.db and memory live under here, and only the owner's units read them.
run chmod 700 "$OPENCLAW_ROOT"
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
# consolidate.mjs (consolidation-scheduler's import) and memory-subscriber.mjs +
# memory-promoter.mjs (the daemon's federation import) are siblings they load at runtime.
# health-watch.mjs is the openclaw-health-watch unit's entrypoint.
# -ef guard: when the workspace copy is a symlink/same inode as the repo file
# (live-dev setups), macOS cp exits 1 ("are identical") and set -e kills the
# install (observed 2026-07-14 on the VM). Same file = already deployed = skip.
for _wsbin in node-watch.mjs node-acceptance.mjs openclaw-notify.mjs \
              obsidian-graph-cache.mjs observer.mjs consolidation-scheduler.mjs \
              consolidate.mjs hyperagent.mjs embed-probe.mjs scheduler-heartbeat.mjs \
              memory-subscriber.mjs memory-promoter.mjs health-watch.mjs nats-legacy-lock.py; do
  if [ ! "$REPO_DIR/bin/$_wsbin" -ef "$WORKSPACE/bin/$_wsbin" ]; then
    run cp "$REPO_DIR/bin/$_wsbin" "$WORKSPACE/bin/$_wsbin"
  fi
done
retire_shipped_files workspace-bin "$WORKSPACE/bin"
run chmod +x "$WORKSPACE/bin/"*
run chmod +x "$WORKSPACE/bin/hooks/"* 2>/dev/null || true
info "Workspace scripts installed to $WORKSPACE/bin/"

# Consolidation fails its cycle without a promotion policy. The resolver's last
# fallback is lib/../config/promotion-policy.yaml, so the policy ships beside the
# workspace lib/ too (config.sh seeds ~/.openclaw/config, which it checks first).
run mkdir -p "$WORKSPACE/config"
if [ ! "$REPO_DIR/config/promotion-policy.yaml" -ef "$WORKSPACE/config/promotion-policy.yaml" ]; then
  run cp "$REPO_DIR/config/promotion-policy.yaml" "$WORKSPACE/config/promotion-policy.yaml"
fi
info "Promotion policy installed to $WORKSPACE/config/promotion-policy.yaml"

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

# Symlink shared deps from the repo node_modules (env.sh installed it) into the
# workspace node_modules (deps.sh link_dependency_tree). `nats` and `js-yaml`
# are required by the workspace daemons' import graph (2026-07-11 audit).
OPENCLAW_MESH_HOME="${OPENCLAW_MESH_HOME:-$HOME/openclaw}"
MESH_NM="$REPO_DIR/node_modules"
WS_NM="$WORKSPACE/node_modules"
link_dependency_tree "$MESH_NM" "$WS_NM"
info "Shared dependencies symlinked to $WS_NM/ ($LINKED_COUNT new links from $MESH_NM)"

# Mesh daemons and CLI tools → mesh home bin/
MESH_BIN="$OPENCLAW_MESH_HOME/bin"
MESH_LIB="$OPENCLAW_MESH_HOME/lib"
run mkdir -p "$MESH_BIN" "$MESH_LIB"
run rsync -av "$REPO_DIR/bin/" "$MESH_BIN/"
retire_shipped_files mesh-bin "$MESH_BIN"
run rsync -av --exclude='node_modules' "$REPO_DIR/lib/" "$MESH_LIB/"
run chmod +x "$MESH_BIN/"*.sh 2>/dev/null || true
info "Mesh daemons installed to $MESH_BIN/ ($(ls -1 "$REPO_DIR/bin/" | wc -l | tr -d ' ') files)"
info "Shared libraries installed to $MESH_LIB/"

MESH_HOME_NM="$OPENCLAW_MESH_HOME/node_modules"
if [ "$MESH_NM" != "$MESH_HOME_NM" ]; then
  link_dependency_tree "$MESH_NM" "$MESH_HOME_NM"
  info "Shared dependencies symlinked to $MESH_HOME_NM/ ($LINKED_COUNT new links from $MESH_NM)"
fi

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

# Evolved genes and evolution events are learned on the node; the repo copy only seeds a
# soul that has none (the same contract as mesh-deploy's souls seedOnly).
run rsync -av --exclude='/*/evolution/genes.json' --exclude='/*/evolution/events.jsonl' "$REPO_DIR/souls/" "$OPENCLAW_ROOT/souls/"
run rsync -a --ignore-existing "$REPO_DIR/souls/" "$OPENCLAW_ROOT/souls/"
info "Souls installed to $OPENCLAW_ROOT/souls/"

# Mission Control commits every approved evolution to this repo and refuses
# an approval when souls is not one; the local identity lets those commits
# succeed on a node with no global git user.
if [ ! -d "$OPENCLAW_ROOT/souls/.git" ]; then
  run git -C "$OPENCLAW_ROOT/souls" init -q -b main
  run git -C "$OPENCLAW_ROOT/souls" config user.name "OpenClaw Mission Control"
  run git -C "$OPENCLAW_ROOT/souls" config user.email "mission-control@openclaw.local"
  run git -C "$OPENCLAW_ROOT/souls" add -A
  run git -C "$OPENCLAW_ROOT/souls" commit -q -m "souls: installed state"
  info "Souls history initialized at $OPENCLAW_ROOT/souls/.git"
fi

# ============================================================
# Step 6: Copy Skills
# ============================================================

step "Step 6: Skills"

# Leading "/" anchors each exclude to skills/ itself: unanchored, 'scripts/' also dropped
# every skill's own scripts/ dir. _quarantine never ships (skills/_quarantine/README.md),
# matching mesh-deploy's skills component.
run rsync -av --exclude='/dist/' --exclude='/scripts/' --exclude='/_quarantine/' "$REPO_DIR/skills/" "$WORKSPACE/skills/"
info "Skills installed to $WORKSPACE/skills/ ($(ls -d "$REPO_DIR/skills"/*/ 2>/dev/null | grep -Ev '/(dist|scripts|_quarantine)/$' | wc -l | tr -d ' ') skills)"
# The rsync never deletes: a skill quarantined or removed from the repo stays
# installed, and agents keep following it, until retired-files.txt archives it.
retire_shipped_files skills "$WORKSPACE/skills"
# Files deleted from inside shipped skills, which the rsync never removes: an INSTALL.md
# that installed around the scanner gate, stale docs, and package.json files with no
# dependencies that made the npm loop below re-run on every --update (npm wrote the
# clawddocs lock there).
for f in moltbook-interact/INSTALL.md clawddocs/package.json clawddocs/package-lock.json \
  clawddocs/snippets/common-configs.md crypto-price/ARCHITECTURE.md \
  fast-browser-use/package.json fast-browser-use/package-lock.json fast-browser-use/CODEBUDDY.md \
  fast-browser-use/test_auth.json fast-browser-use/test_state.json \
  openclaw-skill-scanner/report-template.md; do
  run rm -f "$WORKSPACE/skills/$f"
done
run rmdir "$WORKSPACE/skills/clawddocs/snippets" 2>/dev/null || true

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
    # PEP 668 system Pythons (Ubuntu 24.04, Homebrew) refuse --user alone, as prereqs.sh found for PyYAML.
    if run pip3 install --user -r "$skill_dir/requirements.txt" 2>/dev/null \
      || run pip3 install --user --break-system-packages -r "$skill_dir/requirements.txt"; then
      info "  pip: $skill_name"
    else
      warn "  pip failed: $skill_name"
    fi
  fi
done
fi
