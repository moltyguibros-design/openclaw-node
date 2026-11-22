#!/usr/bin/env node
/**
 * collab-live-index.test.js — audit mesh-core~2#18 (operator option C).
 *
 * MESH_COLLAB keeps every session forever, and the daemon's 5s recruiting
 * check, its round/step sweeps, the stall detector and every agent's
 * recruiting poll read the whole bucket (kv.keys, then get + JSON.parse on
 * each key). CollabStore now keeps an index of recruiting and active sessions
 * under one key, and a status listing for those reads only what it names.
 *
 * Run: node --test test/collab-live-index.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { createSession, CollabStore, COLLAB_STATUS, LIVE_INDEX_KEY } = require('../lib/mesh-collab');

const sc = StringCodec();

class CountingKV {
  constructor() { this.store = new Map(); this.gets = 0; this.scans = 0; }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { this.gets++; return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { this.scans++; return this.store.keys(); }
}

const spec = { mode: 'parallel', min_nodes: 2, max_nodes: 3, max_rounds: 2 };
const writeRaw = (kv, session) => kv.put(session.session_id, sc.encode(JSON.stringify(session)));

async function history(kv, n) {
  for (let i = 0; i < n; i++) {
    const s = createSession(`old-${i}`, spec);
    s.session_id = `collab-old-${i}`;
    s.status = i % 2 ? COLLAB_STATUS.COMPLETED : COLLAB_STATUS.ABORTED;
    await writeRaw(kv, s);
  }
}

describe('the live-session index', () => {
  it('a status listing reads the index and the live sessions, not the history', async () => {
    const kv = new CountingKV();
    await history(kv, 200);
    const store = new CollabStore(kv);
    const recruiting = createSession('T-live', spec);
    await store.put(recruiting);

    assert.deepEqual((await store.list({ status: 'recruiting' })).map(s => s.session_id), [recruiting.session_id]);
    kv.gets = 0;
    kv.scans = 0;
    for (let i = 0; i < 5; i++) {
      assert.equal((await store.list({ status: 'recruiting' })).length, 1);
      assert.deepEqual(await store.list({ status: 'active' }), []);
    }
    assert.equal(kv.scans, 0, 'no full scan');
    assert.ok(kv.gets <= 20, `read ${kv.gets} keys for 10 listings over 201 sessions`);
  });

  it('sessions written before the index existed are found by the first listing', async () => {
    const kv = new CountingKV();
    await history(kv, 3);
    const live = createSession('T-pre', spec);
    await writeRaw(kv, live);
    const store = new CollabStore(kv);
    assert.deepEqual((await store.list({ status: 'recruiting' })).map(s => s.session_id), [live.session_id]);
  });

  it('follows a session through recruiting, active and completed', async () => {
    const store = new CollabStore(new CountingKV());
    const session = createSession('T-flow', spec);
    await store.put(session);
    await store.list({ status: 'recruiting' });
    await store.addNode(session.session_id, 'a');
    await store.addNode(session.session_id, 'b');
    await store.startRound(session.session_id);
    assert.deepEqual(await store.list({ status: 'recruiting' }), []);
    assert.deepEqual((await store.list({ status: 'active' })).map(s => s.session_id), [session.session_id]);
    assert.deepEqual((await store.findActiveSessionsByNode('a')).map(s => s.session_id), [session.session_id]);
    assert.deepEqual(await store.findActiveSessionsByNode('z'), []);
    await store.markCompleted(session.session_id, { summary: 'done' });
    assert.deepEqual(await store.list({ status: 'active' }), []);
    const index = JSON.parse(sc.decode((await store.kv.get(LIVE_INDEX_KEY)).value));
    assert.deepEqual(index, {});
  });

  it('a session another writer ended is dropped from the index', async () => {
    const kv = new CountingKV();
    const store = new CollabStore(kv);
    const session = createSession('T-mc', spec);
    await store.put(session);
    await store.list({ status: 'recruiting' });
    await writeRaw(kv, { ...session, status: COLLAB_STATUS.ABORTED }); // e.g. Mission Control's abort
    assert.deepEqual(await store.list({ status: 'recruiting' }), []);
    assert.deepEqual(JSON.parse(sc.decode((await kv.get(LIVE_INDEX_KEY)).value)), {});
  });

  it('a deleted session (JetStream DEL tombstone, empty value) reads as missing', async () => {
    const kv = new CountingKV();
    const store = new CollabStore(kv);
    const session = createSession('T-del', spec);
    await store.put(session);
    await store.list({ status: 'recruiting' });
    const tombstone = { value: new Uint8Array(0), operation: 'DEL' };
    kv.store.set(session.session_id, tombstone);
    assert.equal(await store.get(session.session_id), null);
    assert.equal(await store._updateWithCAS(session.session_id, (s) => s), null);
    assert.equal(await store.storeArtifact(session.session_id, 'k', 'v'), null);
    assert.deepEqual(await store.list({ status: 'recruiting' }), []);
    assert.deepEqual(await store.list(), []);
    kv.store.set(LIVE_INDEX_KEY, tombstone);
    assert.deepEqual((await store._readLiveIndex()).index, {});
  });

  it('a full listing and a task lookup never return the index as a session', async () => {
    const store = new CollabStore(new CountingKV());
    const session = createSession('T-all', spec);
    await store.put(session);
    await store.list({ status: 'recruiting' });
    assert.deepEqual((await store.list()).map(s => s.session_id), [session.session_id]);
    assert.equal((await store.list({ status: 'completed' })).length, 0);
    assert.equal((await store.findByTaskId('T-all')).session_id, session.session_id);
  });
});
