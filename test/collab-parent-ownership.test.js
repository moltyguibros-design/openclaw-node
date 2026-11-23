#!/usr/bin/env node
/**
 * collab-parent-ownership.test.js — recruits join a collab session without
 * claiming its parent task. Before, the parent stayed queued for the whole
 * session: the next idle agent claimed it, its join was refused, and its
 * mesh.tasks.fail as owner aborted the live session; and with no claim the
 * task's budget never applied. At recruit close the session now owns the
 * parent (running, budget deadline, a lease no agent holds), the claim skips a
 * collab task whose session no longer takes members, and the budget, stall and
 * lease sweeps cover the session-owned parent.
 *
 * Real daemon handlers over KVs that enforce revisions, as JetStream does.
 * Run: node --test test/collab-parent-ownership.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-parent-'));
Object.assign(process.env, {
  HOME: TMP,
  OPENCLAW_WORKSPACE: path.join(TMP, 'ws'),
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_NODE_ID: 'lead',
  OPENCLAW_LOG_LEVEL: 'error',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore, TASK_STATUS, isSessionOwner } = require('../lib/mesh-tasks');
const { CollabStore, COLLAB_STATUS } = require('../lib/mesh-collab');
const { PlanStore } = require('../lib/mesh-plans');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

class RevKV {
  constructor() { this.m = new Map(); this.seq = 0; }
  async put(key, value, opts = {}) {
    const cur = this.m.get(key);
    if (opts.previousSeq !== undefined && (cur ? cur.revision : 0) !== opts.previousSeq) {
      throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
    }
    const revision = ++this.seq;
    this.m.set(key, { key, value, revision });
    return revision;
  }
  async update(key, value, revision) {
    const cur = this.m.get(key);
    if (!cur || cur.revision !== revision) throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
    return this.put(key, value);
  }
  async get(key) { return this.m.get(key) || null; }
  async delete(key) { this.m.delete(key); }
  async keys() { const ks = [...this.m.keys()]; return (async function* () { yield* ks; })(); }
  async purgeDeletes() {}
}

function harness() {
  const store = new TaskStore(new RevKV());
  const collabStore = new CollabStore(new RevKV());
  const planStore = new PlanStore(new RevKV());
  const published = [];
  const asked = [];
  const nc = {
    publish(subject) { published.push(subject); },
    async request(subject) { asked.push(subject); throw new Error('no agent'); },
  };
  daemon.__test.setContext({ nc, store, collabStore, planStore });
  const rpc = async (handler, payload) => {
    let reply;
    await daemon.__test[handler]({ data: sc.encode(JSON.stringify(payload)), respond(d) { reply = JSON.parse(sc.decode(d)); } });
    return reply;
  };
  return { store, collabStore, rpc, published, asked };
}

async function recruited(h, id, collab = { mode: 'parallel', min_nodes: 2, max_nodes: 2 }) {
  await h.rpc('handleSubmit', { task_id: id, title: 'collab work', collaboration: collab, budget_minutes: 20 });
  const sid = (await h.store.get(id)).collab_session_id;
  return sid;
}

describe('collab parent ownership at recruit close', () => {
  it('recruits fill the session: the session owns the parent, an idle claimer gets nothing, and the session stays live', async () => {
    const h = harness();
    const sid = await recruited(h, 'T-own');
    assert.equal((await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R1' })).ok, true);
    assert.equal((await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R2' })).ok, true);

    const parent = await h.store.get('T-own');
    assert.equal(parent.status, TASK_STATUS.RUNNING);
    assert.equal(parent.owner, `collab:${sid}`);
    assert.ok(isSessionOwner(parent.owner));
    assert.ok(parent.lease_token, 'a lease no agent holds fences every owner call');
    const budgetMs = Date.parse(parent.budget_deadline) - Date.parse(parent.claimed_at);
    assert.equal(budgetMs, 20 * 60 * 1000);

    const claim = await h.rpc('handleClaim', { node_id: 'C' });
    assert.equal(claim.ok, true);
    assert.equal(claim.data, null, 'nothing to claim: the parent is the session\'s');

    const join = await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'C' });
    assert.equal(join.ok, false);
    const fail = await h.rpc('handleFail', { task_id: 'T-own', node_id: 'C', reason: 'Failed to join' });
    assert.equal(fail.ok, false, 'a non-member cannot fail the session-owned parent');
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ACTIVE);
    assert.equal((await h.store.get('T-own')).status, TASK_STATUS.RUNNING);
  });

  it('a claim is not offered a parent whose session is full or closed, and is while it still recruits', async () => {
    const h = harness();
    const sid = await recruited(h, 'T-open', { mode: 'parallel', min_nodes: 2, max_nodes: 3 });
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R1' });
    const claim = await h.rpc('handleClaim', { node_id: 'C' });
    assert.equal(claim.data?.task_id, 'T-open', 'a recruiting session still takes the claimer as a member');
    assert.equal((await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'C' })).ok, true);
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R2' });
    const parent = await h.store.get('T-open');
    assert.equal(parent.owner, 'C', 'a member that claimed the parent keeps it');
    assert.equal(parent.lease_token, claim.data.lease_token);
  });

  it('a claim made just before the session filled is taken over at recruit close; the refused claimer can no longer fail it', async () => {
    const h = harness();
    const sid = await recruited(h, 'T-race');
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R1' });
    const claim = await h.rpc('handleClaim', { node_id: 'C' });
    assert.equal(claim.data?.task_id, 'T-race');
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R2' });
    const parent = await h.store.get('T-race');
    assert.equal(parent.owner, `collab:${sid}`);
    assert.notEqual(parent.lease_token, claim.data.lease_token);
    assert.equal((await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'C' })).ok, false);
    const fail = await h.rpc('handleFail', { task_id: 'T-race', node_id: 'C', lease_token: claim.data.lease_token, reason: 'refused join' });
    assert.equal(fail.ok, false);
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ACTIVE);
  });

  it('a recruited session past its parent\'s budget is failed by the budget sweep, and every member is told to stop', async () => {
    const h = harness();
    const sid = await recruited(h, 'T-budget');
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R1' });
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R2' });
    await h.store._updateWithCAS('T-budget', (t) => { t.budget_deadline = new Date(Date.now() - 1000).toISOString(); return t; });
    h.published.length = 0;
    await daemon.__test.enforceBudgets();
    assert.equal((await h.store.get('T-budget')).status, TASK_STATUS.FAILED);
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ABORTED);
    const stops = h.published.filter((s) => s.endsWith('.budget_exceeded')).sort();
    assert.deepEqual(stops, ['mesh.agent.R1.budget_exceeded', 'mesh.agent.R2.budget_exceeded']);
  });

  it('the stall sweep keeps a session-owned parent while its session is live and releases it once the session is gone', async () => {
    const h = harness();
    const sid = await recruited(h, 'T-stall');
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R1' });
    await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'R2' });
    const quiet = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await h.store._updateWithCAS('T-stall', (t) => { t.last_activity = quiet; return t; });
    await daemon.__test.detectStalls();
    const kept = await h.store.get('T-stall');
    assert.equal(kept.status, TASK_STATUS.RUNNING);
    assert.ok(Date.parse(kept.last_activity) > Date.parse(quiet), 'its activity was renewed');
    assert.ok(!h.asked.some((s) => s.includes('collab:')), 'no alive check to a session marker');

    await h.collabStore.markAborted(sid, 'members gone');
    await h.store._updateWithCAS('T-stall', (t) => { t.last_activity = quiet; return t; });
    await daemon.__test.detectStalls();
    assert.equal((await h.store.get('T-stall')).status, TASK_STATUS.RELEASED);
  });
});
