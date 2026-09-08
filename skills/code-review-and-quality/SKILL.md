---
name: code-review-and-quality
description: "Five-axis review rubric — correctness, readability, architecture, security, performance — with change sizing, tests read first, severity labels, and a check that the verification itself holds. Use before merging a diff, or as the rubric behind a multi-perspective review."
triggers:
  - "pre-merge review pass"
  - "five axis review"
  - "is this ready to merge"
  - "review this diff"
negative_triggers:
  - "refactor suggestions"
  - "review for over-engineering"
  - "scan skill for malware"
license: MIT
metadata: {"clawdbot":{"emoji":"⚖️","source":"addyosmani/agent-skills (MIT)"}}
---

# Code Review and Quality

Every change gets reviewed before it merges, across five axes: correctness, readability,
architecture, security, performance.

The approval standard is improvement, not perfection. Approve a change when it definitely improves
overall code health, even if it is not exactly how you would have written it. Blocking on personal
preference is a failure of the review, not a service to the codebase.

Use it before merging any change, after a feature lands, when another agent or model produced the
code, when refactoring, and after any bug fix — reviewing the fix and its regression test together.

The simplicity and over-engineering pass belongs to `ponytail-review`; this skill does not
duplicate it. Run that one for "what can be deleted", this one for "is it right".

## The five axes

### 1. Correctness

- Does it match the spec or task requirements?
- Are edge cases handled: null, empty, boundary values?
- Are error paths handled, not just the happy path?
- Do the tests pass, and are they testing the right things?
- Any off-by-one errors, race conditions, or state inconsistencies?

### 2. Readability

- Are names descriptive and consistent with project conventions? No bare `temp`, `data`, `result`.
- Is control flow straightforward — no nested ternaries or deep callback chains?
- Are abstractions earning their complexity? Do not generalize before the third use case.
- Any dead artifacts: no-op variables, compatibility shims, "removed" comments?
- Is a new conditional bolted onto an unrelated flow? That is a design smell, not a nit — push the
  logic into its own helper, state, or policy instead of tangling an existing path.
- Do repeated conditionals on the same shape appear? They signal a missing model or dispatcher. A
  temporary branch is usually permanent debt.

### 3. Architecture

- Does it follow an existing pattern, or introduce a new one? If new, is that justified?
- Are module boundaries preserved, with dependencies flowing one way and no cycles?
- Is there duplication that should be shared?
- Does this refactor reduce complexity or relocate it? Count the concepts a reader must hold to
  follow the change. If a cleaner version leaves that count unchanged, it is not cleaner — prefer
  the restructuring that makes whole branches, modes, or layers disappear, and prefer deleting an
  abstraction to polishing it.
- Is feature-specific logic leaking into a shared module? Keep logic in its owning layer, reuse the
  canonical helper instead of a near-duplicate, and do not normalize architectural drift.
- Are type boundaries explicit? Question gratuitous `any`, `unknown`, optionals, casts, and silent
  fallbacks that paper over an unclear invariant.

### 4. Security

- Is user input validated and sanitized, at the system boundary?
- Are secrets kept out of code, logs, and version control?
- Is authentication and authorization checked where needed?
- Are queries parameterized rather than string-concatenated, and outputs encoded?
- Are dependencies from trusted sources with no known vulnerabilities?
- Is data from external sources — APIs, logs, user content, config files — treated as untrusted
  before it reaches logic or rendering?

### 5. Performance

- Any N+1 query patterns, unbounded loops, or unconstrained fetching?
- Any synchronous operation that should be async, or unnecessary re-render?
- Any list endpoint missing pagination, or large object allocated in a hot path?

## Structural remedies

When you flag a structural problem, propose the move. A review that only says "this is complex"
leaves the author guessing. Reach for a named restructuring: replace a chain of conditionals with a
typed model or explicit dispatcher; collapse duplicate branches into one flow; separate
orchestration from business logic; move feature-specific logic into the package that owns the
concept; reuse the canonical helper instead of a near-duplicate; make a type boundary explicit so
downstream branching disappears; delete a pass-through wrapper; extract a helper or split a large
file. Prefer the remedy that removes moving pieces over one that spreads complexity around.

## Change sizing

```
~100 lines changed   → Good. Reviewable in one sitting.
~300 lines changed   → Acceptable if it is a single logical change.
~1000 lines changed  → Too large. Split it.
```

Watch file size, not just diff size. Around 1000 total lines in one file is an inspection signal,
not a hard cap; when a change materially grows an already-large file, ask whether to extract
helpers or modules first, then add.

One change is a single self-contained modification that addresses one thing, includes its tests,
and leaves the system working — one part of a feature, not the whole feature. Refactoring plus new
behavior is two changes; submit them separately. Small cleanups can ride along at reviewer
discretion.

To split a too-large change: **stack** it (submit a small change, base the next on it) for
sequential dependencies; **group by file** when different reviewers are needed; go **horizontal**
(shared code and stubs first, then consumers) in a layered architecture; go **vertical** (smaller
full-stack slices) for feature work. Complete file deletions and mechanical refactors are the
acceptable large changes — the reviewer verifies intent, not every line.

Every change needs a description that stands alone in history: a short imperative first line
("Delete the FizzBuzz RPC"), then a body covering what changes, why, and the reasoning not visible
in the code. "Fix bug", "Fix build", "Phase 1", and "Moving code from A to B" are not descriptions.

## Review process

**Step 1 — understand the context.** What is this change trying to accomplish, what task or spec
does it implement, what behavior should change? On this node the contract to review against is
`config/harness-rules.json` plus the plan's active `SCOPE.md`.

**Step 2 — review the tests first.** Tests reveal intent and coverage. Do they exist? Do they test
behavior rather than implementation details? Are edge cases covered, are the names descriptive,
and would they actually catch a regression if the code changed?

**Step 3 — review the implementation.** Walk each changed file with the five axes in mind, in that
order: correctness, readability, architecture, security, performance.

**Step 4 — categorize findings.** Label every comment so the author knows what is required.

| Prefix | Meaning | Author action |
|--------|---------|---------------|
| *(none)* | Required change | Must address before merge |
| **Critical:** | Blocks merge | Security hole, data loss, broken functionality |
| **Nit:** | Minor, optional | May be ignored — formatting, style preference |
| **Optional:** / **Consider:** | Suggestion | Worth weighing, not required |
| **FYI** | Informational | No action; context for later |

Lead with what matters: correctness and security first, then structural regressions, then the
rest. A few high-conviction comments beat a long list. If you have one structural problem and ten
nits, the structural problem is the review.

**Step 5 — verify the verification.** Check the author's story, do not assume it: what tests ran,
did the build pass, was it exercised manually, are there before/after results for a performance or
UI claim? An unverified claim of verification is itself a finding.

## Multi-perspective review

Different reviewers have different blind spots. `workspace-bin/multi-review` emits four reviewer
perspectives over one diff, and this rubric is what those perspectives apply. Where a perspective
needs its own instructions, give it the artifact and the contract, and ask for issues at labeled
severity — not a verdict:

```
Review this change for correctness, security, and adherence to project
conventions. The contract says [X]. The change should [Y].
Flag issues as Critical, Required, Optional, or Nit.
```

For a decision that has not been made yet rather than a diff that is already written, use
`doubt-driven-development` — a fresh mesh task carrying only the artifact and its contract (that is
what a fresh context is on this node). The final call stays with the operator.

## Dead code hygiene

After any refactor, identify code that is now unreachable or unused, list it explicitly, and ask
before deleting.

```
DEAD CODE IDENTIFIED:
- formatLegacyDate() in src/utils/date.ts — replaced by formatDate()
- LEGACY_API_URL in src/config.ts — no remaining references
→ Safe to remove these?
```

Do not leave dead code for future readers to puzzle over, and do not silently delete what you are
unsure about.

## Honesty in review

Do not rubber-stamp: "LGTM" without evidence of review helps nobody. Do not soften a real issue
into "this might be a minor concern" when it will hit production. Quantify where you can — "this
N+1 adds roughly 50ms per list item" beats "this could be slow". Push back directly on approaches
with clear problems and propose the alternative; sycophancy is a review failure mode. Then accept
override gracefully when the author has fuller context, and comment on the code, not the person.

Resolve disputes in this order: technical facts and data over preference; the style guide as final
authority on style; engineering principles for design questions; codebase consistency where it does
not degrade health. Do not accept "I'll clean it up later" — require the cleanup before merge, or a
filed and assigned follow-up.

## Dependency discipline

Before adding a dependency: does the existing stack already solve this (it usually does), how large
is it, is it actively maintained, does it have known vulnerabilities, and is the license
compatible? Prefer the standard library and existing utilities. Every dependency is a liability.

Upgrading is a code change like any other, and bulk "bump deps" merges are the riskiest kind.
Read the changelog rather than trusting the version number — a patch release can carry behavioral
change, and a major needs its migration notes read. Upgrade one dependency per change so a broken
build names its own cause and reverts cleanly. Let a green suite before and after decide; thin
coverage around the dependency's behavior is itself the finding. Review the lockfile diff, not just
the manifest — most installed packages are ones nobody chose directly — and never hand-edit it.

## Red flags

- Merged without review, or reviewed only by checking that tests pass
- "LGTM" with no evidence of actual review
- Security-sensitive changes with no security-focused pass
- A change that is "too big to review properly" — split it
- A bug fix with no regression test
- Comments with no severity labels, so nothing is clearly required
- Accepting "I'll fix it later"
- A refactor that moves code without reducing the concepts a reader must hold
- A change that grows an already-large file instead of decomposing it
- New conditionals scattered into unrelated paths, a bespoke duplicate of a canonical helper, or
  feature logic placed in a shared module
- A bulk dependency bump with no changelog review, or a lockfile change merged unexamined

## Verification

- [ ] All Critical issues resolved
- [ ] All Required changes resolved, or explicitly deferred with justification
- [ ] Tests pass and the build succeeds
- [ ] The verification story is documented: what changed, how it was checked
- [ ] Dependency upgrades were read against their changelog, isolated per package, and verified by
      a green suite with the lockfile diff reviewed

Presumptive blockers — surface these and propose the simpler design, escalating to Required only
when the change actively makes structure worse: a refactor that relocates complexity instead of
reducing it; a change pushing a file past the size boundary with no decomposition; feature logic
added to a shared module; a near-duplicate of an existing canonical helper; a silent fallback
hiding an unclear invariant.
