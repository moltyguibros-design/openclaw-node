#!/usr/bin/env node
/**
 * plan-auto-approve.test.js — audit mesh-core~2#12 (operator option A), driven
 * through the daemon's REAL handlePlanCreate over in-memory KV.
 *
 * createPlan stored requires_approval, but handlePlanCreate never read it: every
 * plan stayed a draft until the signed mesh.plans.approve, while the bridge put
 * "Auto-executing." on the card and `mesh plan show` printed "Approval: auto".
 * mesh.plans.create is open to any bus peer, so the field is now honoured only
 * on an operator-signed create; an unsigned one is stored as a draft that
 * requires approval.
 *
 * Run: node --test test/plan-auto-approve.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-auto-approve-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
const stranger = getOrCreateIdentity(path.join(TMP, 'stranger'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { PlanStore } = require('../lib/mesh-plans');
const { CollabStore } = require('../lib/mesh-collab');

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

async function harness() {
  const store = new TaskStore(new MockKV());
  const planStore = new PlanStore(new MockKV());
  const events = [];
  const nc = {
    publish(subject, data) { events.push(subject); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ nc, store, planStore, collabStore: new CollabStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  assert.equal((await rpc('handleSubmit', { task_id: 'PARENT', title: 'parent' })).ok, true);
  return { store, planStore, events, rpc };
}

const planRequest = (extra = {}) => ({
  parent_task_id: 'PARENT', title: 'plan',
  subtasks: [{ subtask_id: 'P-S1', title: 's1', metric: 'npm test', delegation: { mode: 'solo_mesh' } }],
  ...extra,
});

describe('requires_approval:false', () => {
  it('on an operator-signed create: the plan is approved and wave 0 dispatched', async () => {
    const h = await harness();
    const r = await h.rpc('handlePlanCreate', signOperatorRequest(planRequest({ requires_approval: false }), { identity: operator, nodeId: 'operator' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.status, 'executing');
    assert.equal(r.data.requires_approval, false);
    assert.match(r.data.approved_by, /operator/);
    assert.equal(r.data.subtasks[0].status, 'queued');
    const task = await h.store.get(`${r.data.plan_id}-P-S1`);
    assert.ok(task, 'the subtask was dispatched as a mesh task');
    assert.ok(h.events.includes('mesh.events.plan.approved'));
    assert.equal(r.data.node_id, undefined, 'the signing envelope is not stored on the plan');
  });

  it('on an unsigned create: stored as a draft that requires approval', async () => {
    const h = await harness();
    const r = await h.rpc('handlePlanCreate', planRequest({ requires_approval: false }));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.status, 'draft');
    assert.equal(r.data.requires_approval, true, 'the card and the CLI then say it awaits approval');
    assert.equal(await h.store.get(`${r.data.plan_id}-P-S1`), null);
  });

  it('signed by a key that is not an operator key: a draft', async () => {
    const h = await harness();
    const r = await h.rpc('handlePlanCreate', signOperatorRequest(planRequest({ requires_approval: false }), { identity: stranger, nodeId: 'stranger' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.status, 'draft');
    assert.equal(r.data.requires_approval, true);
  });

  it('a signed create that asks for approval still waits for it', async () => {
    const h = await harness();
    const r = await h.rpc('handlePlanCreate', signOperatorRequest(planRequest(), { identity: operator, nodeId: 'operator' }));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.data.status, 'draft');
    assert.equal(r.data.requires_approval, true);
  });
});
