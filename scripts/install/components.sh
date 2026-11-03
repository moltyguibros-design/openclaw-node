# ============================================================
# Step 8.6: LLM Backend (the node's local-first brain)
# ============================================================

step "Step 8.6: LLM Backend"

if $SKIP_LLM; then
  info "Model provisioning deferred; runtime model capability=$OPENCLAW_MODEL_ENABLED"
elif $DRY_RUN; then
  if llm_url_is_local "$LLM_BASE_URL"; then
    info "[dry-run] would ensure ollama up, RAM-tier LLM_MODEL, model pulled, embedder prefetched"
  else
    info "[dry-run] would check $LLM_BASE_URL serves $LLM_MODEL (remote: no local ollama, no pull), embedder prefetched"
  fi
elif ! llm_url_is_local "$LLM_BASE_URL"; then
  # The model lives on another machine (the VM host's Ollama, or an operator endpoint): nothing
  # to start or pull here, and this machine's RAM says nothing about which model fits there.
  if ollama_has_model "$LLM_BASE_URL" "$LLM_MODEL"; then
    info "LLM served by $LLM_BASE_URL ($LLM_MODEL present)"
  elif curl -fsS --max-time 5 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1; then
    warn "$LLM_BASE_URL serves Ollama without $LLM_MODEL — on that machine: ollama pull $LLM_MODEL"
  elif curl -fsS --max-time 5 "$LLM_BASE_URL/v1/models" >/dev/null 2>&1; then
    info "LLM endpoint reachable: $LLM_BASE_URL (OpenAI-compatible; $LLM_MODEL not checked)"
  else
    warn "LLM endpoint unreachable at $LLM_BASE_URL — extraction degrades to regex until it answers"
  fi
fi

if ! $SKIP_LLM && ! $DRY_RUN && llm_url_is_local "$LLM_BASE_URL"; then
  if ! curl -fsS --max-time 3 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1; then
    if command -v ollama >/dev/null 2>&1; then
      info "Starting ollama..."
      if [ "$OS" = "macos" ]; then
        brew services start ollama >/dev/null 2>&1 || {
          (
            if [ -n "${OPENCLAW_NATS_LEGACY_LOCK_HELD:-}" ]; then
              lock_fd="${OPENCLAW_NATS_LEGACY_LOCK_HELD%%:*}"
              [[ "$lock_fd" =~ ^[0-9]+$ ]] || exit 1
              eval "exec ${lock_fd}<&-"
              unset OPENCLAW_NATS_LEGACY_LOCK_HELD
            fi
            nohup ollama serve >"$OPENCLAW_ROOT/logs/ollama.log" 2>&1 &
          )
        }
      else
        if $DRY_RUN; then info "  [dry-run] would start ollama"; else sudo systemctl start ollama 2>/dev/null || { nohup ollama serve >"$OPENCLAW_ROOT/logs/ollama.log" 2>&1 & }; fi
      fi
      for _ in $(seq 1 15); do
        curl -fsS --max-time 2 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1 && break
        sleep 2
      done
    fi
  fi

  if curl -fsS --max-time 3 "$LLM_BASE_URL/api/tags" >/dev/null 2>&1; then
    # RAM-tier model pick — upgrades only the shipped floor default, never an
    # operator-customized value
    TIER_MODEL=$("$NODE_BIN" "$REPO_DIR/bin/check-llm-baseline.mjs" --json 2>/dev/null | "$NODE_BIN" -e '
      let s = "";
      process.stdin.on("data", (d) => s += d).on("end", () => {
        try { console.log(JSON.parse(s).recommendation?.model || ""); } catch { console.log(""); }
      });
    ' 2>/dev/null || echo "")
    if [ -n "$TIER_MODEL" ] && [ "$LLM_MODEL" = "qwen3:8b" ] && [ "$TIER_MODEL" != "qwen3:8b" ]; then
      run sed -i.bak "s|^LLM_MODEL=qwen3:8b$|LLM_MODEL=$TIER_MODEL|" "$ENV_FILE" && run rm -f "$ENV_FILE.bak"
      export LLM_MODEL="$TIER_MODEL"
      info "RAM-tier upgrade: LLM_MODEL=$TIER_MODEL"
    fi

    if curl -fsS --max-time 5 "$LLM_BASE_URL/api/tags" | grep -q "\"$LLM_MODEL\""; then
      info "$LLM_MODEL present"
    else
      info "Pulling $LLM_MODEL (one-time, several GB — this is the node's brain)..."
      ollama pull "$LLM_MODEL" || warn "ollama pull failed — extraction degrades to regex until pulled"
    fi
  else
    warn "ollama unreachable at $LLM_BASE_URL — extraction degrades to regex; local agents have no provider"
  fi
fi

if ! $SKIP_LLM && ! $DRY_RUN; then
  # Embedder prefetch (Xenova/bge-m3, ~2GB one-time HuggingFace download) so the
  # first real search doesn't stall on it.
  if [ -d "$WORKSPACE/node_modules/@huggingface/transformers" ]; then
    info "Prefetching embedder Xenova/bge-m3 (~2GB one-time; cached afterwards)..."
    if OPENCLAW_WS_LIB="$WORKSPACE/lib" "$NODE_BIN" --input-type=module -e '
        const core = await import(process.env.OPENCLAW_WS_LIB + "/mcp-knowledge/core.mjs");
        const embed = core.embed || core.getEmbedder;
        if (!embed) throw new Error("no embed/getEmbedder export");
        await embed("installation warmup");
        console.log("  embedder ready");
      '; then
      info "Embedder ready"
    else
      warn "Embedder prefetch failed — first semantic-search use downloads it (needs internet)"
    fi
  else
    warn "workspace dependencies missing — embedder not prefetched"
  fi
fi

# ============================================================
# Step 9: Boot Manifest
# ============================================================

step "Step 9: Boot System"

if [ -f "$REPO_DIR/boot/manifest.yaml" ] && [ ! "$REPO_DIR/boot/manifest.yaml" -ef "$WORKSPACE/.boot/manifest.yaml" ]; then
  run cp "$REPO_DIR/boot/manifest.yaml" "$WORKSPACE/.boot/manifest.yaml"
  info "Boot manifest installed"
fi

# Compile boot profiles
if [ -f "$WORKSPACE/bin/compile-boot" ]; then
  info "Compiling boot profiles..."
  run python3 "$WORKSPACE/bin/compile-boot" --all 2>/dev/null || warn "Boot compilation skipped (may need identity files in place first)"
fi

# ============================================================
# Step 10: Obsidian Vault Scaffold
# ============================================================

step "Step 10: Obsidian Vault"

VAULT_DIR="$WORKSPACE/projects/arcane-vault"
if [ -d "$REPO_DIR/obsidian-vault" ]; then
  if [ ! -d "$VAULT_DIR/.obsidian" ]; then
    run mkdir -p "$VAULT_DIR"
    run rsync -av "$REPO_DIR/obsidian-vault/" "$VAULT_DIR/"
    # Remove .gitkeep files (only needed for git, not for runtime)
    find "$VAULT_DIR" -name '.gitkeep' -delete 2>/dev/null || true
    info "Obsidian vault scaffold installed (22 domain folders + plugins)"
    warn "Obsidian Local REST API plugin included. Set API key in $VAULT_DIR/.obsidian-api-key"
  else
    info "Obsidian vault already exists, skipping"
  fi
fi

# ============================================================
# Step 11: Mission Control
# ============================================================

step "Step 11: Mission Control"

export OPENCLAW_MISSION_CONTROL_DIR="$OPENCLAW_ROOT/runtime/mission-control/current"
MC_DIR="$OPENCLAW_MISSION_CONTROL_DIR"
if $SANDBOX; then
  info "Sandbox: Mission Control build/activation skipped; existing deployment preserved"
elif $DRY_RUN; then
  info "[dry-run] would stage, install, build and select Mission Control at $MC_DIR"
else
  "$NODE_BIN" "$REPO_DIR/bin/deploy-mission-control.mjs" \
    --source "$REPO_DIR/mission-control" --root "$OPENCLAW_ROOT" --workspace "$WORKSPACE"
fi

# ============================================================
# Step 12: Playwright (web-fetch fallback)
# ============================================================

step "Step 12: Playwright Browser"

if $SANDBOX; then
  info "Sandbox: skipping Playwright"
else
  PLAYWRIGHT_UBUNTU26_ARM64=false
  if [ "$OS" = linux ] && [ -r /etc/os-release ]; then
    PLAYWRIGHT_OS_ID=$(sed -n 's/^ID=//p' /etc/os-release)
    case "$PLAYWRIGHT_OS_ID" in
      ubuntu|'"ubuntu"'|"'ubuntu'")
        PLAYWRIGHT_OS_VERSION=$(sed -n 's/^VERSION_ID=//p' /etc/os-release)
        case "$PLAYWRIGHT_OS_VERSION" in
          \"*\"|\'*\')
            PLAYWRIGHT_OS_VERSION=${PLAYWRIGHT_OS_VERSION#?}
            PLAYWRIGHT_OS_VERSION=${PLAYWRIGHT_OS_VERSION%?}
            ;;
        esac
        if ! [[ "$PLAYWRIGHT_OS_VERSION" =~ ^[a-zA-Z0-9._-]+$ ]]; then
          error "Linux OS identity is malformed; browser platform selection refused"
          exit 1
        fi
        if [ "$PLAYWRIGHT_OS_VERSION" = 26.04 ]; then
          if [ "$(uname -m)" != aarch64 ]; then
            error "Ubuntu 26.04 browser selection is reviewed only for ARM64; unsupported architecture refused"
            exit 1
          fi
          PLAYWRIGHT_UBUNTU26_ARM64=true
        fi
        ;;
    esac
  fi

  if $DRY_RUN; then
    if $PLAYWRIGHT_UBUNTU26_ARM64; then
      info "[dry-run] would select ubuntu24.04-arm64 Chromium on Ubuntu 26.04 ARM64 without automatic system dependencies if installed Playwright is exactly 1.58.2; would verify a headless launch"
    else
      info "[dry-run] would install Chromium ($OS) and verify a headless launch"
    fi
  elif [ -e "$WORKSPACE/node_modules/playwright" ]; then
  # playwright is a ROOT dependency; the workspace node_modules tree is a set
  # of symlinks into the root install (workspace.sh link_dependency_tree).
  # Running `npm install --save playwright` INSIDE the workspace was the root
  # cause of the "vanished node_modules links" bug: npm reconciled the
  # workspace against its own (near-empty) package.json and pruned every
  # symlinked mesh dependency as extraneous. Never npm-install in the workspace.
  info "Playwright available via the shared dependency tree"
  if $PLAYWRIGHT_UBUNTU26_ARM64; then
    if [ "$("$NODE_BIN" -p 'process.arch' 2>/dev/null)" != arm64 ]; then
      error "Ubuntu 26.04 ARM64 browser selection requires an ARM64 Node runtime"
      exit 1
    fi
    if ! "$NODE_BIN" - "$REPO_DIR" <<'PLAYWRIGHT_PINS'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
try {
  const lock = read('package-lock.json').packages;
  for (const name of ['playwright', 'playwright-core']) {
    const key = `node_modules/${name}`;
    if (read(`${key}/package.json`).version !== '1.58.2' || lock[key]?.version !== '1.58.2') throw new Error(`${name} version differs from reviewed 1.58.2`);
  }
  const browsers = new Map(read('node_modules/playwright-core/browsers.json').browsers.map(item => [item.name, item.revision]));
  for (const [name, revision] of [['chromium', '1208'], ['chromium-headless-shell', '1208'], ['ffmpeg', '1011']]) {
    if (browsers.get(name) !== revision) throw new Error(`${name} revision differs from reviewed ${revision}`);
  }
  if (!fs.statSync(path.join(root, 'node_modules/playwright/cli.js')).isFile()) throw new Error('local Playwright CLI missing');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
PLAYWRIGHT_PINS
    then
      error "Reviewed Ubuntu 26.04 ARM64 Playwright package/browser pins are unavailable; browser install refused"
      exit 1
    fi
    (cd "$REPO_DIR" && env PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 \
      "$NODE_BIN" "$REPO_DIR/node_modules/playwright/cli.js" install chromium) \
      || { error "Reviewed Ubuntu 26.04 ARM64 Chromium download failed"; exit 1; }
  elif [ "$OS" = linux ] && [ "${UPDATE_ONLY:-false}" = false ]; then
    (cd "$REPO_DIR" && run npx playwright install --with-deps chromium) \
      || { error "Chromium browser or Linux system dependencies failed to install"; exit 1; }
  else
    (cd "$REPO_DIR" && run npx playwright install chromium) \
      || { error "Chromium browser failed to install"; exit 1; }
  fi
  if $PLAYWRIGHT_UBUNTU26_ARM64; then
    (cd "$REPO_DIR" && env PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 "$NODE_BIN" -e \
      "require('playwright').chromium.launch({headless:true}).then(b=>b.close()).catch(e=>{console.error(e);process.exitCode=1})") \
      || {
        error "Chromium headless launch failed"
        error "A separately reviewed system-library decision is required; upstream install-deps/apt suggestions are unreviewed for Ubuntu 26.04"
        exit 1
      }
  else
    (cd "$REPO_DIR" && "$NODE_BIN" -e \
      "require('playwright').chromium.launch({headless:true}).then(b=>b.close()).catch(e=>{console.error(e);process.exitCode=1})") \
      || {
        error "Chromium headless launch failed"
        if [ "$OS" = linux ] && [ "${UPDATE_ONLY:-false}" = true ]; then
          error "Install Linux browser prerequisites separately from the runtime source with sudo npx playwright install-deps chromium, then retry"
        fi
        exit 1
      }
  fi
  info "Chromium headless launch verified"
  else
    error "playwright missing from the shared dependency tree — the root dependency install did not complete"
    exit 1
  fi
fi

# ============================================================
# Step 13: Companion Bridge (OpenAI-compatible Claude adapter)
# ============================================================

step "Step 13: Companion Bridge"

if $SANDBOX; then
  info "Sandbox: skipping companion-bridge"
elif command -v companion-bridge >/dev/null 2>&1; then
  info "companion-bridge already installed (on PATH)"
else
  info "Installing companion-bridge (OpenAI-compatible adapter for Claude Code)..."
  if [ "$OS" = "linux" ]; then
    run sudo npm install -g companion-bridge || warn "companion-bridge install failed"
  else
    run npm install -g companion-bridge || warn "companion-bridge install failed"
  fi
fi

# Deploy harness rules (user-level override for companion-bridge)
HARNESS_SRC="${REPO_DIR}/config/harness-rules.json"
HARNESS_DST="${OPENCLAW_ROOT}/harness-rules.json"
if [ -f "$HARNESS_SRC" ]; then
  if [ ! -f "$HARNESS_DST" ]; then
    info "Deploying default harness rules to $HARNESS_DST"
    run mkdir -p "$(dirname "$HARNESS_DST")"
    run cp "$HARNESS_SRC" "$HARNESS_DST"
  else
    info "Syncing harness rules (smart merge — user edits preserved)..."
    run node "${REPO_DIR}/bin/harness-sync.js" apply
  fi
fi

# ============================================================
# Step 13.5: Agent Frontend — the OpenClaw's mind (D10)
# ============================================================

step "Step 13.5: Agent Frontend"

# The node's mind is provider-agnostic (lib/llm-providers.js): claude, openai
# (codex), gemini, deepseek, kimi, minimax, aider, ollama, shell. The installer
# seats whatever env.sh resolved; when nothing was chosen it ASKS on the
# terminal and, unattended, seats nothing. It never installs a vendor's CLI
# silently — the first virgin-Mac runs installed Claude Code by default, which
# contradicted the whole design.
if $SKIP_FRONTEND; then
  info "Skipped (--skip-frontend)"
else
  PROVIDER="${OPENCLAW_PROVIDER:-}"

  if [ -z "$PROVIDER" ]; then
    # Ask through /dev/tty: under `curl | bash` stdin is the script itself.
    if ! $DRY_RUN && { exec 3</dev/tty; } 2>/dev/null; then
      echo ""
      echo "  Which LLM drives this node's agent? (the mind; the memory organ is separate)"
      echo "    1) claude    (Claude Code CLI)"
      echo "    2) openai    (Codex CLI)"
      echo "    3) gemini    (Gemini CLI)"
      echo "    4) deepseek"
      echo "    5) kimi"
      echo "    6) minimax"
      echo "    7) aider"
      echo "    8) ollama    (local model — solo tasks only; grappe workers refuse it, D11)"
      echo "    9) none for now (seat it later with: bash install.sh --update --provider=NAME)"
      printf "  Provider? [1-9] "
      read -r PICK <&3 || PICK=9
      exec 3<&- 2>/dev/null || true
      case "${PICK:-9}" in
        1) PROVIDER=claude ;; 2) PROVIDER=openai ;; 3) PROVIDER=gemini ;; 4) PROVIDER=deepseek ;;
        5) PROVIDER=kimi ;;   6) PROVIDER=minimax ;; 7) PROVIDER=aider ;; 8) PROVIDER=ollama ;;
        *) PROVIDER="" ;;
      esac
    else
      warn "No agent provider chosen and no terminal to ask — the node has no mind seated."
      warn "Seat one later: bash $0 --update --provider=NAME  (claude|openai|gemini|deepseek|kimi|minimax|aider|ollama)"
    fi
  fi

  if [ -n "$PROVIDER" ]; then
    BIN="$(provider_binary "$PROVIDER")"
    if command -v "$BIN" >/dev/null 2>&1; then
      info "Mind seated: $PROVIDER ($BIN on PATH)"
    else
      # Install only the CLI the operator chose, only where the package is known.
      case "$PROVIDER" in
        claude) PKG="@anthropic-ai/claude-code" ;;
        openai) PKG="@openai/codex" ;;
        gemini) PKG="@google/gemini-cli" ;;
        *)      PKG="" ;;
      esac
      if [ -n "$PKG" ]; then
        info "Installing the $PROVIDER CLI ($PKG)..."
        if [ "$OS" = "linux" ]; then
          run sudo npm install -g "$PKG" || warn "$PKG install failed — install the '$BIN' CLI manually"
        else
          run npm install -g "$PKG" || warn "$PKG install failed — install the '$BIN' CLI manually"
        fi
        command -v "$BIN" >/dev/null 2>&1 && info "Mind seated: $PROVIDER ($BIN)" || warn "'$BIN' still not on PATH"
      else
        warn "$PROVIDER chosen but the '$BIN' CLI is not on PATH — install it (or set $(echo "$PROVIDER" | tr '[:lower:]' '[:upper:]')_PATH) and re-run: bash $0 --update"
      fi
    fi
    export OPENCLAW_PROVIDER="$PROVIDER"
    export MESH_LLM_PROVIDER="$PROVIDER"
    [ -f "$ENV_FILE" ] && set_env_key MESH_LLM_PROVIDER "$PROVIDER"

    # Auth is provider-specific and human-in-the-loop; only Claude Code has a
    # non-interactive probe wired here.
    if $DRY_RUN; then
      info "[dry-run] would check $PROVIDER auth"
    elif [ "$PROVIDER" = claude ] && $VERIFY_FRONTEND; then
      info "Verifying Claude Code auth with one small live call..."
      # env -u CLAUDECODE: allow the probe even when install.sh itself runs
      # inside a Claude Code session (the CLI refuses nested sessions otherwise)
      if FRONTEND_PROBE=$(env -u CLAUDECODE claude -p 'Reply with exactly: OK' --output-format text --model haiku 2>&1) && echo "$FRONTEND_PROBE" | grep -q "OK"; then
        info "Mind seated: Claude Code authenticated and answering"
      else
        warn "Claude Code present but NOT authenticated (probe failed)"
        warn "Seat the mind: run 'claude' once interactively to sign in, then: bash $0 --update --verify-frontend"
      fi
    else
      info "$PROVIDER auth is interactive — on a fresh device, run '$BIN' once to sign in."
    fi
  fi
fi

# ============================================================
# Step 14: ClawVault
# ============================================================

step "Step 14: ClawVault"

if command -v clawvault >/dev/null 2>&1; then
  info "ClawVault already installed: $(which clawvault)"
elif [ -d "$WORKSPACE/.npm-global" ]; then
  info "ClawVault: checking npm-global..."
  if [ -f "$WORKSPACE/.npm-global/bin/clawvault" ]; then
    info "ClawVault found in .npm-global"
  else
    warn "ClawVault not found. Install with: npm install -g clawvault"
  fi
else
  warn "ClawVault not installed. Install with: npm install -g clawvault"
  warn "(Non-critical — memory system works without it)"
fi

# ============================================================
# Step 15: Initialize Memory
# ============================================================

step "Step 15: Initialize Memory"

TODAY=$(date +%Y-%m-%d)
DAILY_FILE="$WORKSPACE/memory/$TODAY.md"

if [ ! -f "$DAILY_FILE" ]; then
  write_file "$DAILY_FILE" << DAILY
# $TODAY

Node initialized on $(hostname) at $(date '+%H:%M %Z').
DAILY
  info "Created daily memory file: $TODAY.md"
fi

if [ ! -f "$WORKSPACE/memory/active-tasks.md" ]; then
  write_file "$WORKSPACE/memory/active-tasks.md" << TASKS
# Active Tasks

Updated: $TODAY $(date '+%H:%M') $OPENCLAW_TIMEZONE

Use this as crash-recovery state.

## Task Template

\`\`\`yaml
task_id: T-YYYYMMDD-001
title: <short title>
status: queued|running|blocked|waiting-user|done|cancelled
owner: main|sub-agent:<sessionKey>
success_criteria:
  - <criterion 1>
artifacts:
  - <path/or/link>
next_action: <single next step>
updated_at: YYYY-MM-DD HH:MM
\`\`\`

## Live Tasks

(none yet)
TASKS
  info "Created active-tasks.md"
fi

if [ ! -f "$WORKSPACE/.companion-state.md" ]; then
  write_file "$WORKSPACE/.companion-state.md" << STATE
## Session Status
status: inactive
started_at:
last_flush: $(date -Iseconds)

## Active Task
(none)

## Current State
0 running, 0 done
STATE
  info "Created .companion-state.md"
fi

if [ ! -f "$WORKSPACE/.learnings/lessons.md" ]; then
  write_file "$WORKSPACE/.learnings/lessons.md" << LESSONS
# Lessons Learned

Accumulated corrections and preferences.

## Format
- **Date** | **Category** | **Lesson** | **Source**
LESSONS
  info "Created lessons.md"
fi

if [ ! -f "$WORKSPACE/MEMORY.md" ]; then
  write_file "$WORKSPACE/MEMORY.md" << MEM
# MEMORY.md — Long-Term Memory

## Active Context (this week)

- Node initialized: $TODAY on $(hostname)

## Recent (this month)

## Stable (long-term preferences & facts)

## Archive Reference
- See memory/archive/ for historical context
MEM
  info "Created MEMORY.md"
fi

# ============================================================
# Step 15.5: HyperAgent Protocol
# ============================================================

step "Step 15.5: HyperAgent Protocol"

HYPERAGENT_BIN="$WORKSPACE/bin/hyperagent.mjs"
if $DRY_RUN && [ ! -f "$HYPERAGENT_BIN" ]; then
  # Nothing was copied in a dry run; the presence check would be a false alarm.
  echo "  [dry-run] node $HYPERAGENT_BIN status (initializes the store)"
elif [ -f "$HYPERAGENT_BIN" ]; then
  if $DRY_RUN; then
    echo "  [dry-run] node $HYPERAGENT_BIN status (initializes the store)"
  elif node "$HYPERAGENT_BIN" status; then
    info "HyperAgent store initialized"
  else
    error "HyperAgent initialization failed at $HYPERAGENT_BIN"
    exit 1
  fi
else
  error "hyperagent.mjs not found in $WORKSPACE/bin"
  exit 1
fi
