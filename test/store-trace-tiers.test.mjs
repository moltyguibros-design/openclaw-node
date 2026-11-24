/**
 * store-trace-tiers.test.mjs — the task, collab and plan stores traced every
 * call, plain reads included, as tier-1 'state_transition'. Smart mode persists
 * and publishes every tier-1 event, so background polling filled the
 * observability feed. Reads are now 'io' at tier 3 (kept only when slow or
 * failing); mutators stay tier-1 state transitions.
 *
 * Run: node --test test/store-trace-tiers.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-trace-'));
const dbPath = path.join(dir, 'mission-control.db');
process.env.OPENCLAW_OBS_DB = dbPath;
process.env.OPENCLAW_TRACE_MODE = 'smart';
const obsDb = require('../lib/obs-db.js');
const { TaskStore } = require('../lib/mesh-tasks.js');
const { CollabStore, createSession } = require('../lib/mesh-collab.js');
const { PlanStore, createPlan } = require('../lib/mesh-plans.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
require('../lib/tracer.js').createTracer('warmup').emit('warmup');
obsDb.flushEvents();

class MockKV {
  constructor() { this.store = new Map(); this.seq = 0; }
  async put(key, value) { this.store.set(key, { value, revision: ++this.seq }); return this.seq; }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

const rows = (module) => {
  obsDb.flushEvents();
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT function, tier, category FROM observability_events WHERE module = ? ORDER BY timestamp').all(module); }
  finally { db.close(); }
};

test('task store reads leave no trace row; a transition leaves one state_transition row', async () => {
  const store = new TaskStore(new MockKV());
  const kv = store.kv;
  await kv.put('T-1', Buffer.from(JSON.stringify({ task_id: 'T-1', status: 'claimed', owner: 'n1', created_at: new Date().toISOString() })));
  const before = rows('mesh-tasks').length;
  for (let i = 0; i < 10; i++) {
    await store.get('T-1');
    await store.list();
    await store.findStalled();
    await store.findOverBudget();
  }
  assert.equal(rows('mesh-tasks').length, before, 'fast successful reads are not persisted');
  await store.markRunning('T-1');
  const added = rows('mesh-tasks').slice(before);
  assert.deepEqual(added.map(r => [r.function, r.tier, r.category]), [['markRunning', 1, 'state_transition']]);
});

test('collab store reads leave no trace row; a transition still does', async () => {
  const collab = new CollabStore(new MockKV());
  const session = createSession('T-2', { mode: 'parallel', min_nodes: 1, max_nodes: 2 });
  await collab.kv.put(session.session_id, Buffer.from(JSON.stringify(session)));
  const before = rows('mesh-collab').length;
  for (let i = 0; i < 5; i++) {
    await collab.get(session.session_id);
    await collab.list();
    await collab.findByTaskId('T-2');
    await collab.findActiveSessionsByNode('n1');
  }
  assert.equal(rows('mesh-collab').length, before);
  await collab.markAborted(session.session_id, 'cancelled');
  const added = rows('mesh-collab').slice(before);
  assert.ok(added.some(r => r.function === 'markAborted' && r.tier === 1 && r.category === 'state_transition'), JSON.stringify(added));
  assert.ok(added.every(r => r.category === 'state_transition'), 'no read rows ride along');
});

test('plan store reads leave no trace row; a transition still does', async () => {
  const plans = new PlanStore(new MockKV());
  const plan = createPlan({ parent_task_id: 'T-3', title: 'p', subtasks: [{ subtask_id: 'a', title: 'a' }] });
  await plans.kv.put(plan.plan_id, Buffer.from(JSON.stringify(plan)));
  const before = rows('mesh-plans').length;
  for (let i = 0; i < 5; i++) {
    await plans.get(plan.plan_id);
    await plans.list();
  }
  assert.equal(rows('mesh-plans').length, before);
  await plans.markAborted(plan.plan_id, 'stop');
  const added = rows('mesh-plans').slice(before);
  assert.ok(added.some(r => r.function === 'markAborted' && r.tier === 1 && r.category === 'state_transition'), JSON.stringify(added));
});

test('a failing read is still persisted', async () => {
  const store = new TaskStore({ async get() { throw new Error('kv down'); } });
  const before = rows('mesh-tasks').length;
  await assert.rejects(store.get('T-x'), /kv down/);
  const added = rows('mesh-tasks').slice(before);
  assert.deepEqual(added.map(r => [r.function, r.category]), [['get', 'error']]);
});
