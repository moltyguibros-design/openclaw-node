#!/usr/bin/env bash
# obsidian-rest-api.sh <vault-dir> — install the Obsidian Local REST API plugin
# into <vault-dir>/.obsidian/plugins/ from a pinned upstream release, verifying
# each file's sha256 before anything lands in the vault. The plugin is no longer
# vendored in the repo. To move to a new release, bump VERSION and the three sums.
# OPENCLAW_OBSIDIAN_REST_API_BASE_URL points at a mirror; the sums still apply.
set -euo pipefail

VAULT_DIR="${1:?usage: obsidian-rest-api.sh <vault-dir>}"
VERSION="3.4.4"
BASE_URL="${OPENCLAW_OBSIDIAN_REST_API_BASE_URL:-https://github.com/coddingtonbear/obsidian-local-rest-api/releases/download/$VERSION}"
FILES=(main.js manifest.json styles.css)
SUMS=(
  e7d62a0e8b01d8b0975846e69233fa8bb20874f36eb22fca52bb6e1fefcc98c9
  46d7fc351e76f600a18f37180f0a57d45cb70560416cbc2c93c8a14701cad5ab
  9c11d47320384a9af97ca67e78384f9bfe1b46510d611de3e7c8507425d20dfb
)

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"
  if ! curl -fsSL -o "$TMP/$f" "$BASE_URL/$f"; then
    echo "obsidian-local-rest-api $VERSION: download of $f failed" >&2
    exit 1
  fi
  actual=$(sha256 "$TMP/$f")
  if [ "$actual" != "${SUMS[$i]}" ]; then
    echo "obsidian-local-rest-api $VERSION: $f checksum MISMATCH (got $actual, expected ${SUMS[$i]}) — not installing" >&2
    exit 1
  fi
done

DEST="$VAULT_DIR/.obsidian/plugins/obsidian-local-rest-api"
mkdir -p "$DEST"
for f in "${FILES[@]}"; do mv "$TMP/$f" "$DEST/$f"; done
echo "obsidian-local-rest-api $VERSION installed (sha256 verified) in $DEST"
