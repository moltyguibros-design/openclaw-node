/**
 * mesh-stall-clear-cap.test.mjs — integrations plan step 5.3.
 *
 * The daemon asks a stalled task's agent whether it is alive before releasing
 * it. An agent whose child process is wedged answers yes truthfully, forever,
 * and the deadline was extended every time — so the task never reached triage.
 * Consecutive clears are now counted and dated, and a worker's own heartbeat
 * ends the run.
 *
 * Also pins the ordering fix to step 5.2's findNotProgressing: a worker that
 * died while parked at a prompt is a stall, not a task waiting on a human.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTask, TaskStore, TASK_STATUS } = require('../lib/mesh-tasks.js');

function mockKv() {
  const rows = new Map();
  let rev = 0;
  return {
    async get(k) { const r = rows.get(k); return r ? { value: r.value, revision: r.revision } : null; },
    async put(k, v) { rows.set(k, { value: v, revision: ++rev }); },
    async update(k, v, expected) {
      const r = rows.get(k);
      if (!r || r.revision !== expected) { const e = new Error('wrong last sequence'); e.code = '10071'; throw e; }
      rows.set(k, { value: v, revision: ++rev });
    },
    async delete(k) { rows.delete(k); },
    async keys() { return (async function* () { for (const k of [...rows.keys()]) yield k; })(); },
  };
}

const running = (id, extra = {}) => ({
  ...createTask({ task_id: id, title: id }),
  status: TASK_STATUS.RUNNING,
  owner: 'w1',
  started_at: new Date().toISOString(),
  ...extra,
});
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

describe('markStallCleared', () => {
  it('dates the first clear and counts the run', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-1'));
    const first = await store.markStallCleared('T-1');
    assert.equal(first.stall_clear_count, 1);
    assert.ok(first.stall_cleared_since);
    const second = await store.markStallCleared('T-1');
    assert.equal(second.stall_clear_count, 2);
    assert.equal(second.stall_cleared_since, first.stall_cleared_since,
      'the window measures the run, so its start must not move on every clear');
  });

  it('still extends the deadline each time', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-2', { last_activity: minutesAgo(9) }));
    const t = await store.markStallCleared('T-2');
    assert.ok(Date.now() - new Date(t.last_activity).getTime() < 5000);
  });

  it('a heartbeat from the worker ends the run', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-3'));
    await store.markStallCleared('T-3');
    await store.markStallCleared('T-3');
    const beat = await store.touchActivity('T-3', { activityState: 'active' });
    assert.equal(beat.stall_cleared_since, undefined, 'real progress resets the window');
    assert.equal(beat.stall_clear_count, undefined);
  });

  it('does not touch a terminal task', async () => {
    const store = new TaskStore(mockKv());
    await store.put({ ...createTask({ task_id: 'T-4', title: 'x' }), status: TASK_STATUS.COMPLETED });
    assert.equal(await store.markStallCleared('T-4'), null);
  });
});

describe('stallClearedForMinutes', () => {
  it('is null before any clear and measures the run afterwards', () => {
    assert.equal(TaskStore.stallClearedForMinutes(running('T')), null);
    const mins = TaskStore.stallClearedForMinutes(running('T', { stall_cleared_since: minutesAgo(31) }));
    assert.ok(mins > 30 && mins < 32, `expected ~31, got ${mins}`);
  });

  it('decides the 30-minute cap', () => {
    const under = TaskStore.stallClearedForMinutes(running('T', { stall_cleared_since: minutesAgo(29) }));
    const over = TaskStore.stallClearedForMinutes(running('T', { stall_cleared_since: minutesAgo(31) }));
    assert.ok(under < 30, 'still inside the window — the alive answer is believed');
    assert.ok(over >= 30, 'past the window — the task falls through to release');
  });
});

describe('findNotProgressing freshness bound (5.2 correction)', () => {
  it('claims a parked worker that is still heartbeating', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-parked', {
      activity_state: 'waiting_input',
      activity_state_since: minutesAgo(30),
      last_activity: new Date().toISOString(),
    }));
    const found = await store.findNotProgressing(10, undefined, { heartbeatWithinMs: 5 * 60_000 });
    assert.deepEqual(found.map((t) => t.task_id), ['T-parked']);
  });

  it('leaves a worker that died while parked to the stall detector', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-dead', {
      activity_state: 'waiting_input',
      activity_state_since: minutesAgo(30),
      last_activity: minutesAgo(20),
    }));
    assert.deepEqual(await store.findNotProgressing(10, undefined, { heartbeatWithinMs: 5 * 60_000 }), [],
      'a dead worker is a stall, not a task waiting on a human');
    assert.deepEqual((await store.findStalled(5)).map((t) => t.task_id), ['T-dead']);
  });

  it('keeps the old behaviour when no bound is passed', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-dead2', {
      activity_state: 'blocked',
      activity_state_since: minutesAgo(30),
      last_activity: minutesAgo(20),
    }));
    assert.deepEqual((await store.findNotProgressing(10)).map((t) => t.task_id), ['T-dead2']);
  });
});

describe('the defect this closes', () => {
  it('an alive-but-wedged worker stops being believed after the window', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-wedged', { last_activity: minutesAgo(6) }));

    // Six passes over ~31 minutes: the agent answers alive every time.
    let task = await store.markStallCleared('T-wedged');
    await store.put({ ...task, stall_cleared_since: minutesAgo(31) }); // age the run
    for (let i = 0; i < 5; i += 1) task = await store.markStallCleared('T-wedged');

    assert.equal(task.stall_clear_count, 6);
    const clearedFor = TaskStore.stallClearedForMinutes(task);
    assert.ok(clearedFor >= 30, `run should exceed the window, got ${clearedFor}`);

    // The daemon's decision at this point: stop clearing, release with a reason
    // that names what actually happened rather than "no heartbeat".
    const reason = `Alive but not progressing: agent answered the alive check ${task.stall_clear_count}x over ${clearedFor.toFixed(1)}m (window 30m) without finishing`;
    const released = await store.markReleased('T-wedged', reason, []);
    assert.equal(released.status, TASK_STATUS.RELEASED);
    assert.match(released.release_reason || reason, /answered the alive check 6x/);
  });
});
