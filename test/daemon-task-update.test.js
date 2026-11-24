#!/usr/bin/env node
/**
 * daemon-task-update.test.js — mesh.tasks.update and the submit overwrite guard, driven
 * through the daemon's REAL handlers over in-memory KV (mission-control-app~2#6).
 *
 * Mission Control's PATCH /api/mesh/tasks/:id merged any body field into MESH_TASKS KV
 * (status, owner, requires_review, plan_id), and its POST overwrote an existing task_id.
 * Both now go through the daemon: submit refuses an existing id with a code, and update
 * takes only a signed operator's edit of the editable fields of a live task.
 *
 * Run: node --test test/daemon-task-update.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'task-update-'));
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
const { TaskStore, EDITABLE_TASK_FIELDS } = require('../lib/mesh-tasks');
const { CollabStore } = require('../lib/mesh-collab');
const { PlanStore } = require('../lib/mesh-plans');

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
  const events = [];
  const nc = { publish(subject) { events.push(subject); }, request: async () => { throw new Error('no agent'); } };
  daemon.__test.setContext({ nc, store, collabStore: new CollabStore(new MockKV()), planStore: new PlanStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, events, rpc };
}

const signed = (payload, identity = operator) => signOperatorRequest(payload, { identity, nodeId: 'lead' });

async function submitted(h, id = 'T-1') {
  const reply = await h.rpc('handleSubmit', { task_id: id, title: 'first title', priority: 1 });
  assert.equal(reply.ok, true, reply.error);
  return reply.data;
}

describe('mesh.tasks.submit', () => {
  it('refuses an existing task_id with TASK_EXISTS and leaves the task as it was', async () => {
    const h = harness();
    const original = await submitted(h);
    const reply = await h.rpc('handleSubmit', { task_id: 'T-1', title: 'overwrite' });
    assert.equal(reply.ok, false);
    assert.equal(reply.code, 'TASK_EXISTS');
    assert.deepEqual(await h.store.get('T-1'), original);
  });
});

describe('mesh.tasks.update', () => {
  it('applies a signed operator edit of the editable fields and publishes it', async () => {
    const h = harness();
    await submitted(h);
    const reply = await h.rpc('handleUpdate', signed({ task_id: 'T-1', title: 'renamed', priority: 5, tags: ['ops'] }));
    assert.equal(reply.ok, true, reply.error);
    const task = await h.store.get('T-1');
    assert.equal(task.title, 'renamed');
    assert.equal(task.priority, 5);
    assert.deepEqual(task.tags, ['ops']);
    assert.equal(task.status, 'queued');
    for (const envelope of ['signature', 'signer_pubkey', 'operator_action', 'event_id', 'node_id']) {
      assert.equal(task[envelope], undefined, `${envelope} is not stored on the task`);
    }
    assert.ok(h.events.includes('mesh.events.updated'));
  });

  it('refuses an unsigned edit and one signed by an untrusted key', async () => {
    const h = harness();
    const before = await submitted(h);
    for (const payload of [{ task_id: 'T-1', title: 'x' }, signed({ task_id: 'T-1', title: 'x' }, stranger)]) {
      const reply = await h.rpc('handleUpdate', payload);
      assert.equal(reply.ok, false);
      assert.match(reply.error, /update refused/);
    }
    assert.deepEqual(await h.store.get('T-1'), before);
  });

  it('refuses daemon-owned fields, even signed, and changes nothing', async () => {
    const h = harness();
    const before = await submitted(h);
    for (const field of [{ status: 'completed' }, { owner: 'me' }, { lease_token: 'forged' }, { requires_review: false }, { plan_id: 'P-1' }, { result: { success: true } }, { metric: 'npm test' }]) {
      const reply = await h.rpc('handleUpdate', signed({ task_id: 'T-1', title: 'renamed', ...field }));
      assert.equal(reply.ok, false, JSON.stringify(field));
      assert.equal(reply.code, 'INVALID_UPDATE');
    }
    assert.deepEqual(await h.store.get('T-1'), before);
  });

  it('refuses malformed values and an empty edit', async () => {
    const h = harness();
    await submitted(h);
    for (const edit of [{ title: '' }, { priority: 'high' }, { budget_minutes: -1 }, { tags: 'ops' }, { preferred_nodes: 'n1' }, { success_criteria: [1] }, {}]) {
      const reply = await h.rpc('handleUpdate', signed({ task_id: 'T-1', ...edit }));
      assert.equal(reply.code, 'INVALID_UPDATE', JSON.stringify(edit));
    }
  });

  it('answers TASK_NOT_FOUND for a missing task and TASK_TERMINAL for one that ended', async () => {
    const h = harness();
    assert.equal((await h.rpc('handleUpdate', signed({ task_id: 'nope', title: 'x' }))).code, 'TASK_NOT_FOUND');
    await submitted(h);
    await h.store.markCancelled('T-1', 'stop');
    const reply = await h.rpc('handleUpdate', signed({ task_id: 'T-1', title: 'x' }));
    assert.equal(reply.code, 'TASK_TERMINAL');
    assert.equal((await h.store.get('T-1')).title, 'first title');
  });
});

// mission-control-app#19 part 2 and mission-control-app~2#6: one list of editable
// fields, used by the daemon's RPC (Mission Control's PATCH) and TaskStore.updateFields.
describe('the editable fields are one list', () => {
  it('is the union both audits named', () => {
    assert.deepEqual([...EDITABLE_TASK_FIELDS].sort(), [
      'budget_minutes', 'description', 'exclude_nodes', 'preferred_nodes', 'priority',
      'scope', 'success_criteria', 'tags', 'title',
    ]);
  });

  it('a signed edit of the routing and criteria fields applies', async () => {
    const h = harness();
    await submitted(h);
    const edit = { success_criteria: ['tests pass'], preferred_nodes: ['n1'], exclude_nodes: ['n2'] };
    const reply = await h.rpc('handleUpdate', signed({ task_id: 'T-1', ...edit }));
    assert.equal(reply.ok, true, reply.error);
    const task = await h.store.get('T-1');
    for (const [k, v] of Object.entries(edit)) assert.deepEqual(task[k], v);
  });

  it('TaskStore.updateFields refuses any other field, whole', async () => {
    const h = harness();
    const before = await submitted(h);
    await assert.rejects(h.store.updateFields('T-1', { title: 'ok', status: 'completed' }), /Not editable: status/);
    assert.deepEqual(await h.store.get('T-1'), before);
  });
});
