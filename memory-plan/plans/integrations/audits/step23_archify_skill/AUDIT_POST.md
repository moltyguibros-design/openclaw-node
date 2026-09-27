# AUDIT_POST — step 2.3 · Archify skill

## §0 Micro re-orient

VERSION v1.6 → v2.3-pre. Block 1 closed; 2.1–2.2 need the operator's macOS box, so 2.3 was the
first runnable row. Needs present: the clone, Node 22 (engines say ≥18), the two verified IRs.

## Promised vs landed

| Promised | Landed |
|---|---|
| runtime tree only, ~2.1 MB | 2.3 MB — `bin/`, `renderers/`, `schemas/`, `assets/`, `delta/`, `recipes/`, `migrations/`, `brand-marks/`, `references/`, plus **`scripts/check-render-output.mjs`** (see finding 1) |
| `examples/` (3.6 M) and `test/` (1.6 M) dropped | yes — replaced by two node-authored examples, 5 KB (finding 2) |
| update checker not shipped | yes — `scripts/check-update.mjs` absent, and the SKILL.md section instructing an agent to run it is removed |
| `ARCHIFY_UPDATE_CHECK_DISABLED=1` in the env example | yes, uncommented under `── Misc ──` |
| node frontmatter (≤300 chars, 4 triggers, 3 negatives) | yes |

## Verify contract — executed

**`code:` PASS.**
- `skill-audit --skill archify` → **100/100, grade A, clean**.
- `openclaw-skill-scanner --skill archify` → **exit 0**.
- `skill-routing-eval --compare` → 100.0% → 100.0%, `archify` new, **zero regressed**.
- `validate lifecycle` and `validate dataflow` at `--quality showcase`: **ok true, 9 of 9 artifact
  checks passed** (single_svg, finite_svg, orthogonal_arrows, label_route_clearance,
  relationship_crossings, relationship_corridors, container_border_runs, route_rhythm,
  legend_clearance), composition `showcase / pass`, 0 errors, 0 warnings.
- No outbound network in the shipped tree: no `fetch(`, no `check-update`, no update host. The
  only `https://` strings left are JSON-Schema `$id`s and brand attribution text.

## Findings

1. **The copy list was wrong, and validation caught it.** The exploration report classified all of
   `scripts/` as update-check machinery, so the first install omitted the directory entirely — and
   both validations failed with "Artifact checker failed without a parseable receipt". `validate`
   and `deliver` spawn `scripts/check-render-output.mjs` (`bin/archify.mjs:437,985,1229,1802`); it
   is the thing that produces the nine artifact checks. Only that one file is now shipped;
   `check-update.mjs` and the four generator scripts stay out. Two lessons: a dependency survey by
   directory name misses per-file requirements, and the step's own gate was what exposed it —
   had the verify been `doctor` or a skill-audit score, the skill would have shipped broken.
2. **The examples the body tells an agent to read had been deleted with the bulk.** Upstream's
   SKILL.md step 2 says to read a matching JSON example; dropping 3.6 MB of them would have left
   that instruction pointing at nothing. The two IRs authored earlier this session — the memory
   daemon lifecycle and the JSONL-to-inject dataflow — now ship as `examples/lifecycle.example.json`
   and `examples/dataflow.example.json`, 5 KB total, and both are real diagrams of this node that
   pass showcase. The body was reworded to say so.
3. `doctor` and `demo` remain unavailable because they read the upstream examples tree, and the
   SKILL.md says so plainly rather than leaving an agent to discover it by failure.

## §6 carry-forwards

- Step 2.4 renders these same two IRs to `docs/diagrams/` and strips the Google Fonts links from
  the delivered HTML (`assets/template.html:36-41`, async, degrades to system monospace).
- If Archify is ever updated, re-check which `scripts/` files the runtime spawns; the set is not
  documented upstream.

## Feeds — landed

`skills/archify/` is routable and runnable: `cd skills/archify && node bin/archify.mjs validate
<type> <ir> --quality showcase --json`. `openclaw.env.example` carries the update-check kill switch.
