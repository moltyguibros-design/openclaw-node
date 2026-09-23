# AUDIT_POST — step 5.3 · cap the stall-clearing alive check

## Promised vs landed

| Promised in AUDIT_PRE | Landed |
|---|---|
| `markStallCleared` counting and dating the run | yes, plus `TaskStore.stallClearedForMinutes` |
| a worker's own heartbeat ends the run | yes — `touchActivity` deletes both fields |
| `MESH_STALL_CLEAR_WINDOW_MINUTES`, default 30 | yes |
| release reason names what happened | yes — "answered the alive check Nx over Xm" replaces "no heartbeat", which was false in this case |
| freshness bound on `findNotProgressing` | yes, opt-in; the daemon passes `STALL_MINUTES` |

## Deltas (greppable)

- `lib/mesh-tasks.js`: `markStallCleared`, static `stallClearedForMinutes`, clear-fields reset in
  `touchActivity`, `heartbeatWithinMs` option on `findNotProgressing`, traced-method list.
- `bin/mesh-task-daemon.js`: `STALL_CLEAR_WINDOW_MINUTES`; the alive branch consults the window
  before believing "alive"; the release reason is chosen by which condition fired.
- `test/mesh-stall-clear-cap.test.mjs`: 10 tests.

## Verify contract — executed

**`code:` PASS.** `node --test test/mesh-stall-clear-cap.test.mjs test/mesh-activity-state.test.mjs
test/mesh-tasks-status.test.js` → **37 tests, 37 pass, 0 fail**. The cases that carry the meaning:
the run's start does not move on each clear (or the window would never elapse), a worker heartbeat
resets it, terminal tasks are untouched, and the un-bounded `findNotProgressing` call still behaves
as before for any caller that does not pass the option.

**`runtime:` PASS.** Real `nats-server` v2.10.22 + JetStream, real store methods:

```
--- agent answers "alive" on every pass
clears=6 run=31.0m window=30m
daemon decision: STALL CLEAR EXHAUSTED → release
released: status=released
  reason: Alive but not progressing: agent answered the alive check 6x over 31.0m (window 30m) without finishing
--- a worker that makes real progress is unaffected
after its own heartbeat: cleared_since=undefined count=undefined
daemon decision: window reset — believed again
--- dead-while-parked is a stall, not "needs a human"
findNotProgressing: []  findStalled: [T-dead]
```

## Findings

1. **The step as written did not match this node.** Row 5.3 asked for "30-minute staleness and
   missed-Stop inference", both taken from Orca. Missed-Stop inference reads a terminal's keystroke
   baseline; this node spawns a child process and has no terminal to read, so that half has no
   counterpart and was not built. The staleness half turned out to name a real defect once pointed
   at the right mechanism — the alive check, not a status cache.
2. **The unbounded clear is the same bug as 5.2, one layer up.** 5.2 fixed a liveness signal
   (heartbeat) standing in for progress; this is a liveness *answer* ("alive") standing in for
   progress. Worth noting because the pattern will recur: every affirmative signal in this daemon
   needs to answer "and is it getting anywhere?", not only "is it there?".
3. **5.2's own code needed a correction, found by reading the call order.** `findNotProgressing`
   ran before the stall branch with no freshness check, so a worker that died while parked at a
   prompt was released as "needs a human" — the wrong label, and it skipped the collab
   death-marking that the stall path performs. The bound is opt-in so the store method keeps its
   old contract for any other caller.

## §6 carry-forwards

- Step 5.4 touches `bin/mesh-agent.js` worktree cleanup; unrelated to these fields.
- `activity_state` is still not surfaced anywhere a human looks (Mission Control). Both this step
  and 5.2 write fields onto the task that a UI could show without any further backend work.

## Feeds — landed

`lib/mesh-tasks.js` records and exposes the clear run; `bin/mesh-task-daemon.js` bounds it each
enforcement pass and releases with a reason that matches the actual failure.
