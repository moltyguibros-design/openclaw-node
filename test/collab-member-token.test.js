#!/usr/bin/env node
/**
 * collab-member-token.test.js — audit mesh-core#21, driven through the
 * daemon's REAL collab handlers (bin/mesh-task-daemon.js __test surface) over
 * in-memory KV.
 *
 * join/leave/reflect took node_id from the payload and checked nothing else,
 * so any holder of the shared NATS token could vote or leave as a real member
 * and steer the session's outcome. A join now issues a member token that only
 * the joiner's reply carries (the session stores its hash); leave and reflect
 * require it, and a signed operator request may remove a member.
 *
 * Run: node --test test/collab-member-token.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-token-'));
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
  const collabKv = new MockKV();
  const collabStore = new CollabStore(collabKv);
  const published = [];
  const nc = {
    publish(subject, data) { published.push({ subject, raw: sc.decode(data) }); },
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
  return { store, collabStore, collabKv, published, rpc };
}

/** A parallel session with members a and b, round 1 running; returns their tokens. */
async function runningSession(h) {
  const sub = await h.rpc('handleSubmit', {
    task_id: 'C-1', title: 'collab work',
    collaboration: { mode: 'parallel', min_nodes: 2, max_nodes: 3, max_rounds: 3 },
  });
  assert.equal(sub.ok, true, sub.error);
  const sid = (await h.store.get('C-1')).collab_session_id;
  const a = await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'a' });
  const b = await h.rpc('handleCollabJoin', { session_id: sid, node_id: 'b' });
  assert.equal(a.ok, true, a.error);
  assert.equal(b.ok, true, b.error);
  await h.collabStore.startRound(sid);
  return { sid, tokens: { a: a.data.member_token, b: b.data.member_token }, replies: { a, b } };
}

const vote = (sid, node_id, extra = {}) => ({ session_id: sid, node_id, summary: 'done', vote: 'converged', confidence: 0.9, artifacts: [], ...extra });
const reflectionsIn = async (h, sid) => (await h.collabStore.get(sid)).rounds[0].reflections.map((r) => r.node_id);

describe('collab member tokens (mesh-core#21)', () => {
  it('a join reply carries a token that no event, other reply or stored session does', async () => {
    const h = harness();
    const { sid, tokens, replies } = await runningSession(h);
    assert.match(tokens.a, /^[0-9a-f]{32}$/);
    assert.notEqual(tokens.a, tokens.b);
    assert.ok(!JSON.stringify(replies.b).includes(tokens.a), "b's join reply lists a, but not a's token");

    for (const { raw } of h.published) {
      assert.ok(!raw.includes(tokens.a) && !raw.includes(tokens.b), `token leaked on the bus: ${raw.slice(0, 80)}`);
    }
    const stored = sc.decode((await h.collabKv.get(sid)).value);
    assert.ok(!stored.includes(tokens.a) && !stored.includes(tokens.b), 'the session KV holds only the hash');
  });

  it('a reflection without the member token is refused and not counted', async () => {
    const h = harness();
    const { sid } = await runningSession(h);
    const reply = await h.rpc('handleCollabReflect', vote(sid, 'a'));
    assert.equal(reply.ok, false);
    assert.match(reply.error, /reflect refused/);
    assert.deepEqual(await reflectionsIn(h, sid), []);
  });

  it("a reflection presenting another member's token is refused", async () => {
    const h = harness();
    const { sid, tokens } = await runningSession(h);
    const reply = await h.rpc('handleCollabReflect', vote(sid, 'a', { member_token: tokens.b }));
    assert.equal(reply.ok, false);
    assert.deepEqual(await reflectionsIn(h, sid), []);
  });

  it('a member reflects with its own token', async () => {
    const h = harness();
    const { sid, tokens } = await runningSession(h);
    const reply = await h.rpc('handleCollabReflect', vote(sid, 'a', { member_token: tokens.a }));
    assert.equal(reply.ok, true, reply.error);
    assert.deepEqual(await reflectionsIn(h, sid), ['a']);
  });

  it('a leave without the member token is refused and the member stays', async () => {
    const h = harness();
    const { sid } = await runningSession(h);
    const reply = await h.rpc('handleCollabLeave', { session_id: sid, node_id: 'a' });
    assert.equal(reply.ok, false);
    assert.match(reply.error, /leave refused/);
    assert.deepEqual((await h.collabStore.get(sid)).nodes.map((n) => n.node_id), ['a', 'b']);
  });

  it('a member leaves with its own token', async () => {
    const h = harness();
    const { sid, tokens } = await runningSession(h);
    const reply = await h.rpc('handleCollabLeave', { session_id: sid, node_id: 'b', member_token: tokens.b });
    assert.equal(reply.ok, true, reply.error);
    assert.deepEqual((await h.collabStore.get(sid)).nodes.map((n) => n.node_id), ['a']);
  });

  it('a signed operator request removes a member (Mission Control remove_node)', async () => {
    const h = harness();
    const { sid } = await runningSession(h);
    const reply = await h.rpc('handleCollabLeave', signOperatorRequest({ session_id: sid, target_node_id: 'b' }, { identity: operator, nodeId: 'operator' }));
    assert.equal(reply.ok, true, reply.error);
    assert.deepEqual((await h.collabStore.get(sid)).nodes.map((n) => n.node_id), ['a']);
  });

  it('an unsigned request claiming to be the operator is refused', async () => {
    const h = harness();
    const { sid } = await runningSession(h);
    const reply = await h.rpc('handleCollabLeave', { session_id: sid, target_node_id: 'b', operator_action: true, node_id: 'operator' });
    assert.equal(reply.ok, false);
    assert.deepEqual((await h.collabStore.get(sid)).nodes.map((n) => n.node_id), ['a', 'b']);
  });
});
