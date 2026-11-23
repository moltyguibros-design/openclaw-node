/**
 * deploy-latest-marker.test.js — the `latest` catch-up marker must outlive the
 * 7-day MESH_DEPLOY_RESULTS TTL. It used to live only in that bucket, so a node
 * offline more than a week after the last deploy found no marker and silently
 * stayed on old code.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringCodec } = require('nats');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-latest-'));
process.env.HOME = tmp;
process.env.OPENCLAW_IDENTITY_DIR = path.join(tmp, '.openclaw');
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'lead-x';
process.env.OPENCLAW_REPO_DIR = ROOT;
process.env.OPENCLAW_DEPLOY_MARKER = path.join(tmp, '.last-deploy.json');

const { readLatestMarker, LATEST_BUCKET, RESULTS_BUCKET } = require('../lib/deploy-latest-marker');
const { fleetDeploy } = require('../bin/fleet-deploy.js');
const { checkAndCatchUp } = require('../bin/mesh-deploy-listener.js');

const sc = StringCodec();

function memKv(entries = {}) {
  const puts = [];
  return {
    puts,
    async keys() { return (async function* () { for (const k of Object.keys(entries)) yield k; })(); },
    async get(k) {
      const v = typeof entries === 'function' ? entries(k) : entries[k];
      return v === undefined ? null : { value: sc.encode(JSON.stringify(v)) };
    },
    async put(k, v) { puts.push([k, JSON.parse(sc.decode(v))]); },
  };
}

const marker = (sha, timestamp) => ({ sha, branch: 'main', nodes: ['all'], timestamp });

describe('readLatestMarker', () => {
  it('finds a marker the expired results bucket no longer holds', async () => {
    const got = await readLatestMarker({ latestKv: memKv({ latest: marker('aaa1111', '2026-01-01T00:00:00Z') }), resultsKv: memKv() });
    assert.equal(got.source, LATEST_BUCKET);
    assert.equal(got.marker.sha, 'aaa1111');
  });

  it('falls back to the legacy copy written by an old lead', async () => {
    const got = await readLatestMarker({ latestKv: memKv(), resultsKv: memKv({ latest: marker('bbb2222', '2026-01-01T00:00:00Z') }) });
    assert.equal(got.source, RESULTS_BUCKET);
    assert.equal(got.marker.sha, 'bbb2222');
  });

  it('prefers the newer copy when both exist', async () => {
    const latestKv = memKv({ latest: marker('old0000', '2026-01-01T00:00:00Z') });
    const resultsKv = memKv({ latest: marker('new1111', '2026-02-01T00:00:00Z') });
    assert.equal((await readLatestMarker({ latestKv, resultsKv })).marker.sha, 'new1111');
    resultsKv.get = memKv({ latest: marker('older00', '2025-12-01T00:00:00Z') }).get;
    assert.equal((await readLatestMarker({ latestKv, resultsKv })).marker.sha, 'old0000');
  });

  it('returns null when neither bucket has a marker', async () => {
    assert.equal(await readLatestMarker({ latestKv: memKv(), resultsKv: memKv() }), null);
  });
});

describe('writers and the listener', () => {
  const logs = [];
  let saved;
  before(() => {
    saved = { warn: console.warn, error: console.error, log: console.log };
    console.warn = (...a) => logs.push(a.join(' '));
    console.error = (...a) => logs.push(a.join(' '));
    console.log = (...a) => logs.push(a.join(' '));
  });
  after(() => { Object.assign(console, saved); fs.rmSync(tmp, { recursive: true, force: true }); });

  it('fleet-deploy writes the marker to the TTL-less bucket and the legacy key', async () => {
    const opened = {};
    const now = new Date().toISOString();
    const buckets = {
      MESH_NODES: memKv({ w1: { nodeId: 'w1', role: 'worker', lastSeen: now } }),
      MESH_DEPLOY_RESULTS: memKv(() => ({ nodeId: 'w1', status: 'success', durationSeconds: 1 })),
      MESH_DEPLOY_LATEST: memKv(),
    };
    const nc = {
      publish() {},
      jetstream() { return { views: { kv: async (name, opts) => { opened[name] = opts; return buckets[name]; } } }; },
    };
    await fleetDeploy(nc, { sha: 'abc1234', branch: 'main', timeoutMs: 5000 });

    assert.equal(opened.MESH_DEPLOY_LATEST.ttl, undefined, 'the marker bucket must not expire');
    const [[key, written]] = buckets.MESH_DEPLOY_LATEST.puts;
    assert.equal(key, 'latest');
    assert.deepEqual(buckets.MESH_DEPLOY_RESULTS.puts.find(([k]) => k === 'latest')[1], written);
  });

  it('the listener catches up from the TTL-less bucket after the results bucket expired', async () => {
    logs.length = 0;
    await checkAndCatchUp(memKv(), null, memKv({ latest: marker('ccc3333', '2026-01-01T00:00:00Z') }));
    // Unsigned, so strict verification rejects it — proof the marker was read and acted on.
    assert.ok(logs.some(l => /REJECTED catch-up marker.*ccc3333/.test(l)), logs.join('\n'));
  });

  it('the listener says so when there is no marker at all', async () => {
    logs.length = 0;
    await checkAndCatchUp(memKv(), null, memKv());
    assert.ok(logs.some(l => /no catch-up marker/.test(l)), logs.join('\n'));
  });
});
