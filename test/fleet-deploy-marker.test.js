/**
 * fleet-deploy-marker.test.js — only a fleet-wide deploy moves the `latest`
 * catch-up marker. A deploy aimed at one node replaced it, so a node that was
 * offline for an earlier fleet-wide deploy came back, read a marker naming
 * only the canary, and never caught up.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringCodec } = require('nats');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-deploy-marker-'));
process.env.HOME = tmp;
process.env.OPENCLAW_IDENTITY_DIR = path.join(tmp, '.openclaw');
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'lead-x';
process.env.OPENCLAW_REPO_DIR = ROOT;

const { fleetDeploy } = require('../bin/fleet-deploy.js');

const sc = StringCodec();

function memKv(entries = {}) {
  const store = new Map(Object.entries(entries).map(([k, v]) => [k, sc.encode(JSON.stringify(v))]));
  return {
    store,
    async keys() { return (async function* () { yield* store.keys(); })(); },
    async get(k) { return store.has(k) ? { value: store.get(k) } : null; },
    async put(k, v) { store.set(k, v); },
  };
}

describe('the latest catch-up marker', () => {
  const now = new Date().toISOString();
  const buckets = {
    MESH_NODES: memKv({
      canary: { nodeId: 'canary', role: 'worker', lastSeen: now },
      w2: { nodeId: 'w2', role: 'worker', lastSeen: now },
    }),
    MESH_DEPLOY_RESULTS: memKv(),
    MESH_DEPLOY_LATEST: memKv(),
  };
  const published = [];
  const nc = {
    publish: (subject, data) => published.push(JSON.parse(sc.decode(data))),
    jetstream: () => ({ views: { kv: async (name) => buckets[name] } }),
  };
  const marker = name => JSON.parse(sc.decode(buckets[name].store.get('latest')));
  const quiet = async (fn) => {
    const log = console.log;
    console.log = () => {};
    try { return await fn(); } finally { console.log = log; }
  };

  let savedWarn;
  before(() => { savedWarn = console.warn; console.warn = () => {}; });
  after(() => { console.warn = savedWarn; fs.rmSync(tmp, { recursive: true, force: true }); });

  it('a fleet-wide deploy writes it; a targeted one publishes but leaves it on the fleet-wide sha', async () => {
    await quiet(() => fleetDeploy(nc, { sha: 'aaaaaaa', timeoutMs: 1 }));
    assert.equal(marker('MESH_DEPLOY_LATEST').sha, 'aaaaaaa');
    assert.deepEqual(marker('MESH_DEPLOY_LATEST').nodes, ['all']);

    await quiet(() => fleetDeploy(nc, { sha: 'bbbbbbb', targetNodes: ['canary'], timeoutMs: 1 }));
    assert.equal(published.at(-1).sha, 'bbbbbbb', 'the targeted trigger still goes out');
    assert.deepEqual(published.at(-1).nodes, ['canary']);
    assert.equal(marker('MESH_DEPLOY_LATEST').sha, 'aaaaaaa', 'the targeted deploy replaced the fleet-wide marker');
    assert.equal(marker('MESH_DEPLOY_RESULTS').sha, 'aaaaaaa', 'the legacy copy too');
  });
});
