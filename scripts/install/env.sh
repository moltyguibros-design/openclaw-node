# ── Resolve NODE_BIN (used by service templates) ──
NODE_BIN="$(command -v node 2>/dev/null || echo "")"
if [ -z "$NODE_BIN" ]; then
  error "Node.js not found after dependency install — cannot continue"
  exit 1
fi
export NODE_BIN
# Leads the PATH of units whose children find node by name (Mission Control's
# npm start → next), so they run the node their native modules were built for.
export NODE_BIN_DIR="$(dirname "$NODE_BIN")"

# ── Resolve nats-server binary (service templates exec ${NATS_SERVER_BIN}) ──
NATS_SERVER_BIN="$(command -v nats-server 2>/dev/null || echo "")"
if [ -z "$NATS_SERVER_BIN" ]; then
  for p in /opt/homebrew/bin/nats-server /usr/local/bin/nats-server; do
    if [ -x "$p" ]; then NATS_SERVER_BIN="$p"; break; fi
  done
fi
if [ -z "$NATS_SERVER_BIN" ]; then
  error "nats-server not found after dependency install — the bus cannot exist"
  $DRY_RUN || exit 1
  NATS_SERVER_BIN="/usr/local/bin/nats-server"
fi
export NATS_SERVER_BIN
info "nats-server: $NATS_SERVER_BIN"

# ── Repo runtime dependencies + the event-schemas dist ──
# Reinstalled / rebuilt when what they came from changed (deps.sh); the mesh
# deploy 'deps' component runs the same script on every node.
source "$REPO_DIR/scripts/install/deps.sh"
install_repo_deps "$REPO_DIR" || { error "repo npm install failed — mesh daemons cannot run"; exit 1; }
build_event_schemas "$REPO_DIR" || exit 1

# ── Resolve the agent provider (the node's mind) ──
# The runtime is provider-agnostic (lib/llm-providers.js): the mind is whatever
# CLI MESH_LLM_PROVIDER names. The installer must be too: --provider= wins, then
# the env file, then whatever known CLI is already on PATH. Nothing is ever
# installed silently; Step 13.5 asks when no choice can be made here.
KNOWN_PROVIDERS="claude openai gemini deepseek kimi minimax aider ollama shell"
provider_binary() {
  case "$1" in
    openai)   echo codex ;;
    deepseek) echo dsh ;;
    shell)    echo sh ;;
    *)        echo "$1" ;;
  esac
}
PROVIDER="${PROVIDER:-${OPENCLAW_PROVIDER:-}}"
PROVIDER_SOURCE="--provider"
if [ -z "$PROVIDER" ] && [ -f "$ENV_FILE" ]; then
  PROVIDER="$(grep -m1 '^MESH_LLM_PROVIDER=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d "\"'" | xargs || true)"
  PROVIDER_SOURCE="$ENV_FILE"
fi
if [ -n "$PROVIDER" ]; then
  case " $KNOWN_PROVIDERS " in
    *" $PROVIDER "*) info "Agent provider: $PROVIDER (from $PROVIDER_SOURCE)" ;;
    *) error "Unknown provider '$PROVIDER'. Known: $KNOWN_PROVIDERS"; exit 1 ;;
  esac
else
  PROVIDERS_FOUND=""
  for p in claude openai gemini deepseek kimi minimax aider; do
    command -v "$(provider_binary "$p")" >/dev/null 2>&1 && PROVIDERS_FOUND="$PROVIDERS_FOUND $p"
  done
  PROVIDERS_FOUND="${PROVIDERS_FOUND# }"
  case "$(echo "$PROVIDERS_FOUND" | wc -w | tr -d ' ')" in
    0) info "Agent provider: none chosen yet (no known CLI on PATH) — Step 13.5 will ask" ;;
    1) PROVIDER="$PROVIDERS_FOUND"; info "Agent provider: $PROVIDER (detected on PATH)" ;;
    *) PROVIDER="${PROVIDERS_FOUND%% *}"
       warn "Several agent CLIs on PATH ($PROVIDERS_FOUND) — taking $PROVIDER; pass --provider= to choose" ;;
  esac
fi
export OPENCLAW_PROVIDER="$PROVIDER"
export KNOWN_PROVIDERS

# ── Resolve node role ──
if [ -z "$NODE_ROLE" ]; then
  NODE_ROLE="${OPENCLAW_NODE_ROLE:-}"
fi
if [ -z "$NODE_ROLE" ] && [ -f "$ENV_FILE" ]; then
  NODE_ROLE="$(grep -m1 '^OPENCLAW_NODE_ROLE=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d "\"'" | xargs || true)"
fi
# Never guessed from the OS: a Mac is not necessarily the lead. A node's first
# install names it; config.sh saves it for every later run.
if [ -z "$NODE_ROLE" ]; then
  error "No node role: pass --role=lead or --role=worker (saved to $ENV_FILE for later runs)"
  exit 1
fi
if [ "$NODE_ROLE" != "lead" ] && [ "$NODE_ROLE" != "worker" ]; then
  error "Invalid role: $NODE_ROLE (must be 'lead' or 'worker')"
  exit 1
fi
export OPENCLAW_NODE_ROLE="$NODE_ROLE"
info "Node role: $NODE_ROLE"

# Lead pubkey handed to a joining worker (install.sh --lead-pubkey / env). config.sh
# merges it into the trust allowlists; a lead install leaves it empty.
export OPENCLAW_LEAD_PUBKEY="${LEAD_PUBKEY:-${OPENCLAW_LEAD_PUBKEY:-}}"

# ── Resolve node ID ──
export OPENCLAW_NODE_ID="${OPENCLAW_NODE_ID:-$(hostname -s | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')}"
info "Node ID: $OPENCLAW_NODE_ID"

# ── Resolve NATS URL + auth (for service templates) ──
export OPENCLAW_NATS="${OPENCLAW_NATS:-nats://127.0.0.1:4222}"
export OPENCLAW_NATS_TOKEN="${OPENCLAW_NATS_TOKEN:-}"

# ── Claude Code project path encoding (for transcript-sources.json) ──
# Claude Code replaces every non-alphanumeric character of its real (symlink-
# resolved) cwd with -, INCLUDING the leading slash: /Users/x/my_repo →
# -Users-x-my-repo, as lib/agent-activity.js does. A path that does not exist yet
# is encoded as given. A wrong encoding matches nothing on disk and _detectActivity
# skips it silently: memory ingest ran dark for 39h after the 2026-07-14 re-render
# (memory_ingest_remediation audit).
claude_project_path() {
  { (cd "$1" 2>/dev/null && pwd -P) || printf '%s\n' "$1"; } | sed 's|[^A-Za-z0-9]|-|g'
}
export CLAUDE_PROJECT_WORKSPACE="$(claude_project_path "$WORKSPACE")"
export CLAUDE_PROJECT_HOME="$(claude_project_path "$HOME")"
export CLAUDE_PROJECT_REPO="$(claude_project_path "$REPO_DIR")"

# ── Resolve paths for service templates ──
export OPENCLAW_WORKSPACE="$WORKSPACE"
export OPENCLAW_REPO_DIR="$REPO_DIR"
export NPM_BIN="$(command -v npm 2>/dev/null || echo "$HOME/.openclaw/workspace/.npm-global/bin/npm")"
# The gateway unit runs the global openclaw package (`npm i -g openclaw`). npm -g
# lands in /opt/homebrew/lib on Apple-Silicon Homebrew and /usr/lib on NodeSource,
# so ask this npm instead of assuming /usr/local/lib (no debug log: --dry-run writes nothing).
export OPENCLAW_GATEWAY_JS="$("$NPM_BIN" root -g --logs-max=0 2>/dev/null || echo /usr/local/lib/node_modules)/openclaw/dist/index.js"
