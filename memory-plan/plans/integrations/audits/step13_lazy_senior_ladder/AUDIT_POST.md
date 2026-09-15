# AUDIT_POST — step 1.3 · `lazy-senior-ladder` harness rule

## Promised vs landed

| Promised in AUDIT_PRE | Landed |
|---|---|
| tier-2 inject rule, local+mesh, implementation keywords | yes |
| `bash ./bin/check-added-deps.sh` as the advisory command | yes — exec-safety returns `{allowed:true}` |
| detector handles npm, pip, pyproject, Cargo, and a first commit | yes |
| tests for activation, exec-safety and the detector | yes, 7 tests |
| minimal diff to the shipped config | yes — 36 added lines, nothing reformatted (a full re-serialise had rewritten 242 lines; reverted and appended textually) |

## Deltas (greppable)

- `config/harness-rules.json`: `lazy-senior-ladder` appended (14 rules total).
- `bin/check-added-deps.sh`: new, executable.
- `test/harness-lazy-senior.test.mjs`: new, 7 tests.

## Verify contract — executed

**`code:` PASS.** `node --test test/harness-lazy-senior.test.mjs` → 7 tests, 7 pass, 0 fail.
Activation is asserted both ways: the ladder reaches tasks titled "Implement the retry helper",
"Refactor the queue" and "Add a feature to the kanban", and stays out of "Summarize yesterday
notes" and "Update the changelog".

**`runtime:` PASS.** The real `runPostCommitValidation`, with rules loaded from the shipped
`config/harness-rules.json`, against a real git worktree:

| Commit | Result |
|---|---|
| touches only `index.js` | `lazy-senior-ladder` passed — no log line |
| adds `is-odd` to `package.json` | `[HARNESS] POST-COMMIT FAIL: lazy-senior-ladder — new dependency in this commit (ladder rung 5 — could an installed one do it?)` followed by the added line |

Only mesh-agent's own call site is left to its existing tests. **Not yet true on the mesh:**
workers read the deployed `~/.openclaw/harness-rules.json`, so the rule is inert until
`bin/harness-sync.js` runs on the operator's box. That is the operator step for this rule, named
here rather than implied by the green check above.

## Findings

1. **A pre-existing governance check has never worked.** While running the real path, every
   commit also logged `POST-COMMIT FAIL: git-conventional-commits — Validation command blocked`.
   Its command pipes `git log` into `grep -qE '^(feat|fix|docs|…)'`, and the shell-chaining
   detector reads the alternation's `|` characters as pipes into a disallowed command, so the
   check is refused before it runs — on every commit, regardless of the message. Captured in
   `OUT_OF_SCOPE.md` as WHAT and WHY; not fixed here, because a fix means changing either the
   safety regex or the rule, and that decision belongs to whoever owns harness enforcement.
2. **The detector reports a neighbouring line when a manifest reflows.** Adding a key to
   `package.json` also adds a comma to the line above, so both appear in the diff and both are
   printed. The new dependency is named correctly, which is what the advisory is for; teaching the
   script to diff around punctuation would cost more than the noise it removes. Stated rather than
   silently tolerated.
3. Appending to a JSON config by re-serialising it rewrites the whole file. The first attempt
   produced a 242-line diff and was reverted in favour of a textual append.

## §6 carry-forwards

- Step 1.4 adds a skill and touches `workspace-bin/multi-review`; the ladder rule now injects into
  local sessions too, so its wording and the `ponytail-review` skill body should not contradict.
- Any later `post_validate` rule should be checked against `validateExecCommand` **before** it is
  written into the config — finding 1 is what that omission looks like a year later.
- The operator's `harness-sync` run is the outstanding half of this step's delivery.

## Feeds — landed

`config/harness-rules.json` carries the rule; `lib/mesh-harness.js` injects it into worker prompts
whose task text names implementation work, and runs the detector after each worker commit.
`bin/check-added-deps.sh` is reusable by any future rule that wants the same signal.
