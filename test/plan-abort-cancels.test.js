#!/usr/bin/env node
/**
 * plan-abort-cancels.test.js — audit mesh-core~2#11, driven through the
 * daemon's REAL handlers (bin/mesh-task-daemon.js __test surface) over
 * in-memory KV.
 *
 * Aborting a plan, by hand or by its failure policy, only rewrote the plan
 * document. The mesh tasks it had dispatched stayed queued, claimed or
 * running, so workers still picked them up and merged their work. Every
 * non-terminal subtask mesh task must now be cancelled and its collab session
 * aborted; a running worker then stops at its next heartbeat.
 *
 * Run: node --test test/plan-abort-cancels.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-abort-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore, TASK_TERMINAL } = require('../lib/mesh-tasks');
const { PlanStore } = require('../lib/mesh-plans');
const { CollabStore } = require('../lib/mesh-collab');

const sc = StringCodec();

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
  const planStore = new PlanStore(new MockKV());
  const collabStore = new CollabStore(new MockKV());
  const published = [];
  const nc = {
    publish(subject) { published.push(subject); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ nc, store, planStore, collabStore });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, planStore, collabStore, published, rpc };
}

const signed = (payload) => signOperatorRequest(payload, { identity: operator, nodeId: 'operator' });

/**
 * An executing plan with three wave-0 subtasks: P-A (solo, claimed and running
 * on worker-a), P-B (solo, still queued) and P-C (collab, recruiting).
 */
async function planInFlight(h, failure_policy = 'continue_best_effort') {
  assert.equal((await h.rpc('handleSubmit', { task_id: 'PARENT', title: 'parent' })).ok, true);
  assert.equal((await h.rpc('handleClaim', { node_id: 'planner' })).data.task_id, 'PARENT');
  const created = await h.rpc('handlePlanCreate', {
    parent_task_id: 'PARENT', title: 'plan', failure_policy,
    subtasks: [
      { subtask_id: 'P-A', title: 'a', metric: 'npm test', delegation: { mode: 'solo_mesh' } },
      { subtask_id: 'P-B', title: 'b', metric: 'npm test', delegation: { mode: 'solo_mesh' } },
      { subtask_id: 'P-C', title: 'c', metric: 'npm test', delegation: { mode: 'collab_mesh', collaboration: { mode: 'parallel', min_nodes: 2 } } },
    ],
  });
  assert.equal(created.ok, true, created.error);
  const planId = created.data.plan_id;
  assert.equal((await h.rpc('handlePlanApprove', signed({ plan_id: planId }))).ok, true);

  const claim = await h.rpc('handleClaim', { node_id: 'worker-a' });
  assert.equal(claim.data.task_id, 'P-A');
  const worker = { task_id: 'P-A', node_id: 'worker-a', lease_token: claim.data.lease_token };
  assert.equal((await h.rpc('handleStart', worker)).ok, true);
  return { planId, worker, sid: (await h.store.get('P-C')).collab_session_id };
}

async function statuses(h) {
  const out = {};
  for (const id of ['P-A', 'P-B', 'P-C']) out[id] = (await h.store.get(id)).status;
  return out;
}

describe('aborting a plan stops the work it dispatched (mesh-core~2#11)', () => {
  it('a manual abort cancels every unfinished subtask task and its collab session', async () => {
    const h = harness();
    const { planId, worker, sid } = await planInFlight(h);

    const reply = await h.rpc('handlePlanAbort', signed({ plan_id: planId, reason: 'wrong approach' }));
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'aborted');

    assert.deepEqual(await statuses(h), { 'P-A': 'cancelled', 'P-B': 'cancelled', 'P-C': 'cancelled' });
    assert.match((await h.store.get('P-B')).result.summary, /aborted: wrong approach/);
    assert.equal((await h.collabStore.get(sid)).status, 'aborted');

    const claim = await h.rpc('handleClaim', { node_id: 'worker-b' });
    assert.equal(claim.data, null, 'no worker can pick up a subtask of an aborted plan');

    const beat = await h.rpc('handleHeartbeat', worker);
    assert.equal(beat.ok, false, 'the running worker learns at its next heartbeat');
    assert.equal(beat.code, TASK_TERMINAL);
  });

  it('a failure-policy abort cancels the sibling subtasks too', async () => {
    const h = harness();
    const { worker } = await planInFlight(h, 'abort_on_first_fail');
    const failed = await h.rpc('handleFail', { ...worker, reason: 'broke' });
    assert.equal(failed.ok, true, failed.error);
    assert.deepEqual(await statuses(h), { 'P-A': 'failed', 'P-B': 'cancelled', 'P-C': 'cancelled' });
  });

  it('an unsigned abort changes nothing', async () => {
    const h = harness();
    const { planId } = await planInFlight(h);
    const reply = await h.rpc('handlePlanAbort', { plan_id: planId });
    assert.equal(reply.ok, false);
    assert.deepEqual(await statuses(h), { 'P-A': 'running', 'P-B': 'queued', 'P-C': 'queued' });
  });
});
