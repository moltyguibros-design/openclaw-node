step "Stage checkout-independent runtime"

if $DRY_RUN; then
  info "[dry-run] would stage source/dependencies into $OPENCLAW_ROOT/runtime/node"
  export OPENCLAW_RUNTIME_DIR="$REPO_DIR"
else
  export OPENCLAW_SOURCE_DIR="$REPO_DIR"
  RUNTIME_RESULT="$("$NODE_BIN" "$REPO_DIR/bin/deploy-runtime.mjs" --source "$REPO_DIR" --root "$OPENCLAW_ROOT" --json)"
  OPENCLAW_RUNTIME_DIR="$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(process.argv[1]).release)' "$RUNTIME_RESULT")"
  OPENCLAW_INSTALLATION_ATTEMPT="$("$NODE_BIN" -e 'process.stdout.write(JSON.parse(process.argv[1]).attemptId)' "$RUNTIME_RESULT")"
  export OPENCLAW_RUNTIME_DIR
  REPO_DIR="$OPENCLAW_RUNTIME_DIR"
  export REPO_DIR
fi
export OPENCLAW_REPO_DIR="$OPENCLAW_RUNTIME_DIR"
