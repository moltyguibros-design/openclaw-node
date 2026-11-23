# ============================================================
# Repo runtime dependencies and the event-schemas dist
# ============================================================
#
# One dependency step for both update paths: env.sh sources this file
# (install.sh, install.sh --update), and the mesh-deploy 'deps' component runs it
# on every node whose deploy touches package.json, package-lock.json or packages/:
#
#   bash scripts/install/deps.sh REPO_DIR WORKSPACE

# The mesh daemons exec from the repo tree and require the repo's node_modules
# (`nats` above all). The npx path ships them; the git-clone path does not. A
# persistent checkout updated by `git pull && install.sh --update` keeps its
# node_modules, so the install also reruns when package.json or the lockfile
# differs from what node_modules was installed from. npm's own
# node_modules/.package-lock.json cannot be that record: it has no root entry
# and, under --omit=dev, no dev deps, so it never equals package-lock.json.
repo_deps_sha() {
  local f
  for f in package.json package-lock.json; do
    if [ -f "$1/$f" ]; then cat "$1/$f"; fi
  done | if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi | cut -d' ' -f1
}

install_repo_deps() {
  local repo="$1" want cmd=install
  want="$(repo_deps_sha "$repo")"
  if [ -d "$repo/node_modules/nats" ] && [ "$(cat "$repo/node_modules/.openclaw-deps.sha" 2>/dev/null)" = "$want" ]; then
    info "Repo node_modules match package.json + package-lock.json"
    return 0
  fi
  # npm pack never ships the lockfile.
  if [ -f "$repo/package-lock.json" ]; then cmd=ci; fi
  info "Installing repo runtime dependencies (npm $cmd --omit=dev)..."
  (cd "$repo" && run npm "$cmd" --omit=dev) || return 1
  if ! $DRY_RUN; then printf '%s\n' "$want" > "$repo/node_modules/.openclaw-deps.sha"; fi
}

# The memory daemon imports packages/event-schemas/dist and exits at startup
# without it. dist/ is gitignored and --omit=dev leaves no compiler behind, so a
# git checkout has none (the npm tarball now gets it from prepack). On the first
# virgin-Mac run the tarball had none either: the daemon died silently and the
# acceptance gate failed five rows downstream (no DBs, no inject token, no event
# stream). It is also rebuilt when a source file is newer than the dist, which
# is what a pulled or checked-out schema change leaves; a tree with no src/
# keeps the dist it shipped with.
event_schemas_stale() {
  local pkg="$1/packages/event-schemas"
  [ -f "$pkg/dist/index.js" ] || return 0
  [ -d "$pkg/src" ] && [ -n "$(find "$pkg/src" -newer "$pkg/dist/index.js" -print -quit)" ]
}

build_event_schemas() {
  local repo="$1"
  if ! event_schemas_stale "$repo"; then
    info "event-schemas dist up to date"
    return 0
  fi
  info "Building event-schemas (memory daemon refuses to start without its dist)..."
  (cd "$repo" && run npx --yes --package typescript@5 tsc -p packages/event-schemas/tsconfig.json) \
    || { error "event-schemas build failed — the memory daemon cannot start"; return 1; }
  if $DRY_RUN; then return 0; fi
  if [ ! -f "$repo/packages/event-schemas/dist/index.js" ]; then
    error "event-schemas build produced no dist/index.js — the memory daemon cannot start"
    return 1
  fi
  # tsc can leave an unchanged output's mtime alone; the staleness test needs the build time.
  touch "$repo/packages/event-schemas/dist/index.js"
  info "event-schemas built"
}

# The copied daemons and mesh libraries are the root package's runtime code, and
# ESM static imports do not resolve through NODE_PATH: each deployed parent tree
# gets a node_modules of links into the repo's one installed dependency set. A
# package the repo gained since the last run gets its link; existing ones already
# point at the reinstalled tree.
# A link into an older npx copy ($OPENCLAW_ROOT/harness/<version>) is moved to
# this run's tree: left there, the daemons kept the first version's libraries and
# cli.js could never remove that copy. Any other existing entry is left alone.
link_dependency() {
  local target="$1" link="$2"
  if [ -e "$link" ]; then
    [ -L "$link" ] || return 0
    case "$(readlink "$link")" in
      "$target") return 0 ;;
      "${OPENCLAW_ROOT:-$HOME/.openclaw}/harness/"*) ;;
      *) return 0 ;;
    esac
  fi
  run ln -sfn "$target" "$link"
  LINKED_COUNT=$((LINKED_COUNT + 1))
}
link_dependency_tree() {
  local src="$1" dest="$2" pkgdir pkg scoped_dir scoped
  LINKED_COUNT=0
  run mkdir -p "$dest"
  for pkgdir in "$src"/*/; do
    [ -d "$pkgdir" ] || continue
    pkg=$(basename "$pkgdir")
    [ "$pkg" = ".bin" ] && continue
    if [[ "$pkg" == @* ]]; then
      run mkdir -p "$dest/$pkg"
      for scoped_dir in "$pkgdir"*/; do
        [ -d "$scoped_dir" ] || continue
        scoped=$(basename "$scoped_dir")
        link_dependency "$pkgdir$scoped" "$dest/$pkg/$scoped"
      done
    else
      link_dependency "$src/$pkg" "$dest/$pkg"
    fi
  done
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  if [ $# -ne 2 ]; then
    echo "usage: bash $0 REPO_DIR WORKSPACE" >&2
    exit 2
  fi
  DRY_RUN=false
  source "$(dirname "$0")/helpers.sh"
  REPO_DIR="$1" WORKSPACE="$2"
  install_repo_deps "$REPO_DIR" || { error "repo npm install failed — mesh daemons cannot run"; exit 1; }
  build_event_schemas "$REPO_DIR" || exit 1
  # What workspace.sh Step 3 installs: the workspace copy of packages/ (the
  # memory daemon's event spine imports its dist) and the dependency links.
  mkdir -p "$WORKSPACE/packages"
  rsync -a --exclude='node_modules' "$REPO_DIR/packages/" "$WORKSPACE/packages/"
  link_dependency_tree "$REPO_DIR/node_modules" "$WORKSPACE/node_modules"
  info "Workspace packages/ refreshed, $LINKED_COUNT new dependency link(s) in $WORKSPACE/node_modules"
  MESH_HOME_NM="${OPENCLAW_MESH_HOME:-$HOME/openclaw}/node_modules"
  if [ "$REPO_DIR/node_modules" != "$MESH_HOME_NM" ]; then
    link_dependency_tree "$REPO_DIR/node_modules" "$MESH_HOME_NM"
    info "$LINKED_COUNT new dependency link(s) in $MESH_HOME_NM"
  fi
fi
