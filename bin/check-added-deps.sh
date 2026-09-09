#!/usr/bin/env bash
# check-added-deps.sh — advisory half of the `lazy-senior-ladder` harness rule.
#
# Rung 5 of the ladder is "does an already-installed dependency solve it?", so a
# commit that adds a NEW dependency is worth a second look. Run as the rule's
# mesh_validate_command with cwd = the task worktree; a non-zero exit makes
# runPostCommitValidation log the finding. It reports, it does not block.
#
# Heuristic by design: it reads diff text, so a version bump of an existing
# dependency also trips it. That is the right trade for an advisory check —
# a false positive costs one line in a log, a miss costs a silent dependency.

set -uo pipefail

MANIFESTS=(package.json requirements.txt pyproject.toml Cargo.toml)

# No parent on the first commit: diff against the empty tree instead.
if git rev-parse --verify --quiet HEAD^ >/dev/null; then
  BASE=HEAD^
else
  BASE=$(git hash-object -t tree /dev/null)
fi

added=$(git diff "$BASE" HEAD -U0 -- "${MANIFESTS[@]}" 2>/dev/null \
  | grep -E '^\+' \
  | grep -vE '^\+\+\+' \
  | grep -E '^\+[[:space:]]*("[^"]+"[[:space:]]*:[[:space:]]*"[~^><=*[:digit:]]|[A-Za-z][A-Za-z0-9._-]*[[:space:]]*(==|>=|~=|=[[:space:]]*")|[A-Za-z][A-Za-z0-9._-]*[[:space:]]*=[[:space:]]*\{)')

if [ -n "$added" ]; then
  echo "new dependency in this commit (ladder rung 5 — could an installed one do it?):"
  echo "$added" | sed 's/^/  /'
  exit 1
fi

exit 0
