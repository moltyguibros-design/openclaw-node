# AUDIT_POST — step 5.4 · worktree hygiene

## Promised vs landed

| Promised in AUDIT_PRE | Landed |
|---|---|
| `worktreeGitdir` / `isOwnWorktree` | yes, both exported |
| proof before the `rm -rf` fallback | yes — no proof, no delete; `createWorktree` returns null |
| `git branch -d` instead of `-D` | yes, with the kept-because-unmerged reason in the log line |
| `keep = true` unchanged | yes, git is not consulted at all in that case |

## Deltas (greppable)

- `bin/mesh-agent.js`: `worktreeGitdir()`, `isOwnWorktree()`, the guarded fallback inside
  `createWorktree`, `-d`-first deletion in `cleanupWorktree`, four names added to `module.exports`.
- `test/mesh-worktree-hygiene.test.mjs`: 10 tests, all against real repositories.

## Verify contract — executed

**`code:` PASS.** `node --test test/mesh-worktree-hygiene.test.mjs` → **10 tests, 10 pass**. Real
git throughout: a real worktree, a real second repository whose worktree must be refused, a real
clone (whose `.git` is a directory, so it is never mistaken for a worktree), and real commits.

**`runtime:` PASS.** Observed on a scratch workspace:

```
=== 1. a directory at the task path that is NOT our worktree
   before: precious.txt
   WORKTREE FAILED: refusing to delete …/worktrees/T-1: not a worktree of …/workspace — isolation unavailable
   createWorktree returned: null
   after : precious.txt
   verdict: file survived — refused to delete what it could not identify
=== 2. a branch whose commits exist nowhere else, cleanup asked to delete it
   Worktree cleaned: …/T-2 (branch kept (holds unmerged commits))
   worktree dir removed: true      branch after cleanup: KEPT at df391d17
   verdict: the only copy of the work survives
=== 3. an empty branch is still cleaned up
   Worktree cleaned: …/T-3 (branch deleted) — no noise left behind
```

**Regression, like-for-like** (both with NATS up): baseline `536f9c5` **2051 tests / 263 fail**;
this branch **2071 / 263** — +20 tests across 5.3 and 5.4, +20 passes, **no new failures**.

## Findings

1. **The dangerous fallback fired precisely when it was least safe.** `git worktree remove` fails
   *because* a path is not a registered worktree of this repo, and that was the trigger for
   `rm -rf`. The two conditions were exactly inverted: the command's failure was being read as
   "clean it up by hand" when it means "this is not yours".
2. **A repository is not a worktree, and the marker tells them apart for free.** A worktree's
   `.git` is a *file* containing a `gitdir:` line; a clone's is a *directory*. Checking the type
   costs one `lstat` and makes "never delete a repository" structural rather than aspirational.
3. **`-d` versus `-D` is the whole safety property.** Git already knows whether a branch holds
   commits reachable from nowhere else; `-D` was throwing that answer away. The new log line
   distinguishes "deleted" from "kept (holds unmerged commits)", so an operator reading the log
   can tell which happened without inspecting refs.
4. Callers were mostly passing `keep` correctly, which is why this never bit visibly — the change
   removes the dependence on every caller continuing to get it right.

## §6 carry-forwards

- Block 5 is closed except 5.1, which is an operator runbook (Orca settings) and needs the desktop
  app. Nothing in 5.2–5.4 depends on it.
- The `better-sqlite3` binding is unbuilt in this container, so requiring `bin/mesh-agent.js` logs
  an `obs-db` failure. Pre-existing and environmental; noted in 5.2's audit as well.

## Feeds — landed

`bin/mesh-agent.js` exports `worktreeGitdir`, `isOwnWorktree`, `createWorktree` and
`cleanupWorktree`; the ownership proof guards the only unconditional delete in the agent, and no
branch with unique commits is removed by automation.
