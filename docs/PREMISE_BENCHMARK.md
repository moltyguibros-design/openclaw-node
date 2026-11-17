# PREMISE_BENCHMARK — does a grappe of OpenClaws beat one OpenClaw? (step 2.6)

**Status (2026-08-05): CLOSED FAILED.** Run 2 tallied solo 3 · grappe 2 · tie 0, below the D3 ≥4/5
bar. See federation DECISIONS D15, then D16 (consensus gating is dead; federation is a deterministic
pipeline), and `memory-plan/plans/federation/BLOCKED.md`. Any rerun is a NEW preregistered
benchmark; the protocol below is the apparatus it would reuse.

**The question that decides the plan.** Everything past Block 2 assumes an adversarial grappe
produces observably better work than a single node. 2.6 tests that head-to-head, blind. Per
DECISIONS D3, a fail is a plan-level BLOCK, not a step failure — we do not build management/savant
grappes on an unproven premise.

## The design (controlled: only the reviewers vary)

Same task, same model (Claude/sonnet), same harness-loaded OpenClaw, same bus. Two arms:
- **SOLO** — one OpenClaw claims the task and executes it alone (no reviewers).
- **GRAPPE** — three OpenClaws circle it: 1 worker + 2 reviewers, one sub-round
  (`max_subrounds:1` so it closes cleanly — 2.4 finding 13), then finalize.

The harness is `bin/fed-benchmark.mjs` (the original `grappe-benchmark.mjs` and its unattended
`fed-benchmark-driver.mjs` were retired and then deleted — the former's prose-metric default tripped
the agent's metric security filter and its pair handling could reuse stale artifacts; both failed
the 2026-08-03 smoke. Their history is in git and the step-2.6 `RERUN_LOG.md`). `submit <task-id> <arm> <task-file.md>` sends
each arm (safe trivially-passing metric `node --version`; blind scoring is the quality gate);
`collect` writes an anonymized, de-identified pair under `benchmark/pairs-d14/<name>/` — write
once, no overwrite, July's tracked `benchmark/pairs/` + `handrun/` are never read — and seals its
`key.json`, `meta.json` cost record (per-arm wall-clock and usage) and hashes under
`benchmark/sealed-d14/<name>/`, outside the scorer's directory. You blind-score all pairs, then
`tally`.

## Protocol

1. Prereqs (the node's own services — NODE_SPEC §6): launchd mesh-task-daemon + bridge up; 3
   mesh-agents running with `MESH_LLM_PROVIDER=claude`.
2. For each of the ≥5 tasks, from the repo root (one task file, two task ids):
   `node bin/fed-benchmark.mjs submit <id>-solo solo benchmark/tasks/<t>.md` and
   `node bin/fed-benchmark.mjs submit <id>-grappe grappe benchmark/tasks/<t>.md`; poll each with
   `status <task-id>`. When both are terminal, `collect <name> <id>-solo <id>-grappe` writes the
   scorer package `benchmark/pairs-d14/<name>/{A.md,B.md}` and seals the key apart under
   `benchmark/sealed-d14/<name>/`.
3. Blind-score each pair on the rubric below by writing `benchmark/pairs-d14/<name>/score.json`
   (`winner` A | B | tie, notes, and per arm the five scores `tally` requires). Never read
   `benchmark/sealed-d14/` until every delivered pair is scored.
4. `node bin/fed-benchmark.mjs tally` unblinds and tallies grappe-wins vs solo-wins (it gives no
   verdict while a delivered pair is unscored).
5. **Verdict:** grappe wins a clear majority (≥4/5, or your pre-agreed bar) ⇒ premise PROVEN, Phase
   2/3 unlocked. Else ⇒ write BLOCKED.md citing the miss; the architecture stops here for redesign.
6. Record the GPU/token + wall-clock cost delta (grappe ≈ 3× the calls + reviewer turns) so the
   quality gain is weighed against the cost (D3).

## Scoring rubric (per pair, blind)

`tally` rejects a delivered pair's score unless every dimension is scored 1–5 for both arms:

```json
{"winner": "A" | "B" | "tie", "notes": "...",
 "scores": {"A": {"correctness": 1, "completeness": 1, "evidence": 1, "actionability": 1, "defect_discovery": 1},
            "B": {"correctness": 1, "completeness": 1, "evidence": 1, "actionability": 1, "defect_discovery": 1}}}
```

| Dimension | What it scores |
|---|---|
| correctness | claims are true; cited file:line exist |
| completeness | addresses the whole task |
| evidence | claims are backed by the code, not asserted |
| actionability | the operator could act on it as written |
| defect_discovery | catches issues a first draft would miss |

## The task set (≥5 real, small, checkable — chosen with the operator)

Tasks live as markdown under `benchmark/tasks/<id>.md` (first line = title, the rest = description).
The original starter set is below — swap in your own real work anytime; the point is REAL tasks, not
toys:

1. **spec-harden** — the F1/F2/F4 FEDERATION_SPEC defects (already dogfooded in 2.4; a known-answer
   control — we know the right output, so it calibrates the rubric).
2. **collab-mode-gap** — "COLLAB_MODE (lib/mesh-collab.js:29-34) lacks cooperative/collaborative/
   management; propose the constant + dispatch changes." (A real bug the 2.4 grappe itself found.)
3. **nats-resolve-audit** — "Review lib/nats-resolve.js for the token/URL resolution order; find any
   case where a client sends the wrong credential or address." (Real, checkable against the code.)
4. **install-step-order** — "Given docs/NODE_SPEC.md, find any install.sh step whose prerequisite is
   produced by a LATER step." (Ordering correctness — solo often misses cross-references.)
5. **acceptance-gap** — "Does bin/node-acceptance.mjs probe every subsystem NODE_SPEC §5 lists as
   autostart? Name any unprobed one." (Coverage completeness — the kind of thing review catches.)

Rationale for the mix: one known-answer control (calibrates scoring), two code-audit tasks (where
adversarial review theoretically helps most), two doc/coverage tasks (cross-reference checking).
If the grappe doesn't beat solo HERE, the premise is genuinely in doubt.

## Cost note

Each grappe arm ≈ 3 workers × (init + 1 sub-round + finalize) ≈ 6–9 Claude turns of 5–15 min; solo ≈
1–2 turns. A full 5-task benchmark is ~3–4h of Claude compute plus your scoring time. Run it when you
have the budget — it does not need to be one sitting; score pairs as they finish.
