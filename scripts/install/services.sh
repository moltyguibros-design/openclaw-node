# ============================================================
# Step 16: Install Services (role-aware, template-based)
# ============================================================

step "Step 16: Install Services (role=$NODE_ROLE)"

MANIFEST="$REPO_DIR/services/service-manifest.json"
LAUNCHD_TEMPLATES="$REPO_DIR/services/launchd"
SYSTEMD_TEMPLATES="$REPO_DIR/services/systemd"
LAUNCHD_DEST="${OPENCLAW_LAUNCHD_DIR:-$HOME/Library/LaunchAgents}"
SYSTEMD_DEST="${OPENCLAW_SYSTEMD_DIR:-$HOME/.config/systemd/user}"
INSTALLED_COUNT=0
SKIPPED_COUNT=0
RENDER_ERRORS=0
# The placeholders lib/render-unit.js fills. Only these names are touched, so
# systemd's own runtime variables ($MAINPID in the NATS units' ExecReload) survive.
UNIT_NAMES='HOME NODE_BIN NODE_BIN_DIR OPENCLAW_WORKSPACE OPENCLAW_NATS OPENCLAW_NATS_TOKEN OPENCLAW_NODE_ID OPENCLAW_NODE_ROLE OPENCLAW_DEPLOY_TRUSTED_KEYS OPENCLAW_REPO_DIR NPM_BIN OPENCLAW_GATEWAY_JS NATS_SERVER_BIN MESH_LLM_PROVIDER LLM_MODEL LLM_BASE_URL MESH_FOREMAN_ENFORCE OPENCLAW_TIMEZONE'

# render_unit FORMAT TEMPLATE DEST — the render (and, for a plist, plutil) must
# accept it before it replaces DEST, so a bad value never overwrites or reloads
# a working unit. A leftover ${VAR} placeholder fails the render (the
# silent-unrendered class, 2026-07-11 audit).
render_unit() {
  local fmt="$1" tmpl="$2" dest="$3" tmp="$3.render.$$"
  if "$NODE_BIN" "$REPO_DIR/lib/render-unit.js" "$fmt" "$UNIT_NAMES" "$tmpl" > "$tmp" \
    && { [ "$fmt" != plist ] || plutil -lint -s "$tmp"; }; then
    mv "$tmp" "$dest"
  else
    rm -f "$tmp"
    error "  $(basename "$dest") did not render; the installed unit is left as it was"
    RENDER_ERRORS=$((RENDER_ERRORS + 1))
    return 1
  fi
}

# Ensure log directories exist (the transcript-archive plist logs into its archive dir)
run mkdir -p "$OPENCLAW_ROOT/logs" "$WORKSPACE/.tmp" "$OPENCLAW_ROOT/transcript-archive"

if [ ! -f "$MANIFEST" ]; then
  warn "Service manifest not found at $MANIFEST — skipping service installation"
else
  # Read manifest entries using node (jq may not be available yet)
  SERVICES=$("$NODE_BIN" -e "
    const m = require('$MANIFEST');
    m.forEach(s => console.log([s.name, s.role, s.autostart, s.timer || false].join('|')));
  ")

  while IFS='|' read -r SVC_NAME SVC_ROLE SVC_AUTO SVC_TIMER; do
    # Role filtering: install if role matches or role=both
    if [ "$SVC_ROLE" != "both" ] && [ "$SVC_ROLE" != "$NODE_ROLE" ]; then
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
      continue
    fi

    if [ "$OS" = "macos" ]; then
      LAUNCHD_SVC_NAME="${SVC_NAME#openclaw-}"
      if [[ "$LAUNCHD_SVC_NAME" == nats* ]]; then
        "$NODE_BIN" "$REPO_DIR/bin/nats-legacy-writer-check.mjs"
      fi
      TEMPLATE="$LAUNCHD_TEMPLATES/ai.openclaw.${LAUNCHD_SVC_NAME}.plist"
      DEST="$LAUNCHD_DEST/ai.openclaw.${LAUNCHD_SVC_NAME}.plist"

      if [ ! -f "$TEMPLATE" ]; then
        warn "  Template not found: $TEMPLATE"
        continue
      fi

      run mkdir -p "$LAUNCHD_DEST"

      # F4 (security review 2): the raw redirects below bypassed run()'s dry-run
      # guard — --dry-run was overwriting real LaunchAgents/systemd units.
      if $DRY_RUN; then
        info "  [dry-run] would render $TEMPLATE -> $DEST"
        continue
      fi

      render_unit plist "$TEMPLATE" "$DEST" || continue

      # Refresh only when this run manages the lifecycle — a bare unload
      # without a reload silently downs a running node (2026-07-11 audit).
      if [ "$SVC_AUTO" = "true" ] && $ENABLE_SERVICES; then
        run launchctl unload "$DEST" 2>/dev/null || true
        run launchctl load "$DEST"
        info "  Installed + loaded: $SVC_NAME"
      else
        info "  Installed: $SVC_NAME (load manually: launchctl load $DEST)"
      fi
      INSTALLED_COUNT=$((INSTALLED_COUNT + 1))

    elif [ "$OS" = "linux" ]; then
      run mkdir -p "$SYSTEMD_DEST"

      # Handle timer-based services (service + timer)
      if [ "$SVC_TIMER" = "true" ]; then
        TIMER_RENDERED=true
        for ext in service timer; do
          TEMPLATE="$SYSTEMD_TEMPLATES/${SVC_NAME}.${ext}"
          DEST="$SYSTEMD_DEST/${SVC_NAME}.${ext}"
          if [ ! -f "$TEMPLATE" ]; then
            warn "  Template not found: $TEMPLATE"
            continue
          fi
          if $DRY_RUN; then
            info "  [dry-run] would render $TEMPLATE -> $DEST"
            continue
          fi
          render_unit systemd "$TEMPLATE" "$DEST" || TIMER_RENDERED=false
        done
        $TIMER_RENDERED || continue
        if $ENABLE_SERVICES; then
          run systemctl --user daemon-reload
          run systemctl --user enable "${SVC_NAME}.timer"
          run systemctl --user start "${SVC_NAME}.timer"
          info "  Installed + enabled: $SVC_NAME (timer)"
        else
          info "  Installed: $SVC_NAME (timer — enable with: systemctl --user enable --now ${SVC_NAME}.timer)"
        fi
      else
        TEMPLATE="$SYSTEMD_TEMPLATES/${SVC_NAME}.service"
        DEST="$SYSTEMD_DEST/${SVC_NAME}.service"
        if [ ! -f "$TEMPLATE" ]; then
          warn "  Template not found: $TEMPLATE"
          continue
        fi
        if $DRY_RUN; then
          info "  [dry-run] would render $TEMPLATE -> $DEST"
          continue
        fi
        render_unit systemd "$TEMPLATE" "$DEST" || continue
        if [ "$SVC_AUTO" = "true" ] && $ENABLE_SERVICES; then
          run systemctl --user daemon-reload
          run systemctl --user enable "${SVC_NAME}.service"
          # start is a no-op on a running unit; restart applies the re-rendered unit and new code, as unload/load does on macOS.
          run systemctl --user restart "${SVC_NAME}.service"
          info "  Installed + started: $SVC_NAME"
        else
          info "  Installed: $SVC_NAME"
        fi
      fi
      INSTALLED_COUNT=$((INSTALLED_COUNT + 1))
    fi
  done <<< "$SERVICES"

  # Reload systemd if any units were installed
  if [ "$OS" = "linux" ] && [ "$INSTALLED_COUNT" -gt 0 ]; then
    run systemctl --user daemon-reload
    # Enable linger so user services survive logout
    loginctl enable-linger "$(whoami)" 2>/dev/null || warn "loginctl enable-linger failed — services may stop on logout"
  fi

  if [ "$RENDER_ERRORS" -gt 0 ]; then
    error "$RENDER_ERRORS unit(s) failed to render and kept their previous version — aborting"
    exit 1
  fi

  info "Services installed: $INSTALLED_COUNT (skipped $SKIPPED_COUNT — wrong role)"
  if ! $ENABLE_SERVICES; then
    info "Services installed but NOT started. Use --enable-services to also start them."
    if [ "$OS" = "linux" ]; then
      info "Or start individually: systemctl --user enable --now <service-name>"
    else
      info "Or load individually: launchctl load ~/Library/LaunchAgents/ai.openclaw.<name>.plist"
    fi
  fi
fi

# ============================================================
# Step 16.5: Desktop Notifications (ledgered, click-through popups)
# ============================================================

step "Step 16.5: Desktop Notifications"

NOTIFY_ICON_SRC="$REPO_DIR/services/notify-icons"
NOTIFY_ICON_DEST="$OPENCLAW_ROOT/share/notify-icons"
run mkdir -p "$NOTIFY_ICON_DEST" "$OPENCLAW_ROOT/notifications" "$OPENCLAW_ROOT/config"
if ls "$NOTIFY_ICON_SRC"/*.png >/dev/null 2>&1; then
  run cp "$NOTIFY_ICON_SRC"/*.png "$NOTIFY_ICON_DEST/"
  info "Notification icons installed → $NOTIFY_ICON_DEST (swap per-kind via config/notify.json)"
else
  warn "No notification icons found at $NOTIFY_ICON_SRC"
fi

NOTIFY_CONFIG="$OPENCLAW_ROOT/config/notify.json"
if [ -f "$NOTIFY_CONFIG" ]; then
  info "Notification config already exists, keeping it"
else
  write_file "$NOTIFY_CONFIG" <<'EOF'
{
  "enabled": true,
  "sources": {},
  "icons": {
    "default": "default.png",
    "info": "info.png",
    "success": "success.png",
    "warn": "warn.png",
    "error": "error.png",
    "block": "block.png"
  }
}
EOF
  info "Default notification config written → $NOTIFY_CONFIG"
fi

if $SANDBOX; then
  info "Sandbox: skipping notifier install + app builds"
elif [ "$OS" = "macos" ]; then
  if command -v terminal-notifier >/dev/null 2>&1 || [ -x /opt/homebrew/bin/terminal-notifier ] || [ -x /usr/local/bin/terminal-notifier ]; then
    info "terminal-notifier present — popups click through to their origin"
  elif command -v brew >/dev/null 2>&1; then
    run brew install terminal-notifier || warn "brew install terminal-notifier failed — osascript fallback active (popups not clickable)"
  else
    warn "terminal-notifier missing — osascript fallback fires popups but they are NOT clickable"
    warn "Install later: brew install terminal-notifier"
  fi
  # Branded sender bundle: the banner's LEFT icon is the sending app's icon, so
  # ship our own (claw-badged) copy — lib/notify.mjs prefers it when present.
  if $DRY_RUN; then
    echo "  [dry-run] bash $REPO_DIR/services/notify-icons/build-notifier-app.sh"
  elif bash "$REPO_DIR/services/notify-icons/build-notifier-app.sh" >/dev/null 2>&1; then
    info "OpenClaw notifier bundle built → ~/.openclaw/share/OpenClawNotifier.app (branded banner icon)"
  else
    warn "Branded notifier bundle not built (terminal-notifier missing?) — stock icon will show"
  fi
elif [ "$OS" = "linux" ]; then
  if ! command -v notify-send >/dev/null 2>&1; then
    run sudo apt-get install -y libnotify-bin xdg-utils || warn "libnotify-bin install failed — popups disabled (events still ledgered)"
  fi
  if command -v notify-send >/dev/null 2>&1; then
    if notify-send --help 2>/dev/null | grep -Eq '^\s*-A[,\s]'; then
      info "notify-send with action support — popups click through to their origin"
    else
      warn "libnotify < 0.7.10 (no -A flag) — popups fire but are NOT clickable"
    fi
    command -v xdg-open >/dev/null 2>&1 || warn "xdg-open missing — install xdg-utils for click-through"
  fi
fi

info "Smoke test: node $REPO_DIR/bin/openclaw-notify.mjs --test"
info "Ledger (every event, clicked or not): ~/.openclaw/notifications/ledger.jsonl · UI: Mission Control /notifications"

# One-click stack launcher: a claw-icon app/desktop entry that runs
# `openclaw-stack up` (starts every installed unit + companion-bridge, probes,
# reports via ledgered notification).
if $SANDBOX; then
  : # sandbox — no launcher build
elif [ "$OS" = "macos" ]; then
  if $DRY_RUN; then
    echo "  [dry-run] bash $REPO_DIR/services/launcher/build-launcher-app.sh"
  elif bash "$REPO_DIR/services/launcher/build-launcher-app.sh" >/dev/null 2>&1; then
    info "Stack launcher built → ~/Applications/OpenClaw Stack.app (double-click or Dock it)"
  else
    warn "Stack launcher app not built — start manually: node $REPO_DIR/bin/openclaw-stack.mjs up"
  fi
elif [ "$OS" = "linux" ]; then
  DESKTOP_DIR="$HOME/.local/share/applications"
  run mkdir -p "$DESKTOP_DIR"
  if $DRY_RUN; then
    echo "  [dry-run] would install $DESKTOP_DIR/openclaw-stack.desktop"
  elif render_unit desktop "$REPO_DIR/services/launcher/openclaw-stack.desktop" "$DESKTOP_DIR/openclaw-stack.desktop"; then
    run chmod +x "$DESKTOP_DIR/openclaw-stack.desktop"
    info "Stack launcher installed → $DESKTOP_DIR/openclaw-stack.desktop (app menu: OpenClaw Stack)"
  fi
fi
