# ============================================================
# Step 7: Environment File
# ============================================================

step "Step 7: Environment Configuration"

"$NODE_BIN" "$REPO_DIR/bin/nats-legacy-writer-check.mjs"

load_env_file "$ENV_FILE"
backup_installer_config
PENDING_CLUSTER_DIR=""
if [ -n "$CLUSTER_PEERS" ]; then
  step "Validate requested multi-machine NATS configuration"
  CLUSTER_SERVER_NAME="openclaw-nats-${OPENCLAW_NODE_ID}"

  # The machine's OWN address to bind (D2/D4: the tailnet interface, never all-interfaces).
  if [ -z "$CLUSTER_BIND" ] && command -v tailscale >/dev/null 2>&1; then
    CLUSTER_BIND="$(tailscale ip -4 2>/dev/null | head -1)"
    [ -n "$CLUSTER_BIND" ] && info "Auto-detected Tailscale address for binds: $CLUSTER_BIND"
  fi
  if [ -z "$CLUSTER_BIND" ]; then
    error "--cluster-peers requires --cluster-bind=<this machine's tailnet/LAN IP> (no tailscale auto-detect available). Refusing to bind 0.0.0.0."
    exit 1
  fi

  case "$CLUSTER_BIND" in
    0.0.0.0|::|\[::\]) error "Refusing to bind all interfaces"; exit 1 ;;
  esac

  # Cluster-route password — shared across the council like the client token.
  CLUSTER_PASS_GENERATED=false
  if [ -z "${OPENCLAW_NATS_CLUSTER_PASS:-}" ]; then
    OPENCLAW_NATS_CLUSTER_PASS="$(openssl rand -hex 32)"
    CLUSTER_PASS_GENERATED=true
    info "Generated OPENCLAW_NATS_CLUSTER_PASS (copy it — with OPENCLAW_NATS_TOKEN — to every council machine's openclaw.env)"
  fi
  export OPENCLAW_NATS_CLUSTER_PASS

  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] would render cluster nats.conf (server=$CLUSTER_SERVER_NAME, bind=$CLUSTER_BIND) routing to: $CLUSTER_PEERS"
  else
    PENDING_CLUSTER_DIR="$(mktemp -d "$OPENCLAW_ROOT/config/.cluster-XXXXXX")"
    chmod 700 "$PENDING_CLUSTER_DIR"
    trap installer_exit_cleanup EXIT
    if [ -f "$OPENCLAW_ROOT/config/nats-auth.conf" ]; then
      cp "$OPENCLAW_ROOT/config/nats-auth.conf" "$PENDING_CLUSTER_DIR/nats-auth.conf"
    else
      "$NODE_BIN" --input-type=module -e '
        const { renderAuthorization } = await import(process.argv[2]);
        process.stdout.write(renderAuthorization({ mode: "token", token: process.env.OPENCLAW_NATS_TOKEN }));
      ' installer-cluster-validation "$REPO_DIR/bin/nats-auth-render.mjs" > "$PENDING_CLUSTER_DIR/nats-auth.conf"
    fi
    chmod 600 "$PENDING_CLUSTER_DIR/nats-auth.conf"
    KV_REPLICAS="$(OPENCLAW_NATS_SERVER_NAME="$CLUSTER_SERVER_NAME" \
      OPENCLAW_NATS_TOKEN="$OPENCLAW_NATS_TOKEN" \
      OPENCLAW_NATS_CLUSTER_PASS="$OPENCLAW_NATS_CLUSTER_PASS" \
      OPENCLAW_NATS_BIND_ADDR="$CLUSTER_BIND" \
      CLUSTER_PEERS="$CLUSTER_PEERS" \
      "$NODE_BIN" -e '
        const fs = require("fs"), os = require("os");
        const { renderClusterRoutes, replicasForPeers, parsePeers } = require(process.argv[1]);
        let t = fs.readFileSync(process.argv[2], "utf8");
        t = t.replaceAll("${OPENCLAW_NATS_SERVER_NAME}", process.env.OPENCLAW_NATS_SERVER_NAME)
             .replaceAll("${OPENCLAW_NATS_CLUSTER_PASS}", process.env.OPENCLAW_NATS_CLUSTER_PASS)
             .replaceAll("${OPENCLAW_NATS_BIND_ADDR}", process.env.OPENCLAW_NATS_BIND_ADDR)
             .replaceAll("${HOME}", os.homedir())
             .replace("${OPENCLAW_NATS_CLUSTER_ROUTES}", renderClusterRoutes(process.env.CLUSTER_PEERS, {
               user: "openclaw-route", pass: process.env.OPENCLAW_NATS_CLUSTER_PASS,
             }));
        fs.writeFileSync(process.argv[3], t, { mode: 0o600 });
        process.stdout.write(String(replicasForPeers(parsePeers(process.env.CLUSTER_PEERS).length)));
      ' "$REPO_DIR/lib/nats-cluster-config.js" "$REPO_DIR/services/nats/nats-cluster-node.conf" "$PENDING_CLUSTER_DIR/nats.conf")"
    if ! "$NATS_SERVER_BIN" -t -c "$PENDING_CLUSTER_DIR/nats.conf" > "$PENDING_CLUSTER_DIR/validation.log" 2>&1; then
      error "Requested cluster configuration is invalid; existing config and env are unchanged"
      exit 1
    fi
  fi
fi

if $DRY_RUN; then
  info "  [dry-run] would initialize the fresh single-node NATS cohort"
else
  "$NODE_BIN" "$REPO_DIR/bin/nats-writer-cohort-init.mjs" --home "$OPENCLAW_ROOT"
fi

if [ ! -f "$ENV_FILE" ]; then
  run cp "$REPO_DIR/openclaw.env.example" "$ENV_FILE"
  load_env_file "$ENV_FILE"
  warn "Created $ENV_FILE — EDIT THIS FILE with your API keys before proceeding!"
  warn "Run: nano $ENV_FILE"
else
  info "Environment file already exists at $ENV_FILE"
fi

# The env file carries the NATS bus token and every cloud API key. The example
# it is copied from is 0644, and nothing below re-hardens it, so without this a
# fresh install leaves the whole credential set world-readable.
if [ -f "$ENV_FILE" ]; then
  run chmod 600 "$ENV_FILE"
fi

export OPENCLAW_NODE_ROLE="$NODE_ROLE"
set_env_key OPENCLAW_NODE_ROLE "$NODE_ROLE"

# Persist the node id so it is STABLE across re-runs and hostname changes.
# env.sh derives it from the hostname on every run; without this line a rename
# (or a later derivation change) re-labels the node on --update while its KV
# entries, JetStream durables and daemon-state files keep the old id (review
# I13/L11). A value already in the file wins (it was exported by the loop above).
if [ -f "$ENV_FILE" ] && [ "$DRY_RUN" != true ] && ! grep -q '^OPENCLAW_NODE_ID=' "$ENV_FILE"; then
  echo "OPENCLAW_NODE_ID=$OPENCLAW_NODE_ID" >> "$ENV_FILE"
  info "Persisted OPENCLAW_NODE_ID=$OPENCLAW_NODE_ID to $ENV_FILE (stable node identity)"
fi

# Generate OPENCLAW_NATS_TOKEN if not set — server-side auth token (D2, federation step 1.1).
# Clients already resolve+send it via lib/nats-resolve.js; this closes the server-side gap.
if [ -z "${OPENCLAW_NATS_TOKEN:-}" ]; then
  OPENCLAW_NATS_TOKEN="$(openssl rand -hex 32)"
  export OPENCLAW_NATS_TOKEN
  if [ -f "$ENV_FILE" ] && ! $DRY_RUN; then
    set_env_key OPENCLAW_NATS_TOKEN "$OPENCLAW_NATS_TOKEN"
    info "Generated OPENCLAW_NATS_TOKEN and persisted to $ENV_FILE"
  fi
fi

# LLM backend defaults (docs/NODE_SPEC.md §3) — local-first for the memory
# organ; the agent provider is whatever env.sh resolved (--provider=, the env
# file, or a CLI on PATH). No provider is ever written by default: a node with
# no mind chosen says so and Step 13.5 asks.
if $SKIP_LLM; then
  if ${DISABLE_MODELS:-true} || ! grep -q '^OPENCLAW_MODEL_ENABLED=' "$ENV_FILE"; then
    set_env_key OPENCLAW_MODEL_ENABLED 0
    OPENCLAW_MODEL_ENABLED=0
  fi
elif ! grep -q '^OPENCLAW_MODEL_ENABLED=' "$ENV_FILE"; then
  set_env_key OPENCLAW_MODEL_ENABLED 1
  OPENCLAW_MODEL_ENABLED=1
fi
export OPENCLAW_MODEL_ENABLED="${OPENCLAW_MODEL_ENABLED:-1}"
if [ -f "$ENV_FILE" ] && [ -n "${OPENCLAW_PROVIDER:-}" ]; then
  set_env_key MESH_LLM_PROVIDER "$OPENCLAW_PROVIDER"
  info "MESH_LLM_PROVIDER=$OPENCLAW_PROVIDER recorded in $ENV_FILE"
fi
if [ -f "$ENV_FILE" ] && ! $DRY_RUN && ! grep -q '^LLM_MODEL=' "$ENV_FILE"; then
  echo "LLM_MODEL=qwen3:8b" >> "$ENV_FILE"
fi
if [ -f "$ENV_FILE" ] && ! $DRY_RUN && ! grep -q '^LLM_BASE_URL=' "$ENV_FILE"; then
  echo "LLM_BASE_URL=http://localhost:11434" >> "$ENV_FILE"
fi
export MESH_LLM_PROVIDER="${OPENCLAW_PROVIDER:-${MESH_LLM_PROVIDER:-}}"
export LLM_MODEL="${LLM_MODEL:-qwen3:8b}"
export LLM_BASE_URL="${LLM_BASE_URL:-http://localhost:11434}"
# Before the unit templates render: in a VM, the host's Ollama (llm-host.sh).
$SKIP_LLM || bridge_llm_to_host || true

# Set defaults for template substitution
export OPENCLAW_NODE_ID="${OPENCLAW_NODE_ID:-$(hostname -s)}"
export OPENCLAW_TIMEZONE="${OPENCLAW_TIMEZONE:-America/Montreal}"
export OPENCLAW_WORKSPACE="$WORKSPACE"

# ============================================================
# Step 8: Generate Configs from Templates
# ============================================================

step "Step 8: Configuration Files"

generate_config() {
  local template="$1"
  local output="$2"
  local basename
  basename=$(basename "$output")

  if [ -f "$output" ]; then
    info "Config $basename already exists, keeping it"
    return
  fi

  # P4-3: the redirect below bypassed run(); --dry-run rendered real configs.
  if $DRY_RUN; then
    info "  [dry-run] would render $template -> $output"
    return
  fi

  if command -v envsubst >/dev/null 2>&1; then
    envsubst < "$template" > "$output"
  else
    # Fallback: manual sed substitution
    sed \
      -e "s|\${HOME}|$HOME|g" \
      -e "s|\${OPENCLAW_WORKSPACE}|$WORKSPACE|g" \
      -e "s|\${OPENCLAW_REPO_DIR}|$REPO_DIR|g" \
      -e "s|\${OPENCLAW_NODE_ID}|$OPENCLAW_NODE_ID|g" \
      -e "s|\${OPENCLAW_TIMEZONE}|$OPENCLAW_TIMEZONE|g" \
      -e "s|\${OPENAI_API_KEY}|${OPENAI_API_KEY:-}|g" \
      -e "s|\${GOOGLE_API_KEY}|${GOOGLE_API_KEY:-}|g" \
      -e "s|\${ANTHROPIC_API_KEY}|${ANTHROPIC_API_KEY:-}|g" \
      -e "s|\${DISCORD_BOT_TOKEN}|${DISCORD_BOT_TOKEN:-}|g" \
      -e "s|\${TELEGRAM_BOT_TOKEN}|${TELEGRAM_BOT_TOKEN:-}|g" \
      -e "s|\${WEB_SEARCH_API_KEY}|${WEB_SEARCH_API_KEY:-}|g" \
      -e "s|\${OBSIDIAN_API_KEY}|${OBSIDIAN_API_KEY:-}|g" \
      -e "s|\${OPENCLAW_NATS}|${OPENCLAW_NATS:-}|g" \
      -e "s|\${OPENCLAW_NATS_TOKEN}|${OPENCLAW_NATS_TOKEN:-}|g" \
      -e "s|\${CLAUDE_PROJECT_WORKSPACE}|${CLAUDE_PROJECT_WORKSPACE}|g" \
      -e "s|\${CLAUDE_PROJECT_HOME}|${CLAUDE_PROJECT_HOME}|g" \
      -e "s|\${CLAUDE_PROJECT_REPO}|${CLAUDE_PROJECT_REPO}|g" \
      "$template" > "$output"
  fi
  run chmod 600 "$output"
  info "Generated $basename (mode 600)"
}

generate_config "$REPO_DIR/config/daemon.json.template" "$OPENCLAW_ROOT/config/daemon.json"
generate_config "$REPO_DIR/config/transcript-sources.json.template" "$OPENCLAW_ROOT/config/transcript-sources.json"

# NATS config rendering — templates → ~/.openclaw/config/. Every template
# `include`s nats-auth.conf, rendered further down (after the identity exists)
# by bin/nats-auth-render.mjs: token mode by default, per-node nkeys when
# OPENCLAW_NATS_AUTH=nkey. nats.conf is the DEFAULT single-node bus every fresh
# node runs; nats-{1,2,3} are the R=3 cluster (operator-gated, federation 1.5).
"$NODE_BIN" "$REPO_DIR/bin/nats-legacy-writer-check.mjs"
run mkdir -p "$OPENCLAW_ROOT/nats"
generate_config "$REPO_DIR/services/nats/nats-single.conf" "$OPENCLAW_ROOT/config/nats.conf"
generate_config "$REPO_DIR/services/nats/nats-1.conf" "$OPENCLAW_ROOT/config/nats-1.conf"
generate_config "$REPO_DIR/services/nats/nats-2.conf" "$OPENCLAW_ROOT/config/nats-2.conf"
generate_config "$REPO_DIR/services/nats/nats-3.conf" "$OPENCLAW_ROOT/config/nats-3.conf"

generate_config "$REPO_DIR/config/obsidian-sync.json.template" "$OPENCLAW_ROOT/config/obsidian-sync.json"
generate_config "$REPO_DIR/config/openclaw.json.template" "$OPENCLAW_ROOT/openclaw.json"

# ============================================================
# Step 8.5: Node Identity (ed25519 — grappe signing, federation 1.4)
# ============================================================

step "Step 8.5: Node Identity"

if $DRY_RUN; then
  info "[dry-run] would provision ed25519 identity at $OPENCLAW_ROOT"
elif OPENCLAW_IDENTITY_DIR="$OPENCLAW_ROOT" OPENCLAW_REPO_LIB="$REPO_DIR/lib" "$NODE_BIN" --input-type=module -e '
    const { getOrCreateIdentity } = await import(process.env.OPENCLAW_REPO_LIB + "/node-identity.mjs");
    const id = getOrCreateIdentity(process.env.OPENCLAW_IDENTITY_DIR);
    console.log("  identity:", id.publicKeyBase64.slice(0, 16) + "…");
  '; then
  info "Node identity provisioned"
else
  warn "Identity provisioning failed — signed grappe membership unavailable until fixed"
fi

# Print this node's identity pubkey in the RAW base64 form the verifiers compare
# against (lib/deploy-trigger-auth.mjs trustedDeployKeys, lib/operator-auth.mjs).
# identity.pub on disk is SPKI PEM — seeding the allowlist with the PEM text
# (the pre-Phase-7 bug) made strict signed deploy refuse every trigger.
identity_pubkey_base64() {
  OPENCLAW_IDENTITY_DIR="$OPENCLAW_ROOT" OPENCLAW_REPO_LIB="$REPO_DIR/lib" "$NODE_BIN" --input-type=module -e '
    const { getOrCreateIdentity } = await import(process.env.OPENCLAW_REPO_LIB + "/node-identity.mjs");
    process.stdout.write(getOrCreateIdentity(process.env.OPENCLAW_IDENTITY_DIR).publicKeyBase64);
  '
}

# Merge one key into a comma-separated allowlist variable in $ENV_FILE: keeps the
# keys the operator added for other machines (a plain overwrite dropped them on
# --update) and appends ours only when absent.
merge_trusted_key() {
  local var="$1" key="$2" current merged
  # grep exits 1 when the variable is absent; under set -e/pipefail that must
  # read as "empty", not abort the installer.
  current="$( { grep "^${var}=" "$ENV_FILE" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d "\"'")"
  case ",${current}," in
    *",${key},"*) merged="$current" ;;
    *) merged="${current:+${current},}${key}" ;;
  esac
  if grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
    run sed -i.bak "s|^${var}=.*|${var}=${merged}|" "$ENV_FILE" && run rm -f "$ENV_FILE.bak"
  else
    echo "${var}=${merged}" >> "$ENV_FILE"
  fi
  export "${var}=${merged}"
}

# Deploy-trigger trust (security review 2, F2): the deploy listener REQUIRES
# signed triggers. Seed the allowlist with this node's own raw pubkey; a worker
# joining with a lead pubkey (install.sh --lead-pubkey / join token, Phase 7)
# gets the lead's key merged in as well so lead-signed deploys are accepted.
if ! $DRY_RUN && [ -f "$OPENCLAW_ROOT/identity.key" ]; then
  if SELF_PUBKEY="$(identity_pubkey_base64)" && [ -n "$SELF_PUBKEY" ]; then
    merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS "$SELF_PUBKEY"
    merge_trusted_key OPENCLAW_OPERATOR_TRUSTED_KEYS "$SELF_PUBKEY"
    if [ -n "${OPENCLAW_LEAD_PUBKEY:-}" ]; then
      merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS "$OPENCLAW_LEAD_PUBKEY"
      merge_trusted_key OPENCLAW_OPERATOR_TRUSTED_KEYS "$OPENCLAW_LEAD_PUBKEY"
      info "Lead pubkey merged into the deploy/operator trust allowlists"
    fi
    info "Deploy-trigger trust provisioned (raw base64 identity pubkey; signing REQUIRED by the listener unit)"
  else
    warn "Could not derive the identity pubkey — OPENCLAW_DEPLOY_TRUSTED_KEYS left unchanged"
  fi
fi

# NATS auth policy (Phase 7). Default `token` reproduces the pre-Phase-7 block
# byte for byte; `nkey` renders a users list from this identity + the registry.
# Persist the mode so daemons (lib/nats-resolve.js) and the renderer agree.
if [ -z "${OPENCLAW_NATS_AUTH:-}" ]; then
  OPENCLAW_NATS_AUTH="$( { grep '^OPENCLAW_NATS_AUTH=' "$ENV_FILE" 2>/dev/null || true; } | head -1 | cut -d= -f2- | tr -d "\"'")"
fi
OPENCLAW_NATS_AUTH="${OPENCLAW_NATS_AUTH:-token}"
export OPENCLAW_NATS_AUTH
if [ -f "$ENV_FILE" ] && [ "$DRY_RUN" != true ] && ! grep -q '^OPENCLAW_NATS_AUTH=' "$ENV_FILE"; then
  echo "OPENCLAW_NATS_AUTH=$OPENCLAW_NATS_AUTH" >> "$ENV_FILE"
fi
if $DRY_RUN; then
  info "[dry-run] would render nats-auth.conf ($OPENCLAW_NATS_AUTH mode)"
elif [ -f "$OPENCLAW_ROOT/config/nats-auth.conf" ]; then
  info "Existing nats-auth.conf preserved; explicit credential changes use nats-auth-render.mjs"
elif OPENCLAW_IDENTITY_DIR="$OPENCLAW_ROOT" "$NODE_BIN" "$REPO_DIR/bin/nats-auth-render.mjs" \
       --out "$OPENCLAW_ROOT/config/nats-auth.conf" --mode "$OPENCLAW_NATS_AUTH"; then
  info "Rendered nats-auth.conf ($OPENCLAW_NATS_AUTH mode, mode 600)"
else
  warn "nats-auth.conf render failed — nats-server will refuse to start until it exists"
fi

if [ -n "$PENDING_CLUSTER_DIR" ]; then
  cp "$OPENCLAW_ROOT/config/nats-auth.conf" "$PENDING_CLUSTER_DIR/nats-auth.conf"
  chmod 600 "$PENDING_CLUSTER_DIR/nats-auth.conf"
  if ! "$NATS_SERVER_BIN" -t -c "$PENDING_CLUSTER_DIR/nats.conf" > "$PENDING_CLUSTER_DIR/validation.log" 2>&1; then
    error "Cluster config does not validate with the prepared auth policy; existing topology is unchanged"
    exit 1
  fi
  mv "$PENDING_CLUSTER_DIR/nats.conf" "$OPENCLAW_ROOT/config/nats.conf"
  set_env_key OPENCLAW_KV_REPLICAS "$KV_REPLICAS"
  if $CLUSTER_PASS_GENERATED; then
    set_env_key OPENCLAW_NATS_CLUSTER_PASS "$OPENCLAW_NATS_CLUSTER_PASS"
  elif ! grep -q '^OPENCLAW_NATS_CLUSTER_PASS=' "$ENV_FILE"; then
    printf '%s\n' "OPENCLAW_NATS_CLUSTER_PASS=$OPENCLAW_NATS_CLUSTER_PASS" >> "$ENV_FILE"
  fi
  export OPENCLAW_NATS="nats://$CLUSTER_BIND:4222"
  export OPENCLAW_KV_REPLICAS="$KV_REPLICAS"
  set_env_key OPENCLAW_NATS "$OPENCLAW_NATS"
  rm -rf "$PENDING_CLUSTER_DIR"
  PENDING_CLUSTER_DIR=""
  $_INSTALLER_LOCK_HELD || trap - EXIT
  info "Validated cluster configuration selected; KV replica target R=$KV_REPLICAS"
  warn "Start nats-server on all council machines before the daemons; no cluster was started here."
fi
