# ============================================================
# The install root: ~/.openclaw only
# ============================================================
#
# Sourced first by install.sh and llm-setup.sh. A different OPENCLAW_ROOT only moved
# where the installer wrote, while the services it sets up read ~/.openclaw, so it is
# refused before anything is written. bootstrap.sh and mesh-install.sh (which run before
# this repo is on disk) and lib/openclaw-root.js print the same refusal.

# Repeated slashes collapsed and a trailing one dropped: with HOME ending in '/',
# "$HOME/.openclaw" is spelled <home>//.openclaw.
openclaw_root_squash() {
  local p="$1"
  while [ "${p#*//}" != "$p" ]; do p="${p%%//*}/${p#*//}"; done
  [ "$p" = / ] || p="${p%/}"
  printf '%s\n' "$p"
}

# Unset or empty, $HOME/.openclaw however its slashes are repeated, or an existing
# directory that resolves to the same one (a symlink to it).
openclaw_root_is_default() {
  local want got
  [ -n "${OPENCLAW_ROOT:-}" ] || return 0
  want="$(openclaw_root_squash "$HOME/.openclaw")"
  got="$(openclaw_root_squash "$OPENCLAW_ROOT")"
  [ "$got" = "$want" ] && return 0
  [ -d "$got" ] && [ -d "$want" ] || return 1
  [ "$(CDPATH='' cd -P -- "$got" && pwd -P)" = "$(CDPATH='' cd -P -- "$want" && pwd -P)" ]
}

refuse_custom_openclaw_root() {
  openclaw_root_is_default && return 0
  printf '%s\n' \
    "OPENCLAW_ROOT=$OPENCLAW_ROOT: a custom install root is not supported. OpenClaw installs only to $(openclaw_root_squash "$HOME/.openclaw")." \
    "Its services (the NATS clients, the memory daemon, the mesh agent, the gateway plugin) would still read ~/.openclaw, so a node installed anywhere else would be half-configured." \
    "Nothing was written. Run \"unset OPENCLAW_ROOT\", then run this again." \
    "For a second node on one machine, the repo's bin/spawn-node.mjs --id <name> creates ~/.openclaw-<name> and prints the OPENCLAW_HOME=... commands that run its memory daemon and consolidation." >&2
  exit 1
}
