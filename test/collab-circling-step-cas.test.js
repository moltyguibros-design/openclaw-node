#!/usr/bin/env node
/**
 * collab-circling-step-cas.test.js — a circling step start used to read the
 * session, renew the parent lease, then write that snapshot back with a blind
 * put. A cancel landing during the lease renewal was undone: the session went
 * back to active and the members got the next step's prompts for a task that
 * had already ended. storeArtifact's last attempt did the same blind put.
 *
 * Driven through the daemon's REAL startCirclingStep over a KV that enforces
 * revisions, as JetStream does.
 *
 * Run: node --test test/collab-circling-step-cas.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'circling-step-cas-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');

const { describe, it, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');

const daemon = require('../bin/mesh-task-daemon.js');
const { CollabStore, COLLAB_MODE, createSession } = require('../lib/mesh-collab');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

function revisionKV() {
  const store = new Map();
  let seq = 0;
  const puts = [];
  return {
    puts,
    store,
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) { puts.push(key); store.set(key, { value, revision: ++seq }); return seq; },
    async update(key, value, revision) {
      const entry = store.get(key);
      if (!entry || entry.revision !== revision) throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
      store.set(key, { value, revision: ++seq });
      return seq;
    },
    async delete(key) { store.delete(key); },
  };
}

async function circlingSession(collab, status) {
  const session = createSession('task-circling', { mode: COLLAB_MODE.CIRCLING_STRATEGY, min_nodes: 3, max_subrounds: 2, automation_tier: 1 });
  session.status = status;
  session.nodes = ['worker', 'reviewerA', 'reviewerB'].map((id) => ({ node_id: id, role: id, status: 'active' }));
  session.circling.worker_node_id = 'worker';
  session.circling.reviewerA_node_id = 'reviewerA';
  session.circling.reviewerB_node_id = 'reviewerB';
  session.circling.phase = status === 'recruiting' ? 'init' : 'circling';
  session.circling.current_subround = status === 'recruiting' ? 0 : 2;
  session.circling.current_step = status === 'recruiting' ? 0 : 1;
  await collab.put(session);
  return session.session_id;
}

function harness({ onTouch } = {}) {
  const kv = revisionKV();
  const collab = new CollabStore(kv);
  const published = [];
  daemon.__test.setContext({
    collabStore: collab,
    store: {
      async get(id) { return { task_id: id, description: 'd', status: 'claimed' }; },
      async touchActivity() { if (onTouch) await onTouch(collab); },
      async markReleased() { return false; },
    },
    nc: { publish(subject, data) { published.push({ subject, body: JSON.parse(sc.decode(data)) }); }, request: async () => ({}) },
  });
  return { kv, collab, published };
}

const rounds = (published) => published.filter((p) => /\.node\.[^.]+\.round$/.test(p.subject));

describe('startCirclingStep writes its step stamp with CAS', () => {
  it('a cancel during the parent-lease renewal stays cancelled and no step is dispatched', async () => {
    let sid;
    const h = harness({ onTouch: (collab) => collab.markAborted(sid, 'Parent task cancelled') });
    sid = await circlingSession(h.collab, 'active');
    await daemon.__test.startCirclingStep(sid);
    const session = await h.collab.get(sid);
    assert.equal(session.status, 'aborted');
    assert.equal(session.result.summary, 'Parent task cancelled');
    assert.equal(session.rounds.length, 0, 'no round was started for the cancelled session');
    assert.deepEqual(rounds(h.published), [], 'no member got a next-step prompt');
    assert.equal(daemon.__test.hasCirclingStepTimer(sid), false);
  });

  it('the first step still starts from a recruiting session and stamps step_started_at', async () => {
    const h = harness();
    const sid = await circlingSession(h.collab, 'recruiting');
    await daemon.__test.startCirclingStep(sid);
    const session = await h.collab.get(sid);
    assert.equal(session.status, 'active');
    assert.ok(session.circling.step_started_at, 'step start recorded for timeout rehydration');
    assert.equal(rounds(h.published).length, 3);
    assert.equal(daemon.__test.hasCirclingStepTimer(sid), true);
  });
});

describe('storeArtifact never writes a stale snapshot back', () => {
  it('stores on the fresh copy after a CAS conflict, keeping a concurrent abort', async () => {
    const h = harness();
    const sid = await circlingSession(h.collab, 'active');
    const realUpdate = h.kv.update.bind(h.kv);
    let raced = false;
    h.kv.update = async (key, value, revision) => {
      if (!raced && key === sid) { raced = true; await h.collab.markAborted(sid, 'Budget exceeded'); }
      return realUpdate(key, value, revision);
    };
    const stored = await h.collab.storeArtifact(sid, 'sr2_step1_worker_workArtifact', 'x');
    assert.ok(stored);
    const session = await h.collab.get(sid);
    assert.equal(session.status, 'aborted');
    assert.equal(session.circling.artifacts.sr2_step1_worker_workArtifact, 'x');
  });

  it('a non-conflict write failure returns null and puts nothing', async () => {
    const h = harness();
    const sid = await circlingSession(h.collab, 'active');
    h.kv.puts.length = 0;
    h.kv.update = async () => { throw new Error('maximum payload exceeded'); };
    assert.equal(await h.collab.storeArtifact(sid, 'sr2_step1_worker_workArtifact', 'x'), null);
    assert.deepEqual(h.kv.puts.filter((k) => k === sid), [], 'no blind put of the session');
  });
});
