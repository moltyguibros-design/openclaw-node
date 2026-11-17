#!/usr/bin/env bash
set -euo pipefail

REPO_PATH="${1:-.}"
FULL_TEST_CMD="${2:-npm test}"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git not found"
  exit 1
fi

cd "$REPO_PATH"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR: $REPO_PATH is not a git repository"
  exit 1
fi

echo "== Arcane pre-push check =="
echo "Repo: $(pwd)"

printf '\n[1/6] Branch\n'
git rev-parse --abbrev-ref HEAD

printf '\n[2/6] Remotes\n'
git remote -v || true

printf '\n[3/6] Working tree summary\n'
git status --short

printf '\n[4/6] Staged files\n'
git diff --cached --name-only || true

printf '\n[5/6] Last commit\n'
git log -1 --oneline || true

printf '\n[6/6] Full test command (manual confirmation required)\n'
echo "$FULL_TEST_CMD"
echo "Run it yourself now if not already green."

printf '\nDone.\n'
