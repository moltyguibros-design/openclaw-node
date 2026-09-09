---
name: incremental-implementation
description: "Land multi-file changes as thin vertical slices: implement, test, verify, commit, repeat, keeping the tree green and flagging incomplete paths. Use when a change touches more than one file or is about to be written all at once."
triggers:
  - "implement in thin slices"
  - "land this incrementally"
  - "vertical slice plan"
  - "too big to land at once"
negative_triggers:
  - "break down this epic into stories"
  - "split this user story"
  - "plan my quarterly roadmap"
license: MIT
metadata: {"clawdbot":{"emoji":"🧱","source":"addyosmani/agent-skills (MIT)"}}
---

# Incremental Implementation

Build in thin vertical slices. Implement one piece, test it, verify it, commit, then
expand. Each increment leaves the system in a working, testable state. This is the
execution discipline that makes a large change manageable.

## When to Use

- Any multi-file change
- Building a feature from a task breakdown
- Refactoring existing code
- Any time you are tempted to write more than ~100 lines before testing

**When NOT to use:** single-file, single-function changes where the scope is already
minimal.

## The Increment Cycle

For each slice:

1. **Implement** the smallest complete piece of functionality
2. **Test** — run the suite, or write the test if none covers this
3. **Verify** — tests pass, build succeeds, manual check where user-visible
4. **Commit** — one descriptive, atomic commit
5. **Next slice** — carry forward, do not restart

## Slicing Strategies

### Vertical slices (preferred)

One complete path through the stack per slice:

```
Slice 1: Create a task   (store + API + minimal UI) → user can create
Slice 2: List tasks      (query + API + UI)         → user can see
Slice 3: Edit a task     (update + API + UI)        → user can modify
Slice 4: Delete a task   (delete + API + confirm)   → CRUD complete
```

Each slice delivers working end-to-end functionality.

### Contract-first slicing

When two sides develop in parallel:

```
Slice 0:  Define the contract (types, interfaces, schema)
Slice 1a: Implement the backend against the contract + tests
Slice 1b: Implement the frontend against mock data matching the contract
Slice 2:  Integrate and test end to end
```

### Risk-first slicing

Take the most uncertain piece first, so a dead end costs one slice, not five:

```
Slice 1: Prove the live connection works (highest risk)
Slice 2: Build updates on the proven connection
Slice 3: Add reconnection and offline handling
```

## Implementation Rules

### Rule 0: Simplicity first

Before writing code, ask what the simplest thing that could work is. After writing it,
check: fewer lines possible? Are these abstractions earning their complexity? Am I
building for hypothetical future requirements or the current task?

```
✗ Generic event bus with a middleware pipeline for one notification
✓ A function call

✗ Abstract factory for two similar components
✓ Two straightforward components with a shared utility

✗ Config-driven form builder for three forms
✓ Three form components
```

Three similar lines beat a premature abstraction. Write the naive, obviously correct
version first; optimize only after correctness is proven by tests.

### Rule 0.5: Scope discipline

Touch only what the task requires, and only what the active plan's `SCOPE.md` and
`config/harness-rules.json` allow. Do not clean up adjacent code, refactor imports in
files you are not modifying, remove comments you do not understand, add unspecified
features, or modernize syntax in files you are only reading.

Something worth improving outside the task goes to the plan's `OUT_OF_SCOPE.md` as a
note, not into this diff:

```
NOTICED BUT NOT TOUCHING:
- src/utils/format.ts has an unused import (unrelated to this task)
- The auth middleware could use better error messages (separate task)
```

### Rule 1: One thing at a time

Each increment changes one logical thing. A single commit that adds a component,
refactors another, and updates the build config is three commits wearing a coat.

### Rule 2: Keep it compilable

After each increment the project builds and existing tests pass. Never leave the tree
broken between slices.

### Rule 3: Flag incomplete paths

If a path is not ready for users but the increment should land, gate it behind an
explicit flag defaulting to off:

```typescript
const ENABLE_TASK_SHARING = process.env.FEATURE_TASK_SHARING === 'true';

if (ENABLE_TASK_SHARING) {
  // work in progress
}
```

This lets small increments land without exposing unfinished work.

### Rule 4: Safe defaults

New behavior is opt-in, not opt-out:

```typescript
export function createTask(data: TaskInput, options?: { notify?: boolean }) {
  const shouldNotify = options?.notify ?? false;
  // ...
}
```

### Rule 5: Rollback-friendly

- Additive changes (new files, new functions) revert cleanly
- Modifications to existing code stay minimal and focused
- Migrations ship with their rollback
- Do not delete something and replace it in the same commit — separate them

## Delegating a Slice

When a slice is handed off, name the boundary explicitly: the artifact, what is in
scope, what is not, and the verification command. On this node that means a fresh mesh
task carrying only the artifact and its contract (that is what a fresh context is
here). Example brief:

```
Implement slice 2 of the plan: the store schema change and the API endpoint.
Do not touch the UI — that is slice 3.
Verify with the repository's test and build commands before reporting.
```

## Increment Checklist

After each increment, using the repository's own commands:

- [ ] The change does one thing and does it completely
- [ ] All existing tests still pass
- [ ] The build succeeds
- [ ] Type checking passes, where the stack has one
- [ ] Linting passes
- [ ] The new functionality works as expected
- [ ] The change is committed with a descriptive message

Run each command after a change that could affect it. After a successful run, do not
repeat the same command unless the code has changed — re-running on unchanged code
adds no information.

## Red Flags

- More than 100 lines written without running tests
- Multiple unrelated changes in one increment
- "Let me just quickly add this too" scope expansion
- Skipping the test or verify step to move faster
- Build or tests broken between increments
- Large uncommitted changes accumulating
- Building an abstraction before the third use case demands it
- Touching files outside the task scope "while I'm here"
- Running the same build or test command twice with no edit in between

## Verification

After all increments for a task:

- [ ] Each increment was individually tested and committed
- [ ] The full test suite passes
- [ ] The build is clean
- [ ] The feature works end to end as specified
- [ ] No uncommitted changes remain

Per-increment verification is the local check. The project-wide gate is the final one:
run `workspace-bin/quality-gate` and satisfy `config/harness-rules.json` before
calling the task done.
