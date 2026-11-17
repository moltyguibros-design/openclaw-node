#!/usr/bin/env node
/**
 * daemon-role-escalation.test.js — audit mesh-core~2#7, driven through the
 * daemon's REAL handlers over in-memory KV.
 *
 * A role's escalation map (on_metric_failure, on_budget_exceeded) was read only
 * in handleFail, which agents call for setup failures (worktree isolation,
 * collab discovery). So a missing worktree spawned an ESC task to another role
 * with 1.5x the budget, labelled on_metric_failure, while metric exhaustion
 * (a release) and the budget enforcer (a direct markFailed) never escalated.
 *
 * Uses config/roles/solidity-dev.yaml: on_metric_failure → qa-engineer,
 * on_budget_exceeded → tech-architect.
 *
 * Run: node --test test/daemon-role-escalation.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'role-escalation-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { CollabStore } = require('../lib/mesh-collab');
const { PlanStore } = require('../lib/mesh-plans');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function harness() {
  const store = new TaskStore(new MockKV());
  const nc = { publish() {}, request: async () => { throw new Error('no agent on the test bus'); } };
  daemon.__test.setContext({ nc, store, collabStore: new CollabStore(new MockKV()), planStore: new PlanStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  const escalations = async () => (await store.list()).filter(t => t.task_id.startsWith('ESC-'));
  return { store, rpc, escalations };
}

async function claimed(h, id = 'SOL-1') {
  const sub = await h.rpc('handleSubmit', { task_id: id, title: 'token', role: 'solidity-dev', metric: 'npm test', budget_minutes: 10 });
  assert.equal(sub.ok, true, sub.error);
  const claim = await h.rpc('handleClaim', { node_id: 'worker' });
  assert.equal(claim.data.task_id, id);
  return { task_id: id, node_id: 'worker', lease_token: claim.data.lease_token };
}

describe('role escalation fires on its named triggers only', () => {
  it('a setup failure (worktree isolation) does not escalate', async () => {
    const h = harness();
    const owner = await claimed(h);
    const r = await h.rpc('handleFail', { ...owner, reason: 'Worktree isolation failed for SOL-1 (fail-closed)' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.status, 'failed');
    assert.deepEqual(await h.escalations(), []);
  });

  it('a release after the metric failed on every attempt escalates on_metric_failure', async () => {
    const h = harness();
    const owner = await claimed(h);
    const r = await h.rpc('handleRelease', { ...owner, reason: 'Exhausted 3/3 attempts', metric_exhausted: true });
    assert.equal(r.ok, true, r.error);
    const [esc] = await h.escalations();
    assert.ok(esc, 'an escalation task was created');
    assert.equal(esc.role, 'qa-engineer');
    assert.equal(esc.budget_minutes, 15);
    assert.match(esc.description, /failure: on_metric_failure/);
  });

  it('a release without metric exhaustion (Foreman escalation, pre-check) does not escalate', async () => {
    const h = harness();
    const owner = await claimed(h);
    const r = await h.rpc('handleRelease', { ...owner, reason: 'Foreman escalated: looping. Exhausted 1/3 attempts' });
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(await h.escalations(), []);
  });

  it('the budget enforcer escalates on_budget_exceeded', async () => {
    const h = harness();
    await claimed(h);
    await h.store._updateWithCAS('SOL-1', (t) => ({ ...t, budget_deadline: new Date(Date.now() - 60_000).toISOString() }));
    await daemon.__test.enforceBudgets();
    assert.equal((await h.store.get('SOL-1')).status, 'failed');
    const [esc] = await h.escalations();
    assert.ok(esc, 'an escalation task was created');
    assert.equal(esc.role, 'tech-architect');
    assert.match(esc.description, /failure: on_budget_exceeded/);
  });
});
