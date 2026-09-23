# AUDIT_PRE — step 5.4 · worktree hygiene

## §0 Micro re-orient (2026-09-09)

VERSION v5.3 → v5.4-pre. Last open row of Block 5 that runs here (5.1 is an operator runbook).
Needs pre-screen: `createWorktree` and `cleanupWorktree` present in `bin/mesh-agent.js` ✔ · git
available for real-repository tests ✔ · worktree marker format confirmed — `<path>/.git` is a
regular file containing `gitdir: <repo>/.git/worktrees/<name>` ✔.

## Two defects

**1. `createWorktree` deletes a directory it has not identified.** When a stale path exists it
tries `git worktree remove --force`, and on failure falls back to
`fs.rmSync(worktreePath, { recursive: true, force: true })`. `git worktree remove` fails precisely
when the path is *not* a registered worktree of this repo — which is also the case where deleting
it is unsafe. The containment is real but thin: the path is `WORKTREE_BASE/<taskId>` with a
validated taskId, and `MESH_WORKTREE_BASE` is operator-settable, so a task id colliding with a real
directory under a re-pointed base is enough to lose work.

**2. `cleanupWorktree` force-deletes branches.** It runs `git branch -D`, which discards unmerged
commits without asking. Callers decide `keep`, and mostly decide well, but `-D` means any caller
that gets it wrong — or any path where a merge silently failed — destroys the only copy of a
worker's output. The safe form exists: `git branch -d` refuses exactly when commits would be lost.

## Design

- `worktreeGitdir(dirPath)`: read `<dirPath>/.git`; return the `gitdir:` target when it is a
  regular file naming one, else null. Directory `.git` (a real clone) returns null — that is a
  repository, not a worktree, and must never be removed by this code.
- `isOwnWorktree(dirPath, workspace)`: true only when that target resolves inside
  `<workspace>/.git/worktrees/`. Symlinks are resolved before comparison so a crafted target
  cannot point out of the tree.
- `createWorktree` uses it: proof → `rmSync`; no proof → do not delete, return null. Failing
  closed matches the function's existing D14 posture ("null means the task must fail, never run in
  the shared tree").
- `cleanupWorktree` tries `git branch -d` and, when git refuses because the branch is unmerged,
  keeps it and logs that it was kept and why. `keep = true` still skips deletion entirely.

## Risks

- A branch that legitimately should go now survives when it holds commits. That is the intended
  trade: an extra branch is noise, a deleted branch is lost work. `git branch -d` is exact about
  which case it is in.
- Worktrees created before this change have the same marker file, so the proof works on them.

## §6 file-delta outline

- `bin/mesh-agent.js`: `worktreeGitdir`, `isOwnWorktree`, guarded `rmSync`, `-d`-first branch
  deletion. Both helpers exported for tests.
- `test/mesh-worktree-hygiene.test.mjs`: new, driving real repositories.
- Silo: INVENTORY, VERSION, COMPONENT_REGISTRY, AUDIT_POST.
