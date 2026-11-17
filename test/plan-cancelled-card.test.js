#!/usr/bin/env node
/**
 * plan-cancelled-card.test.js — follow-up#13 (operator choice A).
 *
 * A local, soul or human plan subtask is reported back only through its kanban
 * card. A done card completed it; a cancelled card was never reported, so the
 * plan kept waiting on it and never completed. The bridge now reports a
 * cancelled card as a failed subtask, and the daemon's subtask.update applies
 * the failure as a failed mesh subtask does: dependents blocked, the failure
 * policy run, the plan completed when nothing is left.
 *
 * Run: node --test test/plan-cancelled-card.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-cancelled-card-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { PlanStore, subtaskReportForCard } = require('../lib/mesh-plans');
const { CollabStore } = require('../lib/mesh-collab');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

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
  const nc = { publish() {}, request: async () => { throw new Error('no agent on the test bus'); } };
  daemon.__test.setContext({ nc, store, planStore, collabStore });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, planStore, rpc };
}

const signed = (payload) => signOperatorRequest(payload, { identity: operator, nodeId: 'operator' });

describe('the bridge reports a cancelled subtask card', () => {
  it('as a failed subtask, and leaves a settled subtask alone', () => {
    const card = (status) => ({ task_id: 'P-L1', plan_id: 'PLAN-1', status });
    assert.deepEqual(subtaskReportForCard(card('cancelled'), { status: 'queued' }), {
      status: 'failed', result: { success: false, summary: 'Kanban card P-L1 cancelled' },
    });
    assert.equal(subtaskReportForCard(card('cancelled'), { status: 'blocked' }).status, 'failed', 'a human subtask waits as blocked');
    assert.equal(subtaskReportForCard(card('cancelled'), { status: 'failed' }), null);
    assert.equal(subtaskReportForCard(card('cancelled'), { status: 'completed' }), null);
    assert.equal(subtaskReportForCard(card('done'), { status: 'queued' }).status, 'completed');
    assert.equal(subtaskReportForCard(card('done'), { status: 'completed' }), null);
    assert.equal(subtaskReportForCard(card('in progress'), { status: 'queued' }), null);
    assert.equal(subtaskReportForCard(card('cancelled'), undefined), null);
  });
});

describe('a failed local subtask settles its plan', () => {
  it('blocks its dependents and completes the plan, failed', async () => {
    const h = harness();
    assert.equal((await h.rpc('handleSubmit', { task_id: 'PARENT', title: 'parent' })).ok, true);
    assert.equal((await h.rpc('handleClaim', { node_id: 'planner' })).data.task_id, 'PARENT');
    const created = await h.rpc('handlePlanCreate', {
      parent_task_id: 'PARENT', title: 'plan',
      subtasks: [
        { subtask_id: 'L1', title: 'first', delegation: { mode: 'local' } },
        { subtask_id: 'L2', title: 'second', delegation: { mode: 'local' }, depends_on: ['L1'] },
      ],
    });
    assert.equal(created.ok, true, created.error);
    const planId = created.data.plan_id;
    assert.equal((await h.rpc('handlePlanApprove', signed({ plan_id: planId }))).ok, true);
    const subtask = async (id) => (await h.planStore.get(planId)).subtasks.find((s) => s.subtask_id === id);
    assert.equal((await subtask('L1')).status, 'queued');
    assert.equal((await subtask('L2')).status, 'pending');

    const report = subtaskReportForCard({ task_id: 'L1', status: 'cancelled' }, await subtask('L1'));
    const reply = await h.rpc('handlePlanSubtaskUpdate', signed({ plan_id: planId, subtask_id: 'L1', ...report }));
    assert.equal(reply.ok, true, reply.error);

    assert.equal((await subtask('L1')).status, 'failed');
    assert.equal((await subtask('L2')).status, 'blocked', 'the dependent is blocked, not left pending');
    const plan = await h.planStore.get(planId);
    assert.equal(plan.status, 'completed', 'nothing is left to wait on');
    const parent = await h.store.get('PARENT');
    assert.equal(parent.result.success, false);
  });
});
