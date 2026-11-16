#!/usr/bin/env node
/**
 * collab-max-rounds-review.test.js — audit mesh-core#16, driven through the
 * daemon's REAL handlers (bin/mesh-task-daemon.js __test surface) over
 * in-memory KV.
 *
 * A collab session that ran out of rounds without converging used to mark its
 * parent task `completed`, and every member then merged its contribution into
 * main with no human review. The parent must now wait in pending_review with a
 * digest of why the members are not done, every member must hear the review
 * outcome, and a rejection must re-queue the task with a fresh session.
 *
 * Run: node --test test/collab-max-rounds-review.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-max-rounds-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

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
  const published = [];
  const nc = {
    publish(subject, data) { published.push({ subject, body: JSON.parse(sc.decode(data)) }); },
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
  return { store, collabStore, published, rpc };
}

const signed = (payload) => signOperatorRequest(payload, { identity: operator, nodeId: 'operator' });

/** A parallel collab task with max_rounds 1 whose only round ends without convergence. */
async function maxedOutSession(h) {
  const sub = await h.rpc('handleSubmit', {
    task_id: 'C-1', title: 'collab work',
    collaboration: { mode: 'parallel', min_nodes: 2, max_rounds: 1 },
  });
  assert.equal(sub.ok, true, sub.error);
  const claim = await h.rpc('handleClaim', { node_id: 'a' });
  assert.equal(claim.data.task_id, 'C-1');
  await h.store.markRunning('C-1');
  const sid = (await h.store.get('C-1')).collab_session_id;
  await h.collabStore.addNode(sid, 'a');
  await h.collabStore.addNode(sid, 'b');
  await h.collabStore.addNode(sid, 'c');
  await h.collabStore.startRound(sid);
  await h.collabStore.submitReflection(sid, { node_id: 'a', summary: 'the reset path still races', learnings: 'needs a lock', vote: 'continue', confidence: 0.4, artifacts: ['lib/a.js'] });
  await h.collabStore.submitReflection(sid, { node_id: 'b', summary: 'my half is done', vote: 'converged', confidence: 0.9, artifacts: [] });
  await daemon.__test.evaluateRound(sid);
  return sid;
}

describe('collab max rounds without convergence (mesh-core#16)', () => {
  it('holds the parent in pending_review instead of completing it', async () => {
    const h = harness();
    const sid = await maxedOutSession(h);
    const task = await h.store.get('C-1');
    assert.equal(task.status, 'pending_review');
    assert.equal(task.result.max_rounds_reached, true);
    assert.equal(task.result.needs_review, true);
    assert.ok(!h.published.some((p) => p.subject === 'mesh.events.completed'), 'no completed event for an unconverged session');
    assert.ok(h.published.some((p) => p.subject === 'mesh.events.pending_review'));

    const session = await h.collabStore.get(sid);
    assert.equal(session.status, 'completed');
    assert.equal(session.result.needs_review, true, 'agents read needs_review to keep their branches unmerged');
    assert.equal(h.collabStore.getSummary(session).needs_review, true);
  });

  it('carries a digest of why the members are not done', async () => {
    const h = harness();
    await maxedOutSession(h);
    const { review_digest: digest, summary } = (await h.store.get('C-1')).result;
    assert.equal(digest.rounds, 1);
    assert.equal(digest.max_rounds, 1);
    assert.equal(digest.converged_votes, 1);
    assert.deepEqual(digest.members.map((m) => [m.node_id, m.vote]), [['a', 'continue'], ['b', 'converged']]);
    assert.deepEqual(digest.silent, ['c']);
    assert.match(digest.text, /a voted continue, confidence 0\.4: the reset path still races Learnings: needs a lock/);
    assert.match(digest.text, /c sent no reflection in the final round/);
    assert.match(summary, /without convergence; needs review/);
  });

  it('a signed approve completes it and tells every member, not only the claimer', async () => {
    const h = harness();
    await maxedOutSession(h);
    const reply = await h.rpc('handleTaskApprove', signed({ task_id: 'C-1' }));
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'completed');
    const told = h.published.filter((p) => p.subject.startsWith('mesh.agent.') && p.subject.endsWith('.approved')).map((p) => p.subject).sort();
    assert.deepEqual(told, ['mesh.agent.a.approved', 'mesh.agent.b.approved', 'mesh.agent.c.approved']);
  });

  it('a signed reject tells every member and re-queues the task with a fresh session', async () => {
    const h = harness();
    const sid = await maxedOutSession(h);
    const reply = await h.rpc('handleTaskReject', signed({ task_id: 'C-1', reason: 'still racy' }));
    assert.equal(reply.ok, true, reply.error);
    const told = h.published.filter((p) => p.subject.startsWith('mesh.agent.') && p.subject.endsWith('.rejected')).map((p) => p.subject).sort();
    assert.deepEqual(told, ['mesh.agent.a.rejected', 'mesh.agent.b.rejected', 'mesh.agent.c.rejected']);

    const task = await h.store.get('C-1');
    assert.equal(task.status, 'queued');
    assert.notEqual(task.collab_session_id, sid);
    const fresh = await h.collabStore.get(task.collab_session_id);
    assert.equal(fresh.status, 'recruiting');
    assert.equal(fresh.mode, 'parallel');
    assert.ok(h.published.some((p) => p.subject === `mesh.collab.${fresh.session_id}.recruit`));
  });
});
