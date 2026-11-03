#!/usr/bin/env bash
# bootstrap.sh — ONE-COMMAND install of an OpenClaw node on a virgin machine.
#
#   curl -fsSL https://raw.githubusercontent.com/moltyguibros-design/openclaw-node/main/bootstrap.sh | bash
#
# This is the only entrypoint that works on a machine with nothing on it.
# `npx openclaw-node-harness` cannot be: npx requires npm requires Node, and
# Node is one of the things we are here to install.
#
# Assumes ONLY: bash, a sudo-capable user, and SOME way to have gotten this file.
# macOS always ships /usr/bin/curl in the base system. Minimal Debian/Ubuntu
# images (containers, netinst, stripped cloud images) may have neither curl nor
# wget -- if so this installs curl via apt before doing anything else, and falls
# back to wget when that is what exists.
#
# Everything else -- Homebrew, Xcode CLT, Node 22, Python 3, Git, SQLite3,
# build tools, jq, nats-server, ollama, Tailscale -- is installed here.
#
# You will be asked for your password once. Homebrew and apt install into system
# locations; that is not automatable away and should not be.
#
# Env overrides:
#   OPENCLAW_REPO      owner/name to fetch      (default moltyguibros-design/openclaw-node)
#   OPENCLAW_REF       branch/tag              (default main)
#   OPENCLAW_SRC       use an existing checkout instead of downloading
#   OPENCLAW_NO_INSTALL=1   install deps only, do not run install.sh
#   plus any install.sh flag passed straight through:
#   curl ... | bash -s -- --skip-llm --role=worker
#   curl ... | bash -s -- --provider=kimi       # seat a specific mind (see install.sh --help)

# NOT `set -u`: stock macOS /bin/bash is 3.2, where an empty "$@" or ${#arr[@]}
# raises "unbound variable" under nounset -- and `curl | bash` lands on exactly
# that shell. Every expansion below is guarded explicitly instead.
set -o pipefail

# The whole script lives in one function and is invoked on the LAST line. Under
# `curl | bash` the shell reads its program from the pipe a chunk at a time, and
# any child that reads stdin (the Homebrew installer, `installer`, a pager) eats
# whatever bash has not read yet: the first virgin-Mac run printed its own
# source mid-install and stopped dead after the Tailscale step. A function body
# must be parsed in full before it can execute, so nothing downstream can
# consume it. Children that want a human get /dev/tty explicitly.
main() {

REPO="${OPENCLAW_REPO:-moltyguibros-design/openclaw-node}"
REF="${OPENCLAW_REF:-main}"
BOOTSTRAP_SKIP_MESH=false
BOOTSTRAP_SKIP_LLM=false
for arg in "$@"; do
  case "$arg" in
    --skip-mesh) BOOTSTRAP_SKIP_MESH=true ;;
    --skip-llm) BOOTSTRAP_SKIP_LLM=true ;;
    --sandbox) BOOTSTRAP_SKIP_MESH=true; BOOTSTRAP_SKIP_LLM=true ;;
  esac
done

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'
ok()   { echo -e "${G}[+]${N} $*"; }
warn() { echo -e "${Y}[!]${N} $*"; }
err()  { echo -e "${R}[x]${N} $*"; }
step() { echo -e "\n${B}━━━ $* ━━━${N}"; }
have() { command -v "$1" >/dev/null 2>&1; }
die()  { err "$*"; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux)  OS=linux ;;
  *) die "unsupported OS: $(uname -s). macOS and Debian/Ubuntu only." ;;
esac

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   OpenClaw — one-command node bootstrap  ║"
echo "╚══════════════════════════════════════════╝"
ok "platform: $OS ($(uname -m))"

# sudo up front so the password prompt happens here, not randomly mid-install.
# Reads from the tty, so this still works when the script is piped from curl.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif have sudo; then
  SUDO="sudo"
  step "Authorization"
  echo "Homebrew/apt install into system locations and need your password once."
  sudo -v || die "sudo authorization failed."
  # Keep the timestamp warm for the rest of the run.
  while true; do sudo -n true 2>/dev/null; sleep 50; kill -0 "$$" 2>/dev/null || exit; done &
  SUDO_KEEPALIVE=$!
  trap 'kill "$SUDO_KEEPALIVE" 2>/dev/null || true' EXIT
else
  die "need root or sudo."
fi

# Downloader. macOS always ships /usr/bin/curl (base system, not Command Line
# Tools). Minimal Debian/Ubuntu images -- containers, netinst, stripped cloud
# images -- ship NEITHER curl nor wget, so apt has to provide one before
# anything else can be fetched.
fetch() {
  if have curl; then curl -fsSL "$1"
  elif have wget; then wget -qO- "$1"
  else return 1; fi
}

if ! have curl && ! have wget; then
  if [ "$OS" = linux ] && have apt-get; then
    warn "no curl or wget — installing curl via apt first"
    ${SUDO:-} apt-get update -y >/dev/null 2>&1
    ${SUDO:-} apt-get install -y curl || die "could not install curl."
    have curl || die "curl still unavailable after apt-get install."
    ok "curl installed"
  else
    die "need curl or wget to continue, and no package manager to install one."
  fi
fi
ok "downloader: $(have curl && echo curl || echo wget)"

node_ok() {
  have node || return 1
  local version
  version="$(node -v 2>/dev/null)"
  [[ "$version" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  [ "${BASH_REMATCH[1]}" -gt 22 ] || {
    [ "${BASH_REMATCH[1]}" -eq 22 ] && [ "${BASH_REMATCH[2]}" -ge 12 ];
  }
}
nats_version_ok() {
  local major minor patch
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r major minor patch <<< "$1"
  [ "$major" -gt 2 ] || {
    [ "$major" -eq 2 ] && { [ "$minor" -gt 12 ] || { [ "$minor" -eq 12 ] && [ "$patch" -ge 15 ]; }; }
  }
}
nats_ok() {
  have nats-server || return 1
  local version
  version="$(nats-server -v 2>/dev/null)"
  nats_version_ok "${version#nats-server: v}"
}

# ============================================================
# macOS
# ============================================================
if [ "$OS" = macos ]; then
  step "Homebrew + Xcode Command Line Tools"
  if ! have brew; then
    for c in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$c" ] && eval "$("$c" shellenv)" && break
    done
  fi
  if have brew; then
    ok "homebrew present: $(brew --version | head -1)"
  else
    # Homebrew's own installer pulls in the Command Line Tools, which is where
    # the compiler comes from. Installing brew first therefore also fixes the
    # build-tools gap that breaks better-sqlite3 later.
    warn "installing Homebrew (this also installs the Xcode Command Line Tools)"
    NONINTERACTIVE=1 /bin/bash -c \
      "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/null \
      || die "Homebrew install failed."
    BREW=""
    for c in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [ -x "$c" ] && BREW="$c" && break
    done
    [ -n "$BREW" ] || die "Homebrew installed but brew binary not found."
    eval "$("$BREW" shellenv)"
    RC="$HOME/.zprofile"; [ "${SHELL##*/}" = bash ] && RC="$HOME/.bash_profile"
    grep -qF "$BREW shellenv" "$RC" 2>/dev/null || {
      printf '\neval "$(%s shellenv)"\n' "$BREW" >> "$RC"
      ok "persisted brew to $RC"
    }
    ok "homebrew installed"
  fi
  xcode-select -p >/dev/null 2>&1 && ok "command line tools: $(xcode-select -p)" \
    || warn "CLT still absent; native modules may fail to build"

  # The tailscale-app cask installs /Applications/Tailscale.app and nothing on
  # PATH: the CLI is a binary inside the bundle. Link it where brew's bin
  # already is, so `tailscale ip -4` works for install.sh and the gate below.
  link_tailscale_cli() {
    local cli="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
    [ -x "$cli" ] || return 0
    local dest="$(brew --prefix 2>/dev/null || echo /opt/homebrew)/bin/tailscale"
    ln -sf "$cli" "$dest" 2>/dev/null || $SUDO ln -sf "$cli" "$dest" || return 0
    ok "tailscale CLI linked: $dest"
  }

  step "Toolchain"
  if node_ok; then
    ok "node $(node -v)"
  else
    brew install node@22 </dev/null && brew link --overwrite --force node@22
    node_ok && ok "node $(node -v)" || err "node 22.12+ install failed"
  fi

  # Report on whether the BINARY landed, never on the package manager's exit
  # code. A formula can install "successfully" and still leave nothing on PATH
  # (keg-only, failed link) -- and a green line that outruns reality is how the
  # original installer hid its own failures.
  FORMULAE="python@3.12 git sqlite jq nats-server"
  $BOOTSTRAP_SKIP_LLM || FORMULAE="$FORMULAE ollama"
  for f in $FORMULAE; do
    bin="$f"
    case "$f" in python@3.12) bin=python3 ;; sqlite) bin=sqlite3 ;; esac
    if { [ "$f" = nats-server ] && nats_ok; } || { [ "$f" != nats-server ] && have "$bin"; }; then
      ok "$bin present"
    else
      if [ "$f" = nats-server ] && have nats-server; then brew upgrade nats-server </dev/null
      else brew install "$f" </dev/null; fi
      if { [ "$f" = nats-server ] && nats_ok; } || { [ "$f" != nats-server ] && have "$bin"; }; then ok "$f installed ($bin on PATH)"
      else err "$f: $bin still not on PATH after brew install"; fi
    fi
  done

  # install.sh derives --cluster-bind from `tailscale ip -4`; without it,
  # multi-machine NATS clustering silently degrades to a single node.
  if $BOOTSTRAP_SKIP_MESH; then
    ok "tailscale skipped (--skip-mesh)"
  elif have tailscale; then
    ok "tailscale present"
  else
    brew install --cask tailscale-app </dev/null
    link_tailscale_cli
    have tailscale && ok "tailscale installed" || err "tailscale: CLI still not on PATH"
  fi

# ============================================================
# Debian / Ubuntu
# ============================================================
else
  have apt-get || die "only Debian/Ubuntu apt is supported on Linux."

  step "APT baseline"
  # Unconditional. install.sh only refreshes lists inside its node-missing
  # branch, so a box that already ships Node 22 installs against stale lists
  # and dies mid-run under `set -e`.
  $SUDO apt-get update -y || die "apt-get update failed."
  $SUDO apt-get install -y \
    curl git rsync openssl sqlite3 build-essential jq python3 python3-pip python3-venv ca-certificates gnupg \
    || die "apt baseline install failed."
  ok "git, sqlite3, build-essential, jq, python3 installed"

  step "Node.js 22"
  if node_ok; then
    ok "node $(node -v)"
  else
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    $SUDO apt-get update -y && $SUDO apt-get install -y nodejs
    node_ok && ok "node $(node -v)" || err "node 22.12+ install failed"
  fi

  step "nats-server and selected capabilities"
  if nats_ok; then
    ok "nats-server supported version present"
  else
    V="${OPENCLAW_NATS_SERVER_VERSION:-2.12.15}"
    nats_version_ok "$V" || die "unsupported nats-server version: $V"
    case "$(uname -m)" in
      aarch64|arm64) A=arm64 ;;
      x86_64|amd64) A=amd64 ;;
      *) die "unsupported nats-server architecture: $(uname -m)" ;;
    esac
    if [ "$V" = 2.12.15 ]; then
      if [ "$A" = arm64 ]; then EXPECT_SHA=b724db99fefbf8f5c808baa82819ee50350aee9734017e4a478f7e545cef3ab6
      else EXPECT_SHA=58ab8131f819263897e2fc38e503e1b755b63bcafeecc7d12582487df48ca15e; fi
    else
      EXPECT_SHA="${OPENCLAW_NATS_SERVER_SHA256:-}"
    fi
    [[ "$EXPECT_SHA" =~ ^[a-f0-9]{64}$ ]] || die "nats-server override requires its SHA-256 digest"
    T=$(mktemp -d)
    TGZ="$T/nats-server-v${V}-linux-${A}.tar.gz"
    if curl -fsSL -o "$TGZ" "https://github.com/nats-io/nats-server/releases/download/v${V}/nats-server-v${V}-linux-${A}.tar.gz"; then
      ACTUAL_SHA=$(sha256sum "$TGZ" | awk '{print $1}')
      if [ "$ACTUAL_SHA" != "$EXPECT_SHA" ]; then
        err "nats-server checksum MISMATCH (got $ACTUAL_SHA, expected $EXPECT_SHA) — not installing"
      elif tar xzf "$TGZ" -C "$T" "nats-server-v${V}-linux-${A}/nats-server"; then
        $SUDO install "$T/nats-server-v${V}-linux-${A}/nats-server" /usr/local/bin/nats-server
        nats_ok && ok "nats-server v$V installed (sha256 verified)" || err "supported nats-server not on PATH after install"
      else
        err "nats-server archive could not be extracted"
      fi
    else
      err "nats-server download failed"
    fi
    rm -rf "$T"
  fi

  if $BOOTSTRAP_SKIP_LLM; then
    ok "ollama skipped (--skip-llm)"
  elif have ollama; then
    ok "ollama present"
  else
    curl -fsSL https://ollama.com/install.sh | sh
    have ollama && ok "ollama installed" || warn "ollama not on PATH — extraction degrades to regex"
  fi

  if $BOOTSTRAP_SKIP_MESH; then
    ok "tailscale skipped (--skip-mesh)"
  elif have tailscale; then
    ok "tailscale present"
  else
    curl -fsSL https://tailscale.com/install.sh | sh
    have tailscale && ok "tailscale installed" || err "tailscale not on PATH after install"
  fi
fi

# ============================================================
# PyYAML — hard dependency of compile-boot
# ============================================================
step "PyYAML"
if python3 -c 'import yaml' 2>/dev/null; then
  ok "PyYAML present"
else
  python3 -m pip install --user pyyaml 2>/dev/null \
    || python3 -m pip install --user --break-system-packages pyyaml 2>/dev/null \
    || err "PyYAML install failed — compile-boot will not work"
fi

# ============================================================
# Gate — refuse to hand a broken box to install.sh
# ============================================================
step "Verification"
FAIL=0
chk() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else err "$1 — MISSING"; FAIL=1; fi; }
chk "node 22.12+"   'node_ok'
chk "python3 3.8+"  'python3 -c "import sys; sys.exit(0 if sys.version_info>=(3,8) else 1)"'
chk "PyYAML"        'python3 -c "import yaml"'
chk "git"           'command -v git'
chk "sqlite3"       'command -v sqlite3'
chk "build tools"   '{ [ "$OS" = macos ] && xcode-select -p; } || command -v cc'
chk "curl"          'command -v curl'
chk "jq"            'command -v jq'
chk "rsync"         'command -v rsync'
chk "openssl"       'command -v openssl'
chk "nats-server 2.12.15+" 'nats_ok'
$BOOTSTRAP_SKIP_LLM || chk "ollama" 'command -v ollama'
$BOOTSTRAP_SKIP_MESH || chk "tailscale" 'command -v tailscale'
[ "$OS" = macos ] && chk "homebrew" 'command -v brew'

if [ $FAIL -ne 0 ]; then
  echo ""
  die "baseline incomplete — install.sh NOT started. Fix the items above and re-run."
fi
ok "baseline complete"

[ "${OPENCLAW_NO_INSTALL:-0}" = "1" ] && { ok "OPENCLAW_NO_INSTALL=1 — stopping before install.sh"; exit 0; }

# ============================================================
# Fetch the repo and hand off
# ============================================================
step "Fetching $REPO@$REF"
if [ -n "${OPENCLAW_SRC:-}" ]; then
  SRC="$OPENCLAW_SRC"
  [ -f "$SRC/install.sh" ] || die "OPENCLAW_SRC=$SRC has no install.sh"
  ok "using existing checkout: $SRC"
else
  (umask 077; mkdir -p "$HOME/.openclaw-src")
  SRC="$(mktemp -d "$HOME/.openclaw-src/openclaw-node-XXXXXX")"
  # Tarball, not `git clone`: on a virgin Mac `git` is a stub that pops the
  # Xcode GUI prompt, which would stall a piped install.
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF" \
    | tar xz -C "$SRC" --strip-components=1 \
    || die "could not download $REPO@$REF"
  ok "source at $SRC"
fi

step "Wave 1: running install.sh"
cd "$SRC" || die "cannot enter $SRC"

# Wave 1 defers downloads without disabling an already provisioned node.
USER_SKIP_LLM=false
for a in "$@"; do
  case "$a" in --skip-llm|--sandbox) USER_SKIP_LLM=true ;; esac
done

if [ $# -gt 0 ]; then
  bash install.sh --enable-services --skip-model-downloads "$@"
else
  bash install.sh --enable-services --skip-model-downloads
fi
RC=$?

if [ $RC -ne 0 ]; then
  echo ""
  err "install.sh exited $RC — dependencies were fine, the failure is downstream."
  exit $RC
fi
ok "wave 1 complete — model downloads deferred"

# ============================================================
# Wave 2 — models, only after the user says so
# ============================================================
if $USER_SKIP_LLM; then
  echo ""
  ok "--skip-llm given: no models. Set them up any time with:"
  echo "    bash $SRC/scripts/install/llm-setup.sh"
else
  bash "$SRC/scripts/install/llm-setup.sh"
fi

echo ""
ok "done. Next:"
$BOOTSTRAP_SKIP_MESH || echo "    tailscale up                 # authenticate the mesh (opens a browser)"
echo "    open http://localhost:3000   # Mission Control"
exit 0

}

# Everything above is parsed before this line runs — see the note at main().
main "$@"
