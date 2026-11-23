# ============================================================
# Step 17: Mesh Network (optional — if Tailscale detected)
# ============================================================

step "Step 17: Mesh Network"

if $SKIP_MESH; then
  info "Skipped (--skip-mesh flag set by meta-installer)"
  MESH_AVAILABLE=false
else

MESH_AVAILABLE=false
if command -v tailscale >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
  if [ -n "$TS_IP" ]; then
    info "Tailscale connected: $TS_IP"
    MESH_AVAILABLE=true
  else
    warn "Tailscale installed but not connected — skipping mesh setup"
    warn "Connect Tailscale and re-run with --update to enable mesh"
  fi
else
  info "Tailscale not found — single-node mode (mesh features disabled)"
  info "Install Tailscale + run again to enable multi-node mesh"
fi

if $MESH_AVAILABLE; then
  # Install mesh skill to managed location (tier 2: visible to all agents)
  if [ -f "$REPO_DIR/skills/mesh/SKILL.md" ]; then
    run mkdir -p "$HOME/.openclaw/skills/mesh"
    run cp "$REPO_DIR/skills/mesh/SKILL.md" "$HOME/.openclaw/skills/mesh/SKILL.md"
    info "Mesh skill installed to ~/.openclaw/skills/mesh/ (all agents)"
  fi
fi

fi  # end SKIP_MESH else block

# ============================================================
# Step 18: Path-Scoped Rules
# ============================================================

step "Step 18: Path-Scoped Rules"

RULES_DIR="${OPENCLAW_ROOT}/rules"
run mkdir -p "$RULES_DIR"

# rule_hash FILE — content hash, empty when no hasher is available.
rule_hash() {
  if command -v md5sum &>/dev/null; then
    md5sum "$1" | cut -d' ' -f1
  elif command -v md5 &>/dev/null; then
    md5 -q "$1"
  fi
}

# install_rule — version-aware rule deployment.
# Every copy records the installed source's hash in ${dst}.sha. On a version
# bump the rule is overwritten only when the local copy still matches that
# record (unmodified); otherwise the new version is saved as .new. Comparing
# the local copy with the new source can't tell: an unmodified copy always
# differs from a newer version.
install_rule() {
  local src="$1" dst="$2" name="$3"
  local rec="${dst}.sha"
  if [ ! -f "$src" ]; then return; fi

  if [ ! -f "$dst" ]; then
    run cp "$src" "$dst"
    rule_hash "$src" | write_file "$rec"
    info "Installed rule: ${name}"
    return
  fi

  local src_ver dst_ver dst_hash
  src_ver=$(grep -m1 '^version:' "$src" 2>/dev/null | sed 's/version:[[:space:]]*//')
  dst_ver=$(grep -m1 '^version:' "$dst" 2>/dev/null | sed 's/version:[[:space:]]*//')
  dst_hash=$(rule_hash "$dst")

  if [ "$src_ver" = "$dst_ver" ]; then
    # Copies installed before records existed get one while still pristine,
    # so their next version bump can update in place.
    if [ ! -f "$rec" ] && [ -n "$dst_hash" ] && [ "$dst_hash" = "$(rule_hash "$src")" ]; then
      echo "$dst_hash" | write_file "$rec"
    fi
    return
  fi

  if [ -n "$dst_hash" ] && [ -f "$rec" ] && [ "$dst_hash" = "$(cat "$rec")" ]; then
    run cp "$src" "$dst"
    rule_hash "$src" | write_file "$rec"
    info "Updated rule: ${name} (${dst_ver} → ${src_ver})"
  elif [ -f "$rec" ]; then
    run cp "$src" "${dst}.new"
    warn "Rule ${name}: new version ${src_ver} available but local copy modified. Saved as ${name}.new for manual merge."
  else
    run cp "$src" "${dst}.new"
    warn "Rule ${name}: new version ${src_ver} available; no install record proves the local copy unmodified. Saved as ${name}.new for manual merge."
  fi
}

# Copy universal rules (always)
for rule in security test-standards design-docs git-hygiene; do
  install_rule "${REPO_DIR}/config/rules/universal/${rule}.md" "${RULES_DIR}/${rule}.md" "${rule}.md"
done

# Framework rules follow an explicitly named project (--project=PATH). The
# installer's cwd is PKG_ROOT under npx and arbitrary otherwise, and $HOME is
# not a project, so neither is ever a detection input.
if [ -n "$PROJECT_DIR" ]; then
  if [ -f "$PROJECT_DIR/package.json" ] && grep -q '"hardhat"' "$PROJECT_DIR/package.json" 2>/dev/null \
     || [ -f "$PROJECT_DIR/hardhat.config.js" ] || [ -f "$PROJECT_DIR/hardhat.config.ts" ] || [ -f "$PROJECT_DIR/foundry.toml" ]; then
    install_rule "${REPO_DIR}/config/rules/framework/solidity.md" "${RULES_DIR}/solidity.md" "solidity.md"
  fi
  if [ -f "$PROJECT_DIR/tsconfig.json" ]; then
    install_rule "${REPO_DIR}/config/rules/framework/typescript.md" "${RULES_DIR}/typescript.md" "typescript.md"
  fi
  if [ -d "$PROJECT_DIR/ProjectSettings" ] || [ -d "$PROJECT_DIR/Assets" ]; then
    install_rule "${REPO_DIR}/config/rules/framework/unity.md" "${RULES_DIR}/unity.md" "unity.md"
  fi
else
  info "No --project given: framework rules skipped (universal rules only)"
fi

info "Rules directory: ${RULES_DIR} ($(find "$RULES_DIR" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ') rules)"

# ============================================================
# Step 19: Plan Templates
# ============================================================

step "Step 19: Plan Templates"

TEMPLATES_DIR="${OPENCLAW_ROOT}/plan-templates"
run mkdir -p "$TEMPLATES_DIR"

# install_template — `mesh plan` reads this folder before the shipped templates,
# so a copy must follow the shipped one or every template fix stays shadowed.
# Templates carry no version: line, so the ${dst}.sha record of what was last
# copied decides: a copy still matching it was never edited and is refreshed;
# an edited one is kept and the new version saved as .new.
install_template() {
  local src="$1" dst="$2" name="$3"
  local rec="${dst}.sha" src_hash dst_hash
  if [ ! -f "$src" ]; then return; fi
  src_hash=$(rule_hash "$src")

  if [ ! -f "$dst" ]; then
    run cp "$src" "$dst"
    echo "$src_hash" | write_file "$rec"
    info "Installed plan template: ${name}"
    return
  fi

  dst_hash=$(rule_hash "$dst")
  if [ -z "$dst_hash" ] || [ "$dst_hash" = "$src_hash" ]; then
    # Copies from before records existed are adopted while still pristine.
    if [ -n "$dst_hash" ] && [ ! -f "$rec" ]; then echo "$dst_hash" | write_file "$rec"; fi
    return
  fi

  if [ -f "$rec" ] && [ "$dst_hash" = "$(cat "$rec")" ]; then
    run cp "$src" "$dst"
    echo "$src_hash" | write_file "$rec"
    info "Updated plan template: ${name}"
  else
    run cp "$src" "${dst}.new"
    warn "Plan template ${name}: a newer version ships but the local copy was edited (or has no install record). Saved as ${name}.new for manual merge."
  fi
}

for tmpl in team-feature team-bugfix team-deploy; do
  install_template "${REPO_DIR}/config/plan-templates/${tmpl}.yaml" "${TEMPLATES_DIR}/${tmpl}.yaml" "${tmpl}.yaml"
done

info "Templates directory: ${TEMPLATES_DIR}"

# ============================================================
# Step 20: Claude Code Integration
# ============================================================

step "Step 20: Claude Code Integration"

# Create .claude directory structure (in workspace root)
CLAUDE_DIR="${WORKSPACE}/.claude"
run mkdir -p "${CLAUDE_DIR}/hooks"

# Symlink rules directory
RULES_LINK="${CLAUDE_DIR}/rules"
if [ ! -L "$RULES_LINK" ] && [ ! -d "$RULES_LINK" ]; then
  run ln -s "${RULES_DIR}" "$RULES_LINK"
  info "Symlinked .claude/rules → ${RULES_DIR}"
fi

# Deploy settings.json — merge hooks into existing if present, never overwrite permissions
SETTINGS_SRC="${REPO_DIR}/config/claude-settings.json"
SETTINGS_DST="${CLAUDE_DIR}/settings.json"
if [ -f "$SETTINGS_SRC" ]; then
  if [ ! -f "$SETTINGS_DST" ]; then
    # Fresh install — copy wholesale
    run cp "$SETTINGS_SRC" "$SETTINGS_DST"
    info "Deployed Claude Code settings.json"
  elif $DRY_RUN; then
    echo "  [dry-run] jq-merge OpenClaw hooks into $SETTINGS_DST"
  elif command -v jq &>/dev/null; then
    # Existing settings — merge hooks only, preserve user permissions
    # Strategy: for each hook lifecycle key (SessionStart, PreToolUse, etc.),
    # append our hook entries if they don't already exist (matched by command string)
    MERGED=$(jq -s '
      .[0] as $existing | .[1] as $new |
      $existing * {
        hooks: (
          ($new.hooks // {}) | to_entries | reduce .[] as $entry (
            ($existing.hooks // {});
            .[$entry.key] as $current |
            if $current == null then
              . + {($entry.key): $entry.value}
            else
              # Append hook entries whose command is not already present
              ($current | map(.hooks) | flatten | map(.command)) as $existing_cmds |
              ($entry.value | map(
                .hooks |= [.[] | select(.command as $cmd | $existing_cmds | index($cmd) | not)]
                | select(.hooks | length > 0)
              )) as $new_entries |
              if ($new_entries | length) > 0 then
                . + {($entry.key): ($current + $new_entries)}
              else .
              end
            end
          )
        )
      }
      # session-stop.sh moved from Stop, which fires after every turn, to SessionEnd.
      | if .hooks.Stop then
          .hooks.Stop |= map(
            .hooks |= map(select(.command != "bash .claude/hooks/session-stop.sh"))
            | select(.hooks | length > 0)
          )
          | if .hooks.Stop == [] then del(.hooks.Stop) else . end
        else .
        end
    ' "$SETTINGS_DST" "$SETTINGS_SRC")
    echo "$MERGED" > "$SETTINGS_DST"
    info "Merged OpenClaw hooks into existing settings.json (permissions preserved)"
  else
    # No jq — can't safely merge. Dump patch file for manual merge.
    run cp "$SETTINGS_SRC" "${SETTINGS_DST}.openclaw-hooks"
    warn "jq not found — hooks config saved to settings.json.openclaw-hooks for manual merge"
  fi
fi

# Deploy hook scripts
for hook in session-start validate-commit validate-push pre-compact session-stop log-agent; do
  HOOK_SRC="${REPO_DIR}/.claude/hooks/${hook}.sh"
  HOOK_DST="${CLAUDE_DIR}/hooks/${hook}.sh"
  if [ -f "$HOOK_SRC" ]; then
    run cp "$HOOK_SRC" "$HOOK_DST"
    run chmod +x "$HOOK_DST"
  fi
done
# The PreCompact hook runs the extraction trigger from this checkout. %q keeps any path
# one literal word of the hook's own bash.
if [ -f "${CLAUDE_DIR}/hooks/pre-compact.sh" ]; then
  set_env_key DEPLOYED_REPO_DIR "$(printf '%q' "$REPO_DIR")" "${CLAUDE_DIR}/hooks/pre-compact.sh"
fi
info "Deployed Claude Code hooks"

# Deploy git hooks (LLM-agnostic enforcement) — only into an explicitly named
# project; cwd or $HOME/.git would put them into an unrelated repository.
if [ -n "$PROJECT_DIR" ]; then
  GIT_HOOKS_DIR="${PROJECT_DIR}/.git/hooks"
  if [ -d "$GIT_HOOKS_DIR" ]; then
    for ghook in pre-commit pre-push; do
      GHOOK_SRC="${REPO_DIR}/config/git-hooks/${ghook}"
      GHOOK_DST="${GIT_HOOKS_DIR}/${ghook}"
      if [ -f "$GHOOK_SRC" ] && [ ! -f "$GHOOK_DST" ]; then
        run cp "$GHOOK_SRC" "$GHOOK_DST"
        set_env_key DEPLOYED_HOOK_DIR "$(printf '%q' "${CLAUDE_DIR}/hooks")" "$GHOOK_DST"
        run chmod +x "$GHOOK_DST"
        info "Installed git hook: ${ghook}"
      fi
    done
  else
    warn "--project ${PROJECT_DIR} has no .git/hooks — git hooks not installed"
  fi
fi
