/**
 * mesh-activity-state.test.mjs — integrations plan step 5.2.
 *
 * lib/agent-activity.js has always classified a Claude worker as waiting_input
 * or blocked, and bin/mesh-agent.js has always sent that in the heartbeat. The
 * daemon dropped it: touchActivity refreshed last_activity and renewed the
 * lease, so a worker parked on a permission prompt reset the stall clock with
 * its own heartbeat and stayed claimed until its budget ran out (D10).
 *
 * These tests pin the consumer side: the state is persisted, the clock starts
 * when the state CHANGES, and a task stuck past the threshold is findable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTask, TaskStore, TASK_STATUS, STUCK_ACTIVITY_STATES } = require('../lib/mesh-tasks.js');
const { StringCodec } = require('nats');
const sc = StringCodec();

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

describe('STUCK_ACTIVITY_STATES', () => {
  it('names the states that mean alive but not progressing', () => {
    assert.deepEqual(STUCK_ACTIVITY_STATES, ['waiting_input', 'blocked']);
  });
});

describe('touchActivity persists what the worker reported', () => {
  it('records the state and when it began', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-1'));
    const t = await store.touchActivity('T-1', { activityState: 'active', activityTimestamp: '2026-09-08T00:00:00.000Z' });
    assert.equal(t.activity_state, 'active');
    assert.equal(t.activity_timestamp, '2026-09-08T00:00:00.000Z');
    assert.ok(t.activity_state_since, 'the first report starts the clock');
  });

  it('keeps the original since-timestamp while the state is unchanged', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-2'));
    const first = await store.touchActivity('T-2', { activityState: 'waiting_input' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await store.touchActivity('T-2', { activityState: 'waiting_input' });
    assert.equal(second.activity_state_since, first.activity_state_since,
      'a worker stuck for an hour must not look freshly stuck on every heartbeat');
    assert.notEqual(second.last_activity, first.last_activity, 'liveness still advances');
  });

  it('restarts the clock when the state changes', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-3'));
    const stuck = await store.touchActivity('T-3', { activityState: 'waiting_input' });
    await new Promise((r) => setTimeout(r, 5));
    const moved = await store.touchActivity('T-3', { activityState: 'active' });
    assert.notEqual(moved.activity_state_since, stuck.activity_state_since);
  });

  it('leaves the fields alone when a heartbeat carries no state', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-4'));
    await store.touchActivity('T-4', { activityState: 'blocked' });
    const plain = await store.touchActivity('T-4');
    assert.equal(plain.activity_state, 'blocked', 'a stateless heartbeat must not erase a known state');
  });
});

describe('findNotProgressing', () => {
  it('finds a worker parked on a permission prompt past the threshold', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-stuck', {
      activity_state: 'waiting_input',
      activity_state_since: minutesAgo(30),
      last_activity: new Date().toISOString(),
    }));
    const found = await store.findNotProgressing(10);
    assert.deepEqual(found.map((t) => t.task_id), ['T-stuck']);
  });

  it('ignores one that just entered the state', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-fresh', { activity_state: 'waiting_input', activity_state_since: minutesAgo(2) }));
    assert.deepEqual(await store.findNotProgressing(10), []);
  });

  it('ignores a working agent however long it has been working', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-busy', { activity_state: 'active', activity_state_since: minutesAgo(600) }));
    assert.deepEqual(await store.findNotProgressing(10), []);
  });

  it('catches blocked as well as waiting_input, and skips terminal tasks', async () => {
    const store = new TaskStore(mockKv());
    await store.put(running('T-blocked', { activity_state: 'blocked', activity_state_since: minutesAgo(60) }));
    await store.put({
      ...createTask({ task_id: 'T-done', title: 'done' }),
      status: TASK_STATUS.COMPLETED,
      activity_state: 'blocked',
      activity_state_since: minutesAgo(60),
    });
    assert.deepEqual((await store.findNotProgressing(10)).map((t) => t.task_id), ['T-blocked']);
  });
});

describe('the defect this closes', () => {
  it('a stuck worker heartbeating forever no longer looks healthy to both detectors', async () => {
    const store = new TaskStore(mockKv());
    // The worker hit the prompt 45 minutes ago and has heartbeated ever since.
    await store.put(running('T-perm', { activity_state: 'waiting_input', activity_state_since: minutesAgo(45) }));
    for (let i = 0; i < 45; i += 1) {
      await store.touchActivity('T-perm', { activityState: 'waiting_input' });
    }
    const task = await store.get('T-perm');
    // findStalled still sees a live task — that is correct, it IS alive.
    assert.deepEqual(await store.findStalled(5), [], 'heartbeats legitimately clear the stall detector');
    // findNotProgressing is the one that can see it.
    assert.deepEqual((await store.findNotProgressing(10)).map((t) => t.task_id), ['T-perm']);
    assert.equal(task.activity_state, 'waiting_input');
  });
});
