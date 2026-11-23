#!/usr/bin/env node
/**
 * daemon-operator-complete.test.js — audit mc-api#1 (operator option B),
 * driven through the REAL handleComplete over in-memory KV.
 *
 * Mission Control's "force converge" sends a signed operator mesh.tasks.complete.
 * The daemon auto-computed a review for every caller, so a collab task without a
 * metric (the dispatch form's default) parked in pending_review while MC showed
 * it done, and its plan wave never advanced. A signed operator force-complete is
 * now the review; an owner completion still goes through the auto-computed gate.
 *
 * Run: node --test test/daemon-operator-complete.test.js
 */
const path = require('node:path');

const { tmpDir } = require('./helpers/tmp-dir.cjs');
const TMP = tmpDir('operator-complete-');
process.env.OPENCLAW_OBS_DB = ':memory:';
process.env.HOME = TMP;

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { CollabStore } = require('../lib/mesh-collab');
const { PlanStore } = require('../lib/mesh-plans');

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
  const events = [];
  const store = new TaskStore(new MockKV());
  const nc = {
    publish(subject) { events.push(subject); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ nc, store, collabStore: new CollabStore(new MockKV()), planStore: new PlanStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { events, rpc };
}

const asOperator = (payload) => signOperatorRequest(payload, { identity: operator, nodeId: 'operator' });

describe('a signed operator force-complete is the review (mc-api#1)', () => {
  it('completes a collab task that has no metric and publishes completed', async () => {
    const h = harness();
    const submit = await h.rpc('handleSubmit', {
      task_id: 'T-collab', title: 'pair on it',
      collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 2, convergence: { type: 'unanimous' } },
    });
    assert.equal(submit.ok, true, submit.error);
    const reply = await h.rpc('handleComplete', asOperator({ task_id: 'T-collab', result: { success: true, summary: 'Force-converged by operator' } }));
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'completed');
    assert.ok(h.events.includes('mesh.events.completed'));
    assert.ok(!h.events.includes('mesh.events.pending_review'));
  });

  it('completes a solo task that has no metric', async () => {
    const h = harness();
    await h.rpc('handleSubmit', { task_id: 'T-solo', title: 'write it' });
    await h.rpc('handleClaim', { node_id: 'worker' });
    const reply = await h.rpc('handleComplete', asOperator({ task_id: 'T-solo', result: { success: true } }));
    assert.equal(reply.data.status, 'completed');
  });

  it('an owner completion without a metric still goes to review', async () => {
    const h = harness();
    await h.rpc('handleSubmit', { task_id: 'T-owner', title: 'write it' });
    const claim = await h.rpc('handleClaim', { node_id: 'worker' });
    const reply = await h.rpc('handleComplete', {
      task_id: 'T-owner', node_id: 'worker', lease_token: claim.data.lease_token, result: { success: true },
    });
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'pending_review');
    assert.ok(h.events.includes('mesh.events.pending_review'));
  });
});
