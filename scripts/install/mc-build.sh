# ============================================================
# Mission Control dependencies + build
# ============================================================
#
# workspace-docs/RUNBOOK_MC_DEPLOY.md steps 2-3, shared by install.sh
# (components.sh Step 11 sources this file) and the mesh-deploy 'mc' component:
#
#   bash scripts/install/mc-build.sh MC_DIR NODE_BIN_DIR
#
# Dependencies, build and the native rebuild all run under the node the unit
# runs (NODE_BIN's dir leads the unit PATH): better-sqlite3 built for another
# node ABI fails every DB route. npm 10 is the npm major the lockfile is kept
# with. `npm ci` reruns when package.json, the lockfile or that node changed.

source "$(dirname "${BASH_SOURCE[0]}")/deps.sh"

mc_deps_stamp() {
  printf '%s %s\n' "$(repo_deps_sha "$1")" "$(PATH="$2:$PATH" node --version)"
}

# Next bakes its distDir into every route module, so a build made in a side
# directory cannot be renamed into place. The previous build is set aside
# instead and put back if this one fails: the unit always has a build to serve.
mc_install_and_build() {
  local mc="$1" mc_path="$2:$PATH" want
  want="$(mc_deps_stamp "$1" "$2")"
  if [ -d "$mc/node_modules" ] && [ "$(cat "$mc/node_modules/.openclaw-deps.sha" 2>/dev/null)" = "$want" ]; then
    info "Mission Control dependencies match its lockfile and node"
  else
    info "Installing Mission Control dependencies (npm ci, this may take a minute)..."
    if ! (cd "$mc" && export PATH="$mc_path" && run npx -y npm@10 ci && run npm rebuild better-sqlite3); then
      warn "Mission Control dependency install FAILED — not building (see the npm output above)."
      return 1
    fi
    if ! $DRY_RUN; then printf '%s\n' "$want" > "$mc/node_modules/.openclaw-deps.sha"; fi
  fi
  run rm -rf "$mc/.next.prev"
  if [ -d "$mc/.next" ]; then run mv "$mc/.next" "$mc/.next.prev"; fi
  info "Building Mission Control (next build)..."
  if (cd "$mc" && export PATH="$mc_path" && run npm run build); then
    run rm -rf "$mc/.next.prev"
    info "Mission Control production build ready"
    return 0
  fi
  run rm -rf "$mc/.next"
  if [ -d "$mc/.next.prev" ]; then
    run mv "$mc/.next.prev" "$mc/.next"
    warn "Mission Control build FAILED — the previous build is still in place (see the next build output above)."
  else
    warn "Mission Control build FAILED — the unit cannot serve until fixed (see the next build output above)."
  fi
  return 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  if [ $# -ne 2 ]; then
    echo "usage: bash $0 MC_DIR NODE_BIN_DIR" >&2
    exit 2
  fi
  DRY_RUN=false
  source "$(dirname "$0")/helpers.sh"
  mc_install_and_build "$1" "$2"
fi
