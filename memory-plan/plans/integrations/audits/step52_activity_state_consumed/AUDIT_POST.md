# AUDIT_POST — step 5.2 · the worker's activity_state is consumed

## §0 Micro re-orient

VERSION v2.4 → v5.2-pre. The step as planned was "build an agent-state detector". Reading the code
first showed one already exists, so the step was re-scoped before any code was written (**D10**).

## What the step turned out to be

`lib/agent-activity.js` has always classified a Claude worker from its JSONL — `starting`,
`active`, `ready`, `idle`, `waiting_input`, `blocked` — and `bin/mesh-agent.js` has always put that
in the heartbeat as `activity_state`. The gap was on the receiving side, and it was worse than a
missing detector:

- `handleHeartbeat` destructured only `task_id` and called `store.touchActivity(task_id)`.
- `touchActivity` refreshed `last_activity` and renewed the lease.
- So a worker parked on a permission prompt heartbeated every 60 s, and **every heartbeat reset the
  stall clock and renewed the lease**. The stall detector — the one mechanism meant to catch a stuck
  worker — was defeated by the stuck worker's own heartbeat. The task sat claimed until its budget
  expired.

Building the planned detector would have added a second classifier beside a working one
(MASTER_PLAN §4.6) and left this defect in place.

## Deltas (greppable)

- `lib/mesh-tasks.js`: `STUCK_ACTIVITY_STATES` (exported), `touchActivity(taskId, {activityState,
  activityTimestamp})` persisting `activity_state` / `activity_timestamp` / `activity_state_since`,
  new `findNotProgressing(minutes, states)`, both added to the traced method list.
- `bin/mesh-task-daemon.js`: heartbeat handler reads and forwards the two fields and echoes the
  state in its reply; `NOT_PROGRESSING_MINUTES` (env `MESH_NOT_PROGRESSING_MINUTES`, default 10);
  an enforcement branch ahead of stall detection that releases such tasks for human triage.
- `test/mesh-activity-state.test.mjs`: 10 tests.

## Verify contract — executed

**`code:` PASS.** `node --test test/mesh-activity-state.test.mjs test/mesh-tasks-status.test.js
test/agent-activity.test.js` → **47 tests, 47 pass, 0 fail**. The cases that matter: the
since-timestamp does **not** advance while the state is unchanged (a worker stuck an hour must not
look freshly stuck on every heartbeat), it **does** restart when the state changes, a stateless
heartbeat does not erase a known state, and terminal tasks are excluded.

**`runtime:` PASS.** Real `nats-server` v2.10.22 with JetStream, real `TaskStore` over a real KV
bucket, five heartbeats per task exactly as `mesh-agent.js` sends them:

```
persisted: state=waiting_input  since=14:49:17Z  last_activity=15:34:17Z
stall detector (5m) sees : []            ← correct: the worker IS alive
not-progressing (10m) sees: [ 'T-stuck' ] ← the state nothing could see before
released: T-stuck status=released
  reason: agent reported waiting_input for 45.0m (threshold 10m) — needs a human
after release, not-progressing sees: []
```

`T-busy`, reporting `active` for the same 45 minutes, is untouched by both.

**Regression, like-for-like.** Both suites run with NATS up, so the comparison is honest:

| | tests | pass | fail |
|---|---|---|---|
| committed HEAD `b5d6f5c` (worktree) | 2032 | 1694 | **263** |
| this branch | 2042 | 1704 | **263** |

Exactly +10 tests, +10 passes, **no new failures**. (The 263 are environmental — no ollama, no
`~/.openclaw`, no built `better-sqlite3` binding. That count is higher than the 246 recorded
earlier because NATS is now running, so mesh suites execute instead of bailing early; the baseline
above was re-measured under the same conditions rather than compared across them.)

## Findings

1. **The registry entry that motivated this step was wrong.** Block 0 recorded "no `activity_state`
   in the heartbeat" from the absence of `lib/agent-status.js`. The field was there all along. A
   probe for a file is not a probe for a behaviour, and the corrected row now cites the grep that
   settles it.
2. **`findStalled` returning nothing for a stuck worker is correct, not a bug**, which is why this
   needed a separate query rather than a fix to the existing one. Liveness and progress are
   different questions; the daemon now asks both.
3. `activity_state_since` is what makes the check meaningful. Keying off `last_activity` would have
   re-armed on every heartbeat and the threshold would never fire.
4. Noted while probing: `better-sqlite3` has no built binding in this container (installed with
   `--ignore-scripts`), so `lib/obs-db.js` logs a load failure on any require of the tracer path.
   Unrelated to this change and pre-existing here.

## §6 carry-forwards

- Mission Control still does not surface `activity_state`; the field is now persisted on the task,
  so a column or badge is a read-only change whenever someone wants it.
- The non-Claude branch of the heartbeat reports a flat `active`; other providers have no
  equivalent classifier, so `findNotProgressing` only ever fires for Claude workers today.

## Feeds — landed

`lib/mesh-tasks.js` persists and queries the reported state; `bin/mesh-task-daemon.js` acts on it
each enforcement pass. Any consumer of the task record (Mission Control, `mesh.tasks.get`) now sees
`activity_state`, `activity_timestamp` and `activity_state_since`.
