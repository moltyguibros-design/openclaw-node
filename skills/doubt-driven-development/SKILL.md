---
name: doubt-driven-development
description: "Adversarial fresh-context review of a decision before it stands: state the claim, extract the smallest reviewable unit, hand it to a reviewer who never saw your reasoning, reconcile, stop. Use when stakes are high or the code is unfamiliar."
triggers:
  - "doubt this decision"
  - "fresh context review"
  - "adversarial second opinion"
  - "stress test this change"
negative_triggers:
  - "challenge our assumptions about this initiative"
  - "reflect on mistakes"
  - "review for over-engineering"
license: MIT
metadata: {"clawdbot":{"emoji":"🧪","source":"addyosmani/agent-skills (MIT)"}}
---

# Doubt-Driven Development

A confident answer is not a correct one. A long session accumulates context that quietly turns
assumptions into facts. This skill materializes a reviewer biased to disprove, before a
non-trivial decision stands.

This is not a merge review. A merge review is a verdict on a finished artifact; this is an
in-flight posture applied while course correction is still cheap.

## When it applies

A decision is non-trivial when at least one is true:

- It introduces or modifies branching logic
- It crosses a module or service boundary
- It asserts a property no compiler can verify (thread safety, idempotence, ordering, invariants)
- Its correctness depends on context a future reader cannot see
- Its blast radius is irreversible (deploy, data migration, public API change)

Do not apply it to renames, formatting, file moves, one-line changes with obvious correctness,
reading or summarizing code, running tests, or an unambiguous instruction already given. If you
doubt every keystroke you ship nothing.

## The cycle

```
- [ ] 1 CLAIM      — wrote the claim + why it matters
- [ ] 2 EXTRACT    — isolated artifact + contract, stripped reasoning
- [ ] 3 DOUBT      — fresh context reviewed it adversarially
- [ ] 4 RECONCILE  — classified every finding against the artifact text
- [ ] 5 STOP       — hit a stop condition (trivial findings, 3 cycles, operator override)
```

### 1. CLAIM — surface what stands

Name the decision in two or three lines.

```
CLAIM: "The new caching layer is thread-safe under the
        read-heavy workload described in the spec."
WHY IT MATTERS: a race here corrupts user data and is
                hard to detect in QA.
```

If you cannot write the claim that compactly, you have a vibe, not a decision.

### 2. EXTRACT — the smallest reviewable unit

A fresh reviewer needs the artifact and the contract, not the journey.

- Code: the diff or the function, not the whole file
- Decision: the proposal in three to five sentences plus the constraints it must satisfy
- Assertion: the claim plus the evidence that supposedly supports it

The contract is not invented on the spot. Draw it from `config/harness-rules.json` and the
plan's active `SCOPE.md`, plus the task's own stated requirements.

Strip your reasoning. Hand over conclusions and you get back validation of your conclusions. The
unit must be small enough to hold in mind in one read; a 500-line diff gets decomposed first.

### 3. DOUBT — hand it to a fresh context

On this node, a fresh context is a fresh mesh task carrying only the artifact and its contract.
It has no access to the reasoning that produced them, which is the entire point.

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state
explicitly that you cannot find any after thorough examination.

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

Pass ARTIFACT and CONTRACT only. Do not pass the CLAIM — handing over your conclusion biases the
reviewer toward agreement. It must independently determine whether the artifact satisfies the
contract.

The prompt above overrides any reviewer default that produces balanced verdicts with strengths
and weaknesses. Doubt-driven needs issues-only output; paste the prompt verbatim.

#### Multiple perspectives

One reviewer shares blind spots with the author. `workspace-bin/multi-review` emits four
reviewer perspectives over the same artifact and is the cheap escalation when one pass comes back
clean on a high-stakes claim.

In an interactive session, offer the escalation and let the operator decide; never skip it
silently. In a non-interactive run (scheduled tick, autonomous loop) it is skipped and the skip is
announced in the output: "multi-perspective escalation skipped: non-interactive." Announce a
failed or unavailable escalation the same way rather than quietly falling back to one pass.

### 4. RECONCILE — fold findings back

The reviewer's output is data, not verdict. You are still the orchestrator: re-read the artifact
text against each finding before classifying. Rubber-stamping the reviewer is the same failure as
ignoring it.

Classify each finding in precedence order, first match wins:

1. **Contract misread** — flagged because the CONTRACT you supplied was unclear or incomplete.
   Fix the contract first, re-classify next cycle.
2. **Valid and actionable** — a real issue requiring a change. Change it, re-loop.
3. **Valid trade-off** — real, but fixing costs more than accepting. Document it where the
   operator will see it; a decision worth keeping goes in the plan's `DECISIONS.md`.
4. **Noise** — correct under context the reviewer did not have. Note it, and ask whether adding
   that context to the contract would have prevented the false flag.

A fresh reviewer can be wrong precisely because it lacks context. Do not defer just because it is
fresh.

### 5. STOP — bounded loop, not recursion

Stop when the next iteration returns only trivial or already-considered findings, or after three
cycles, or when the operator says ship it.

Three cycles that still surface substantive issues is information about the artifact, not a reason
to run a fourth alone — escalate. If three cycles feel obviously insufficient, the artifact is too
big: return to step 2 and decompose. Do not lift the bound.

## Red flags

- Spawning a fresh context for a one-line rename or a formatting change
- Treating reviewer output as authoritative without re-reading the artifact text
- Looping past three cycles without escalating
- Prompting with "is this good?" instead of "find issues"
- Skipping doubt under time pressure on a high-stakes decision
- Re-running an unchanged artifact through a fresh context — same findings, you are stalling
- Doubt theater: across two or more cycles with substantive findings, zero were classified
  actionable. You are validating, not doubting. Stop and escalate.
- Stripping the contract from the reviewer's input, or passing it the CLAIM
- Doubting only after committing — that is a merge review, not this

## Relation to other skills

- `code-review-and-quality` is the post-hoc merge verdict; this is the in-flight per-decision
  check. Use both.
- `ponytail-review` asks whether the artifact is over-built. This asks whether it is wrong.
- A failing test written before the fix is doubt made concrete, and satisfies the fresh-context
  requirement for a behavioral claim.

## Verification

- [ ] Every non-trivial decision was named as a CLAIM before it stood
- [ ] At least one fresh-context review per non-trivial artifact
- [ ] The reviewer received ARTIFACT and CONTRACT — not the CLAIM, not your reasoning
- [ ] The prompt was adversarial, not validating
- [ ] Findings were classified against the artifact text using the precedence above
- [ ] A stop condition was met: trivial findings, three cycles, or operator override
- [ ] Multi-perspective escalation was offered interactively, or its skip was announced
