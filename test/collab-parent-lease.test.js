#!/usr/bin/env node
/**
 * collab-parent-lease.test.js — a collab parent task's lease while its session
 * runs, driven through the daemon's REAL handlers over in-memory KV.
 *
 * The owner sends mesh.tasks.heartbeat only while its own worker runs. Between
 * rounds nothing renewed the parent's lease, and the reaper re-queued a task
 * whose grappe was still converging; the session then completed a task that
 * had already moved, and the daemon announced 'completed' anyway.
 *
 * Run: node --test test/collab-parent-lease.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-lease-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { CollabStore, issueMemberToken } = require('../lib/mesh-collab');
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
  const collabStore = new CollabStore(new MockKV());
  const events = [];
  const nc = {
    publish(subject, data) { events.push({ subject, body: JSON.parse(sc.decode(data)) }); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ nc, store, collabStore, planStore: new PlanStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, collabStore, events, rpc };
}

const PAST = new Date(Date.now() - 60_000).toISOString();
const expireLease = (h, id) => h.store._updateWithCAS(id, (t) => ({ ...t, lease_expires_at: PAST }));

/** A parallel collab task claimed by 'owner'; returns its session id. */
async function claimedCollab(h, id = 'C-1') {
  const sub = await h.rpc('handleSubmit', {
    task_id: id, title: 'grappe',
    collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 3, join_window_s: 30, max_rounds: 2, convergence: { type: 'majority' } },
  });
  assert.equal(sub.ok, true, sub.error);
  assert.equal((await h.rpc('handleClaim', { node_id: 'owner' })).data.task_id, id);
  return (await h.store.get(id)).collab_session_id;
}

describe('the daemon renews a collab parent lease on session events', () => {
  it('a join renews it', async () => {
    const h = harness();
    const sid = await claimedCollab(h);
    await expireLease(h, 'C-1');
    assert.equal((await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'a' })).ok, true);
    assert.ok(Date.parse((await h.store.get('C-1')).lease_expires_at) > Date.now());
  });

  it('a reflection renews it', async () => {
    const h = harness();
    const sid = await claimedCollab(h);
    const { token, hash } = issueMemberToken();
    await h.collabStore.addNode(sid, 'a', 'worker', '*', { tokenHash: hash });
    await h.collabStore.addNode(sid, 'b');
    await h.collabStore.startRound(sid);
    await expireLease(h, 'C-1');
    const r = await h.rpc('handleCollabReflect', { session_id: sid, node_id: 'a', member_token: token, summary: 's', vote: 'continue', confidence: 0.5 });
    assert.equal(r.ok, true, r.error);
    assert.ok(Date.parse((await h.store.get('C-1')).lease_expires_at) > Date.now());
  });
});

describe('the lease reaper spares a parent whose session is live', () => {
  for (const status of ['recruiting', 'active']) {
    it(`an expired lease under a ${status} session is not re-queued`, async () => {
      const h = harness();
      const sid = await claimedCollab(h);
      if (status === 'active') {
        await h.collabStore.addNode(sid, 'a');
        await h.collabStore.addNode(sid, 'b');
        await h.collabStore.startRound(sid);
      }
      assert.equal((await h.collabStore.get(sid)).status, status);
      await expireLease(h, 'C-1');
      await daemon.__test.detectStalls();
      const t = await h.store.get('C-1');
      assert.equal(t.status, 'claimed');
      assert.equal(t.owner, 'owner');
      assert.ok(!h.events.some(e => e.subject === 'mesh.events.requeued'));
    });
  }

  it('an expired lease is still re-queued once the session has ended', async () => {
    const h = harness();
    const sid = await claimedCollab(h);
    await h.collabStore.markAborted(sid, 'test');
    await expireLease(h, 'C-1');
    await daemon.__test.detectStalls();
    assert.equal((await h.store.get('C-1')).status, 'queued');
  });
});

describe("a session that ends a parent already ended announces nothing", () => {
  it("converging after the parent was released publishes no 'completed'", async () => {
    const h = harness();
    const sid = await claimedCollab(h);
    await h.collabStore.addNode(sid, 'a');
    await h.collabStore.addNode(sid, 'b');
    await h.collabStore.startRound(sid);
    for (const node_id of ['a', 'b']) {
      assert.ok(await h.collabStore.submitReflection(sid, { node_id, summary: 'done', vote: 'converged', confidence: 0.9 }));
    }
    await h.store.markReleased('C-1', 'lease expired', []);
    h.events.length = 0;
    await daemon.__test.evaluateRound(sid);
    assert.equal((await h.store.get('C-1')).status, 'released');
    assert.ok(!h.events.some(e => e.subject === 'mesh.events.completed'),
      `unexpected: ${h.events.map(e => e.subject).join(', ')}`);
  });
});

// Audit mesh-core~2#17: every terminal path for a collab parent ends its session
// the same way (cleanupTaskCollabSession): aborted, audited and announced on
// mesh.events.collab.aborted, which Mission Control and the bridge consume.
describe('a parent the daemon ends takes its session down with it', () => {
  async function activeSession(h) {
    const sid = await claimedCollab(h);
    await h.collabStore.addNode(sid, 'a');
    await h.collabStore.addNode(sid, 'b');
    await h.collabStore.startRound(sid);
    h.events.length = 0;
    return sid;
  }
  async function assertAborted(h, sid, reason) {
    const session = await h.collabStore.get(sid);
    assert.equal(session.status, 'aborted');
    assert.match(session.result.summary, reason);
    assert.ok(session.audit_log.some(e => e.event === 'session_aborted'), 'the abort is audited');
    assert.ok(h.events.some(e => e.subject === 'mesh.events.collab.aborted' && e.body.session_id === sid),
      `no collab.aborted event: ${h.events.map(e => e.subject).join(', ')}`);
  }

  it('the budget enforcer', async () => {
    const h = harness();
    const sid = await activeSession(h);
    await h.store._updateWithCAS('C-1', (t) => ({ ...t, budget_deadline: PAST }));
    await daemon.__test.enforceBudgets();
    assert.equal((await h.store.get('C-1')).status, 'failed');
    await assertAborted(h, sid, /Budget exceeded/);
  });

  it('the stall detector', async () => {
    const h = harness();
    const sid = await activeSession(h);
    const silent = new Date(Date.now() - 60 * 60_000).toISOString();
    await h.store._updateWithCAS('C-1', (t) => ({ ...t, last_activity: silent }));
    await daemon.__test.detectStalls();
    assert.equal((await h.store.get('C-1')).status, 'released');
    await assertAborted(h, sid, /Stall detected/);
  });

  it('the lease reaper, once the session is no longer live', async () => {
    const h = harness();
    const sid = await activeSession(h);
    await h.collabStore._updateWithCAS(sid, (s) => ({ ...s, status: 'converged' }));
    await h.store._updateWithCAS('C-1', (t) => ({ ...t, lease_requeues: 2 }));
    await expireLease(h, 'C-1');
    await daemon.__test.detectStalls();
    assert.equal((await h.store.get('C-1')).status, 'released');
    await assertAborted(h, sid, /Lease expired/);
  });
});
