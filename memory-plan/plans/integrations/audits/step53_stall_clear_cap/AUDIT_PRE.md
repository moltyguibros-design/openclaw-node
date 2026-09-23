# AUDIT_PRE — step 5.3 · cap the stall-clearing alive check

## §0 Micro re-orient (2026-09-09)

- VERSION v6.1 → v5.3-pre. Row 5.3 was written as "30-minute staleness and missed-Stop inference",
  borrowed from Orca. Reading the daemon first, as 5.2 taught: Orca's missed-Stop inference reads a
  terminal's keystroke baseline and has no counterpart here — this node drives a child process, not
  a TUI. The transferable half is the staleness window, and it lands on a real defect.
- Needs pre-screen: `detectStalls()` present with the alive-check branch ✔ · `store.markReleased`
  and `touchActivity` present ✔ · 5.2's `activity_state` persistence in place ✔ · nats-server
  available for a runtime probe ✔.

## The defect

`bin/mesh-task-daemon.js` `detectStalls()`, alive-check branch:

```js
if (response.alive) {
  await store.touchActivity(task.task_id);
  log(`STALL CLEARED ${task.task_id}: agent ${task.owner} confirmed alive. Extended deadline.`);
  continue;
}
```

Unbounded. Every pass that finds the task stalled asks the agent, the agent answers "alive", and
the deadline is extended again. A worker whose child process is wedged — an LLM call that never
returns, a retry loop — answers "alive" truthfully forever, so the stall detector clears forever
and the task never reaches triage. This is the same shape as the defect 5.2 closed: a liveness
signal standing in for progress.

`findStalled` cannot see it (the clear refreshes `last_activity`), and `findNotProgressing` cannot
either unless the worker happens to report `waiting_input`/`blocked`.

## Second, smaller defect — in 5.2's own code

`findNotProgressing` runs before the stall branch and does not check whether heartbeats are still
arriving. A worker that died while parked at a prompt keeps its last reported `waiting_input` and
is released as "needs a human" when it is simply dead. The label is wrong and the collab-session
death marking that the stall path performs is skipped. Fix: only treat a task as parked while its
`last_activity` is fresh; otherwise leave it to stall detection.

## Design

- `markStallCleared(taskId)` on the store: records `stall_cleared_since` (first clear of the
  current run) and increments `stall_clear_count`, alongside the existing activity touch.
- Any real progress clears both fields, so the window measures *consecutive* clears, not lifetime.
  The natural place is `touchActivity` when a worker heartbeats on its own.
- `STALL_CLEAR_WINDOW_MINUTES` (env `MESH_STALL_CLEAR_WINDOW_MINUTES`, default 30): past it, an
  "alive" answer no longer clears; the task falls through to the existing release path with a
  reason naming the count.
- `findNotProgressing` gains a freshness bound so it only claims tasks whose worker is still
  heartbeating.

## Risks

- Releasing a genuinely-working-but-quiet agent. Mitigated: the window is consecutive-only and
  defaults to 30 minutes of *no other signal*; any heartbeat the worker sends itself resets it.
- The daemon's own `touchActivity` call inside the clear must not reset the window it is meant to
  measure — the store method has to distinguish a daemon-side clear from a worker-side heartbeat.

## §6 file-delta outline

- `lib/mesh-tasks.js`: `markStallCleared`, window fields cleared on worker heartbeat,
  `findNotProgressing` freshness bound, traced-method list.
- `bin/mesh-task-daemon.js`: `STALL_CLEAR_WINDOW_MINUTES`; the alive branch consults it.
- `test/mesh-stall-clear-cap.test.mjs`: new.
- Silo: INVENTORY, VERSION, COMPONENT_REGISTRY, AUDIT_POST.
