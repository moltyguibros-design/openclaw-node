#!/usr/bin/env bash
# prereqs.sh — install/verify the system baseline install.sh depends on.
#
#   bash scripts/install/prereqs.sh           # install what is missing
#   bash scripts/install/prereqs.sh --check   # verify only, change nothing
#
# Exit 0 only when every hard dependency is actually present. This is the single
# implementation; system-deps.sh calls it rather than keeping its own per-OS
# branches (which silently no-opped on macOS).
#
# For a machine with NOTHING on it -- no Homebrew, no Node -- use bootstrap.sh
# at the repo root instead; it installs Homebrew first and then calls this.
#
# NOT `set -u`: stock macOS /bin/bash is 3.2, where empty "$@"/${#arr[@]} raise
# "unbound variable" under nounset. Expansions below are guarded explicitly.
set -o pipefail

CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

if ! declare -f ok >/dev/null 2>&1; then
  _G='\033[0;32m'; _Y='\033[1;33m'; _R='\033[0;31m'; _N='\033[0m'
  ok()   { echo -e "${_G}[+]${_N} $*"; }
  warn() { echo -e "${_Y}[!]${_N} $*"; }
  error() { echo -e "${_R}[x]${_N} $*"; }
fi
declare -f info >/dev/null 2>&1 || info() { echo -e "\033[0;32m[+]\033[0m $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$(uname -s)" in
  Darwin) PREREQ_OS=macos ;;
  Linux)  PREREQ_OS=linux ;;
  *) error "unsupported OS: $(uname -s)"; exit 1 ;;
esac

if [ "$(id -u)" -eq 0 ]; then SUDO=""
elif have sudo; then SUDO="sudo"
else SUDO=""; fi

node_ok() {
  have node || return 1
  local version
  version="$(node -v 2>/dev/null)"
  [[ "$version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  [ "${BASH_REMATCH[1]}" -gt 22 ] || { [ "${BASH_REMATCH[1]}" -eq 22 ] && [ "${BASH_REMATCH[2]}" -ge 12 ]; }
}
nats_version_ok() {
  local major minor patch
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r major minor patch <<< "$1"
  if [ "$major" -gt 2 ]; then return 0; fi
  if [ "$major" -ne 2 ]; then return 1; fi
  if [ "$minor" -gt 12 ]; then return 0; fi
  [ "$minor" -eq 12 ] && [ "$patch" -ge 15 ]
}
nats_ok() {
  have nats-server || return 1
  local version
  version="$(nats-server -v 2>/dev/null)"
  nats_version_ok "${version#nats-server: v}"
}

# ---------- macOS ----------
if [ "$PREREQ_OS" = macos ]; then
  if xcode-select -p >/dev/null 2>&1; then
    ok "Xcode Command Line Tools: $(xcode-select -p)"
  else
    error "Xcode Command Line Tools MISSING — better-sqlite3 cannot compile without them"
    $CHECK_ONLY || { warn "run: xcode-select --install   (or use bootstrap.sh)"; }
  fi

  if ! have brew; then
    for c in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$c" ] && eval "$("$c" shellenv)" && break
    done
  fi
  if have brew; then
    ok "homebrew: $(brew --version | head -1)"
  else
    error "Homebrew MISSING — it is how every other macOS dependency installs."
    error "Use bootstrap.sh (installs Homebrew for you) or install it manually first."
    exit 1
  fi

  if node_ok; then
    ok "node $(node -v)"
  elif $CHECK_ONLY; then
    error "node 22.12+ MISSING (found: $(node -v 2>/dev/null || echo none))"
  else
    brew install node@22 && brew link --overwrite --force node@22
    node_ok && ok "node $(node -v)" || error "node 22.12+ still unavailable after install"
  fi

  # Report on the BINARY, never on the package manager's exit code: a formula
  # can install "successfully" and leave nothing on PATH (keg-only, bad link).
  FORMULAE="python@3.12 git sqlite jq nats-server"
  [ "${OPENCLAW_SKIP_LLM:-0}" = "1" ] || FORMULAE="$FORMULAE ollama"
  for f in $FORMULAE; do
    bin="$f"
    case "$f" in python@3.12) bin=python3 ;; sqlite) bin=sqlite3 ;; esac
    if { [ "$f" = nats-server ] && nats_ok; } || { [ "$f" != nats-server ] && have "$bin"; }; then
      ok "$bin present"
    elif $CHECK_ONLY; then
      error "$bin MISSING"
    else
      if [ "$f" = nats-server ] && have nats-server; then brew upgrade nats-server
      else brew install "$f"; fi
      if [ "$f" = nats-server ]; then
        nats_ok && ok "$f installed (supported version on PATH)" || error "$f: supported version still not on PATH"
      else
        have "$bin" && ok "$f installed ($bin on PATH)" || error "$f: $bin still not on PATH"
      fi
    fi
  done

  # install.sh derives --cluster-bind from `tailscale ip -4`.
  if [ "${OPENCLAW_SKIP_MESH:-0}" = 1 ]; then
    info "tailscale skipped (--skip-mesh)"
  elif have tailscale; then
    ok "tailscale present"
  elif $CHECK_ONLY; then
    error "tailscale MISSING (mesh clustering will not work)"
  else
    brew install --cask tailscale-app </dev/null
    # The cask puts the CLI inside the app bundle, not on PATH.
    TS_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    [ -x "$TS_CLI" ] && ln -sf "$TS_CLI" "$(brew --prefix)/bin/tailscale" 2>/dev/null
    have tailscale && ok "tailscale installed" || error "tailscale CLI still not on PATH"
  fi

# ---------- Debian / Ubuntu ----------
else
  have apt-get || { error "only Debian/Ubuntu apt is supported on Linux"; exit 1; }

  if ! $CHECK_ONLY; then
    # Unconditional. The old code refreshed lists only inside its node-missing
    # branch, so a box already carrying Node 22 installed against stale lists
    # and died mid-run under `set -e`.
    $SUDO apt-get update -y || { error "apt-get update failed"; exit 1; }
    $SUDO apt-get install -y \
      curl git sqlite3 build-essential jq python3 python3-pip python3-venv ca-certificates gnupg \
      || error "apt baseline install failed"
  fi

  for bin in git sqlite3 build-essential jq python3 curl; do
    probe="$bin"; [ "$bin" = build-essential ] && probe=cc
    have "$probe" && ok "$bin present" || error "$bin MISSING"
  done

  if node_ok; then
    ok "node $(node -v)"
  elif $CHECK_ONLY; then
    error "node 22.12+ MISSING (found: $(node -v 2>/dev/null || echo none))"
  else
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    $SUDO apt-get update -y && $SUDO apt-get install -y nodejs
    node_ok && ok "node $(node -v)" || error "node 22.12+ still unavailable after install"
  fi

  if nats_ok; then
    ok "nats-server present"
  elif $CHECK_ONLY; then
    error "nats-server 2.12.15+ MISSING (found: $(nats-server -v 2>/dev/null || echo none))"
  else
    V="${OPENCLAW_NATS_SERVER_VERSION:-2.12.15}"
    nats_version_ok "$V" || { error "unsupported nats-server version: $V"; exit 1; }
    case "$(uname -m)" in
      aarch64|arm64) A=arm64 ;;
      x86_64|amd64) A=amd64 ;;
      *) error "unsupported nats-server architecture: $(uname -m)"; exit 1 ;;
    esac
    if [ "$V" = 2.12.15 ]; then
      if [ "$A" = arm64 ]; then EXPECTED=b724db99fefbf8f5c808baa82819ee50350aee9734017e4a478f7e545cef3ab6
      else EXPECTED=58ab8131f819263897e2fc38e503e1b755b63bcafeecc7d12582487df48ca15e; fi
    else
      EXPECTED="${OPENCLAW_NATS_SERVER_SHA256:-}"
    fi
    [[ "$EXPECTED" =~ ^[a-f0-9]{64}$ ]] || { error "nats-server override requires its SHA-256 digest"; exit 1; }
    T=$(mktemp -d)
    ARCHIVE="$T/nats-server.tar.gz"
    curl -fsSL --output "$ARCHIVE" "https://github.com/nats-io/nats-server/releases/download/v${V}/nats-server-v${V}-linux-${A}.tar.gz" \
      || { rm -rf "$T"; error "nats-server download failed"; exit 1; }
    printf '%s  %s\n' "$EXPECTED" "$ARCHIVE" | sha256sum -c - >/dev/null \
      || { rm -rf "$T"; error "nats-server archive checksum mismatch"; exit 1; }
    tar xzf "$ARCHIVE" -C "$T" "nats-server-v${V}-linux-${A}/nats-server" \
      || { rm -rf "$T"; error "nats-server extraction failed"; exit 1; }
    $SUDO install "$T/nats-server-v${V}-linux-${A}/nats-server" /usr/local/bin/nats-server \
      || { rm -rf "$T"; error "nats-server installation failed"; exit 1; }
    nats_ok && ok "nats-server v$V installed" || { error "supported nats-server not on PATH"; exit 1; }
    rm -rf "$T"
  fi

  if [ "${OPENCLAW_SKIP_LLM:-0}" = "1" ]; then
    info "ollama skipped (--skip-llm) — extraction degrades to regex"
  elif have ollama; then
    ok "ollama present"
  elif $CHECK_ONLY; then
    error "ollama MISSING"
  else
    curl -fsSL https://ollama.com/install.sh | sh
    have ollama && ok "ollama installed" || warn "ollama not on PATH — extraction degrades to regex"
  fi

  if [ "${OPENCLAW_SKIP_MESH:-0}" = 1 ]; then
    info "tailscale skipped (--skip-mesh)"
  elif have tailscale; then
    ok "tailscale present"
  elif $CHECK_ONLY; then
    error "tailscale MISSING (mesh clustering will not work)"
  else
    curl -fsSL https://tailscale.com/install.sh | sh
    have tailscale && ok "tailscale installed" || error "tailscale not on PATH"
  fi
fi

# ---------- PyYAML (compile-boot hard dependency) ----------
if python3 -c 'import yaml' 2>/dev/null; then
  ok "PyYAML present"
elif $CHECK_ONLY; then
  error "PyYAML MISSING — compile-boot will not work"
else
  python3 -m pip install --user pyyaml 2>/dev/null \
    || python3 -m pip install --user --break-system-packages pyyaml 2>/dev/null
  python3 -c 'import yaml' 2>/dev/null && ok "PyYAML installed" \
    || error "PyYAML install failed — compile-boot will not work"
fi

# ---------- Gate ----------
PREREQ_FAIL=0
_chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else error "$1 — MISSING"; PREREQ_FAIL=1; fi; }
echo ""
echo "───── prerequisite gate ─────"
_chk "node 22.12+"   'node_ok'
_chk "python3 3.8+"  'python3 -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)"'
_chk "PyYAML"        'python3 -c "import yaml"'
_chk "git"           'command -v git'
_chk "sqlite3"       'command -v sqlite3'
_chk "build tools"   '{ [ "$PREREQ_OS" = macos ] && xcode-select -p; } || command -v cc'
_chk "curl"          'command -v curl'
_chk "jq"            'command -v jq'
_chk "nats-server 2.12.15+" 'nats_ok'
[ "${OPENCLAW_SKIP_LLM:-0}" = "1" ] || _chk "ollama" 'command -v ollama'
[ "${OPENCLAW_SKIP_MESH:-0}" = "1" ] || _chk "tailscale" 'command -v tailscale'
echo ""

exit $PREREQ_FAIL
