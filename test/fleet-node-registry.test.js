/**
 * fleet-node-registry.test.js — MESH_NODES was read by fleet-deploy but never
 * created: the listener only updated an existing entry, so discovery always
 * fell back to MESH_NODE_HEALTH, which then dropped the deployVersion it had.
 * `fleet-deploy --status` showed every node's version as '—' (UNKNOWN).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringCodec } = require('nats');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-registry-'));
// NODE_ID, NODE_ROLE and the observability DB path are read at module load.
process.env.HOME = tmp;
process.env.OPENCLAW_IDENTITY_DIR = path.join(tmp, '.openclaw');
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'worker-a';
process.env.OPENCLAW_NODE_ROLE = 'worker';

const { upsertNodeRegistry } = require('../bin/mesh-deploy-listener.js');
const { discoverNodes } = require('../bin/fleet-deploy.js');

const sc = StringCodec();

function memKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    async keys() { return (async function* () { for (const k of store.keys()) yield k; })(); },
    async get(k) { return store.has(k) ? { value: sc.encode(store.get(k)) } : null; },
    async put(k, v) { store.set(k, sc.decode(v)); },
  };
}

function fakeNc(buckets) {
  return { jetstream() { return { views: { kv: async (name) => buckets[name] || memKv() } }; } };
}

describe('MESH_NODES registry', () => {
  let savedLog;
  before(() => { savedLog = console.log; console.log = () => {}; });
  after(() => { console.log = savedLog; fs.rmSync(tmp, { recursive: true, force: true }); });

  it('the listener creates its entry when absent', async () => {
    const kv = memKv();
    await upsertNodeRegistry(kv, { deployVersion: 'abc1234' });
    const node = JSON.parse(kv.store.get('worker-a'));
    assert.equal(node.nodeId, 'worker-a');
    assert.equal(node.role, 'worker');
    assert.equal(node.platform, os.platform());
    assert.equal(node.deployVersion, 'abc1234');
    assert.ok(Date.now() - new Date(node.lastSeen).getTime() < 5000);
  });

  it('a heartbeat without a version keeps the recorded deployVersion and refreshes lastSeen', async () => {
    const kv = memKv({ 'worker-a': { nodeId: 'worker-a', deployVersion: 'abc1234', lastSeen: '2020-01-01T00:00:00Z', lastDeploy: 'x' } });
    await upsertNodeRegistry(kv, {});
    const node = JSON.parse(kv.store.get('worker-a'));
    assert.equal(node.deployVersion, 'abc1234');
    assert.equal(node.lastDeploy, 'x');
    assert.notEqual(node.lastSeen, '2020-01-01T00:00:00Z');
  });

  it('fleet-deploy discovers the entry the listener wrote, with its version', async () => {
    const nodesKv = memKv();
    await upsertNodeRegistry(nodesKv, { deployVersion: 'abc1234' });
    const nodes = await discoverNodes(fakeNc({ MESH_NODES: nodesKv }));
    assert.deepEqual(nodes.map(n => [n.nodeId, n.deployVersion]), [['worker-a', 'abc1234']]);
  });

  it('the MESH_NODE_HEALTH fallback keeps the health record deployVersion', async () => {
    const health = memKv({
      w1: { nodeId: 'w1', role: 'worker', deployVersion: 'def5678', reportedAt: new Date().toISOString() },
      w2: { nodeId: 'w2', role: 'worker', deployVersion: 'unknown', reportedAt: new Date().toISOString() },
    });
    const nodes = await discoverNodes(fakeNc({ MESH_NODE_HEALTH: health }));
    const byId = Object.fromEntries(nodes.map(n => [n.nodeId, n.deployVersion]));
    assert.equal(byId.w1, 'def5678');
    assert.equal(byId.w2, null);
  });
});
