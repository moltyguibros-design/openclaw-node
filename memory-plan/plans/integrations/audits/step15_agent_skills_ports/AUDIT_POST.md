# AUDIT_POST — step 1.5 · six agent-skills ports

## §0 Micro re-orient

VERSION v1.4 → v1.5. First open row was 1.5; still correct. Needs present: the six upstream
bodies (MIT), the frontmatter drafts, and audit/scanner/routing tooling proven in 1.4.

## Promised vs landed

| Promised | Landed |
|---|---|
| six skills in node format | yes — `debugging-and-error-recovery`, `incremental-implementation`, `interview-me`, `doubt-driven-development`, `deprecation-and-migration`, `code-review-and-quality` |
| audit ≥ B each | yes — 100, 95, 93, 100, 100, 88 (five A, one B) |
| scanner clean | yes — exit 0 on all six, no findings |
| routing no regression | **after a fix** — the first run regressed two existing skills; see finding 1 |
| node-specific rewording | yes — `CONSTRAINTS.md` → `config/harness-rules.json` + active `SCOPE.md`; nested subagents / `codex exec` / `gemini --approval-mode` → a fresh mesh task carrying only the artifact and its contract; cross-model escalation → `workspace-bin/multi-review`; done-gates → `workspace-bin/quality-gate` |

## Deltas (greppable)

Six new `skills/<name>/SKILL.md` (174–237 lines each, all under the 250-line audit limit; upstream
ran 225–396) plus `skills/debugging-and-error-recovery/references/fallbacks.md`.

## Verify contract — executed

**`code:` PASS.**
- `skill-audit` per skill: 100 / 95 / 93 / 100 / 100 / 88, grades A A A A A B — every one at or
  above the B bar. Whole-tree `--min-grade C` exits 0.
- `openclaw-skill-scanner` per skill: exit 0, zero findings. No URL, install, curl or pipe shapes
  in any body.
- `skill-routing-eval --compare`: 787/787 → 829/829, both 100.0%, **zero regressed skills**, six
  listed as new.

**`runtime:` PASS.** The six directories are present with a parseable `SKILL.md` each, so the
loader lists them; `skill-audit` reading the tree is that enumeration.

Targeted suite unchanged: `harness-lazy-senior` + `web-fetch-guard` → 43 tests, 43 pass.

## Findings

1. **The first routing run regressed two existing skills, and the gate caught it.** `epic-hypothesis`
   fell from F1 1.00 to 0.91 and `github` from 0.83 to 0.77, while overall accuracy stayed at
   100% — which is exactly why the per-skill comparison matters and a headline number does not.
   Causes: `code-review-and-quality`'s "review this pull request" shares the "pull request" tokens
   with `github`'s own triggers, and `interview-me`'s "grill me before building" collided with
   `epic-hypothesis`'s "how do I validate this epic before building" once stopwords are dropped.
   Replaced with "review this diff" and "ask me questions first"; the re-run shows no regressed
   skill. The lesson generalises: trigger phrases must be checked against the *installed* tree, not
   only against the plan's collision table.
2. **Two skills needed structural trimming, not just rewording.** `code-review-and-quality` (396
   lines upstream) and `debugging-and-error-recovery` (300) exceed the audit's 250-line limit. The
   first was compressed to 237 by cutting a rationalisations table, a review-speed section and a
   checklist duplicating the axes; the second moved its fallback code to `references/fallbacks.md`.
   Both keep their full procedure.
3. **The two skills that overlap were told about each other.** `code-review-and-quality` names
   `ponytail-review` as the owner of the simplicity axis, and `doubt-driven-development` points at
   `multi-review` for cross-model escalation, so the four review-adjacent skills divide the work
   instead of repeating it.

## §6 carry-forwards

- The routing baseline is now stale; step 1.6 saves a fresh one before its own edit.
- `interview-me` writes intent into a plan's `DECISIONS.md` — the same file the plan protocol owns,
  so a future step that automates intent capture should not add a second location.

## Feeds — landed

Six skills routable in the tree (109 → 115 skills), reachable by the skill loader and by
`workspace-bin/multi-review`'s reviewers.
