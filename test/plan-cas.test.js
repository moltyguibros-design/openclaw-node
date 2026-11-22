#!/usr/bin/env node
/**
 * plan-cas.test.js — audit mesh-core~2#10, driven through the daemon's REAL
 * handlers (bin/mesh-task-daemon.js __test surface) over in-memory KV that
 * enforces revisions the way JetStream KV does.
 *
 * advancePlanWave, checkPlanProgress and updatePlanSubtaskStatus read the
 * plan, awaited other work, then wrote their stale copy back with a blind put.
 * Two subtasks finishing at once overwrote each other: a COMPLETED subtask went
 * back to queued, or a wave was dispatched twice. Every plan mutation now goes
 * through the store's compare-and-swap update.
 *
 * Run: node --test test/plan-cas.test.js
 */
const fs = require('node:fs');
const path = require('node:path');

const { tmpDir } = require('./helpers/tmp-dir.cjs');
const TMP = tmpDir('plan-cas-');
process.env.OPENCLAW_OBS_DB = ':memory:';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { PlanStore } = require('../lib/mesh-plans');
const { CollabStore } = require('../lib/mesh-collab');

const sc = StringCodec();

class RevisionKV {
  constructor() { this.store = new Map(); this.rev = 0; this.onPut = null; }
  async put(key, value) {
    if (this.onPut) await this.onPut(key);
    this.store.set(key, { value, revision: ++this.rev });
  }
  async update(key, value, expected) {
    const cur = this.store.get(key);
    if (cur && expected !== undefined && cur.revision !== expected) {
      throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
    }
    this.store.set(key, { value, revision: ++this.rev });
  }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function harness() {
  const taskKv = new RevisionKV();
  const store = new TaskStore(taskKv);
  const planStore = new PlanStore(new RevisionKV());
  const published = [];
  const nc = {
    publish(subject) { published.push(subject); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ nc, store, planStore, collabStore: new CollabStore(new RevisionKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, taskKv, planStore, published, rpc };
}

const signed = (payload) => signOperatorRequest(payload, { identity: operator, nodeId: 'operator' });

/** S1 and S2 in wave 0, S3 behind S1; S1 and S2 claimed by w1 and w2. */
async function plan(h) {
  assert.equal((await h.rpc('handleSubmit', { task_id: 'PARENT', title: 'parent' })).ok, true);
  assert.equal((await h.rpc('handleClaim', { node_id: 'planner' })).data.task_id, 'PARENT');
  const created = await h.rpc('handlePlanCreate', {
    parent_task_id: 'PARENT', title: 'plan', failure_policy: 'continue_best_effort',
    subtasks: [
      { subtask_id: 'S1', title: 's1', metric: 'npm test', delegation: { mode: 'solo_mesh' } },
      { subtask_id: 'S2', title: 's2', metric: 'npm test', delegation: { mode: 'solo_mesh' } },
      { subtask_id: 'S3', title: 's3', metric: 'npm test', depends_on: ['S1'], delegation: { mode: 'solo_mesh' } },
    ],
  });
  assert.equal(created.ok, true, created.error);
  assert.equal((await h.rpc('handlePlanApprove', signed({ plan_id: created.data.plan_id }))).ok, true);
  const owners = {};
  for (const node_id of ['w1', 'w2']) {
    const claim = await h.rpc('handleClaim', { node_id });
    // A dispatched subtask's task id is namespaced by its plan; key owners by subtask id.
    const subtaskId = claim.data.task_id.slice(created.data.plan_id.length + 1);
    owners[subtaskId] = { task_id: claim.data.task_id, node_id, lease_token: claim.data.lease_token };
  }
  return { planId: created.data.plan_id, owners };
}

async function subtasks(h, planId) {
  return Object.fromEntries((await h.planStore.get(planId)).subtasks.map((s) => [s.subtask_id, s.status]));
}

describe('plan updates are compare-and-swap (mesh-core~2#10)', () => {
  it('a subtask that completes while a wave is dispatching keeps its status', async () => {
    const h = harness();
    const { planId, owners } = await plan(h);

    // S1 completing dispatches S3; while that dispatch is writing S3's mesh
    // task, S2 completes on its own handler (they run concurrently in the daemon).
    let raced = false;
    h.taskKv.onPut = async (key) => {
      if (key !== `${planId}-S3` || raced) return;
      raced = true;
      const r = await h.rpc('handleComplete', { ...owners.S2, result: { success: true } });
      assert.equal(r.data.status, 'completed');
    };
    const r1 = await h.rpc('handleComplete', { ...owners.S1, result: { success: true } });
    assert.equal(r1.data.status, 'completed');
    assert.ok(raced, 'the race was exercised');

    assert.deepEqual(await subtasks(h, planId), { S1: 'completed', S2: 'completed', S3: 'queued' });
    assert.equal(h.published.filter((s) => s === 'mesh.events.submitted').length, 1 + 3, 'PARENT plus S1, S2, S3, each dispatched once');
  });

  it('the plan completes once all subtasks are done', async () => {
    const h = harness();
    const { planId, owners } = await plan(h);
    await h.rpc('handleComplete', { ...owners.S1, result: { success: true } });
    await h.rpc('handleComplete', { ...owners.S2, result: { success: true } });
    const claim = await h.rpc('handleClaim', { node_id: 'w3' });
    assert.equal(claim.data.task_id, `${planId}-S3`);
    await h.rpc('handleComplete', { task_id: `${planId}-S3`, node_id: 'w3', lease_token: claim.data.lease_token, result: { success: true } });
    assert.equal((await h.planStore.get(planId)).status, 'completed');
    assert.equal((await h.store.get('PARENT')).status, 'completed');
    assert.equal(h.published.filter((s) => s === 'mesh.events.plan.completed').length, 1);
  });
});
