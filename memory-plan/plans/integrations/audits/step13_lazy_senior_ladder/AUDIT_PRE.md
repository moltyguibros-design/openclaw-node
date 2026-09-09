# AUDIT_PRE — step 1.3 · `lazy-senior-ladder` harness rule

## §0 Micro re-orient (2026-09-08)

- VERSION v1.2 → v1.3-pre. First open row is 1.3. Still the right next step: yes.
- Needs pre-screen: `config/harness-rules.json` schema confirmed by reading 13 live rules ✔ ·
  `lib/mesh-harness.js` dispatches `post_validate` and logs `[HARNESS] POST-COMMIT FAIL: <id> — <output>` ✔ ·
  `formatHarnessForPrompt` tier-2 gate needs `type: inject`, non-empty `content`, non-empty
  `activateOn`, lowercase substring match ✔ · D6 locked (tier 2, advisory) ✔.

## Three source facts that changed the draft

1. **The validate command must pass `lib/exec-safety.js`.** `validateExecCommand` refuses `;`,
   `&&`, backticks, redirects, `$( )` and any pipe except into `grep|head|tail|wc|sort`, and the
   command must start with an allowed prefix. The drafted `! git diff … | grep -qE …` fails twice
   over: the leading `!` is not an allowed prefix, and `grep -q` exits 0 on a match, which is the
   opposite of the signal wanted. `bash ./bin/` is an allowed prefix and `postCommitValidate` runs
   with `cwd` = the worktree, so the check becomes `bash ./bin/check-added-deps.sh` — a script that
   exits non-zero when the last commit adds a dependency, and can be tested directly.
2. **Activation text is the task, not the prompt.** `bin/mesh-agent.js` composes it from
   `task start`, `status: running`, `task.title` and `task.description`. Keywords must read like
   task titles ("implement", "add a feature", "refactor"), not like prose in a prompt body.
3. **Mesh reads the deployed copy** `~/.openclaw/harness-rules.json`; `bin/harness-sync.js` merges
   repo → deployed by id. The rule is inert on the mesh until the operator syncs, which is named
   in the close note rather than glossed.

## Design

- `bin/check-added-deps.sh`: diff the last commit against its parent (empty tree when there is no
  parent) restricted to `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`; report
  added lines that declare a dependency; exit 1 listing them, exit 0 when there are none. Advisory
  by construction — `runPostCommitValidation` logs, it does not gate the merge.
- The rule content is the seven-rung ladder plus the "never lazy about" list, trimmed to fit one
  injected block.

## Risks

- The detector is a heuristic over diff text: a version bump to an existing dependency also looks
  like an added line. Acceptable for an advisory check, and stated in the script's own comment
  rather than left as a surprise.
- Over-broad `activateOn` would inject the block into unrelated tasks; keywords are kept to verbs
  that describe writing code.

## §6 file-delta outline

- `config/harness-rules.json`: one entry appended.
- `bin/check-added-deps.sh`: new, executable.
- `test/harness-lazy-senior.test.mjs`: new — activation gate, exec-safety acceptance, and the
  detector against a real temp git repo.
- Silo: INVENTORY row, VERSION, COMPONENT_REGISTRY, AUDIT_POST.
