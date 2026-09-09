---
name: ponytail-review
description: "Reviews a diff for over-engineering only: reinvented stdlib, unneeded dependencies, speculative abstractions, dead flexibility. Use when asked what can be deleted, whether a change is over-engineered, or as the simplicity pass alongside a correctness review."
triggers:
  - "review for over-engineering"
  - "what can we delete"
  - "is this over-engineered"
  - "find speculative abstractions"
negative_triggers:
  - "refactor suggestions"
  - "tech debt cleanup"
  - "scan skill for malware"
license: MIT
metadata: {"clawdbot":{"emoji":"✂️","source":"DietrichGebert/ponytail (MIT)"}}
---

# Ponytail Review

Review a diff for unnecessary complexity. One line per finding: location, what to cut, what
replaces it. The best outcome for a diff is getting shorter.

## Format

`L<line>: <tag> <what>. <replacement>.` — or `<file>:L<line>: …` across multiple files.

| Tag | Means | Replacement names |
|---|---|---|
| `delete:` | dead code, unused flexibility, speculative feature | nothing |
| `stdlib:` | hand-rolled thing the standard library ships | the function |
| `native:` | dependency or code doing what the platform already does | the feature |
| `yagni:` | abstraction with one implementation, config nobody sets, layer with one caller | the inlined form |
| `shrink:` | same logic, fewer lines | the shorter form |

## Examples

Not this: "This EmailValidator class might be more complex than necessary, have you considered
whether all these validation rules are needed at this stage?"

This:

- `L12-38: stdlib: 27-line validator class. "@" in email, 1 line — real validation is the confirmation mail.`
- `L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.`
- `repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second exists.`
- `L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.`
- `L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.`

## Scoring

End with the only metric that matters: `net: -<N> lines possible.`
Nothing to cut → `Lean already. Ship.` and stop.

## Boundaries

Simplicity only. Correctness bugs, security holes and performance are out of scope here — they
belong to `workspace-bin/multi-review`'s other three perspectives, which this skill is the fourth
of. Lists findings, never applies them.

One runnable check behind non-trivial logic is the minimum this node requires
(`config/harness-rules.json`, rules `build-before-done` and `lazy-senior-ladder`), not bloat.
Never flag a smoke test or an assertion for deletion.
