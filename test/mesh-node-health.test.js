/**
 * mesh-node-health.test.js — `mesh status` and `mesh health` read the
 * MESH_NODE_HEALTH KV. They used to wait on openclaw.*.heartbeat (no publisher
 * anywhere: `mesh status` hung forever) and run mesh-health.sh / mesh-repair.sh
 * (never shipped). exec, capture, broadcast and repair are gone.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { StringCodec } = require('nats');
const { readNodeHealth, summarizeNode, summarizeFleet } = require('../lib/mesh-node-health');

const ROOT = path.join(__dirname, '..');
const sc = StringCodec();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-node-health-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-16T12:00:00Z');
const at = s => new Date(NOW - s * 1000).toISOString();
const svc = (name, status) => ({ name, status });

function fakeNc(entries) {
  const kv = {
    async keys() { return (async function* () { yield* Object.keys(entries); })(); },
    async get(k) { return { value: sc.encode(JSON.stringify(entries[k])) }; },
  };
  return { jetstream: () => ({ views: { kv: async (name) => { assert.equal(name, 'MESH_NODE_HEALTH'); return kv; } } }) };
}

describe('summarizeNode', () => {
  it('no entry is down', () => {
    assert.equal(summarizeNode('w1', undefined, NOW).overall, 'down');
  });

  it('a report older than 60s is down', () => {
    const n = summarizeNode('w1', { reportedAt: at(90), services: [] }, NOW);
    assert.equal(n.overall, 'down');
    assert.deepEqual(n.problems, ['last report 90s ago']);
  });

  it('a service that is not active is degraded; not-found services are ignored', () => {
    const n = summarizeNode('w1', {
      reportedAt: at(5), services: [svc('mesh-agent', 'inactive'), svc('gateway', 'active'), svc('mesh-task-daemon', 'not-found')],
    }, NOW);
    assert.equal(n.overall, 'degraded');
    assert.deepEqual(n.problems, ['mesh-agent: inactive']);
  });

  it('a nearly full disk is degraded', () => {
    assert.equal(summarizeNode('w1', { reportedAt: at(5), services: [], diskPercent: 95 }, NOW).overall, 'degraded');
  });

  it('a fresh report with every service active is ok', () => {
    const n = summarizeNode('w1', { reportedAt: at(5), services: [svc('mesh-agent', 'active')], diskPercent: 40, role: 'worker' }, NOW);
    assert.equal(n.overall, 'ok');
    assert.equal(n.role, 'worker');
    assert.equal(n.ageSeconds, 5);
  });
});

describe('summarizeFleet', () => {
  const entries = [
    { nodeId: 'lead-x', reportedAt: at(5), services: [svc('mesh-task-daemon', 'active')] },
    { nodeId: 'w1', reportedAt: at(5), services: [svc('mesh-agent', 'failed')] },
  ];

  it('without --all reports this node only', () => {
    const r = summarizeFleet(entries, { localId: 'lead-x', all: false, now: NOW });
    assert.deepEqual(r.nodes.map(n => n.nodeId), ['lead-x']);
    assert.equal(r.overall, 'ok');
  });

  it('--all reports every node, worst state wins, and a silent local node is down', () => {
    const r = summarizeFleet(entries, { localId: 'lead-x', all: true, now: NOW });
    assert.equal(r.overall, 'degraded');
    const silent = summarizeFleet(entries, { localId: 'gone', all: true, now: NOW });
    assert.deepEqual(silent.nodes.map(n => [n.nodeId, n.overall]), [['gone', 'down'], ['lead-x', 'ok'], ['w1', 'degraded']]);
    assert.equal(silent.overall, 'down');
  });
});

describe('readNodeHealth', () => {
  it('reads every MESH_NODE_HEALTH entry, keyed by nodeId', async () => {
    const rows = await readNodeHealth(fakeNc({ w2: { reportedAt: at(1) }, w1: { nodeId: 'w1', reportedAt: at(1) } }));
    assert.deepEqual(rows.map(r => r.nodeId), ['w1', 'w2']);
  });
});

describe('mesh CLI', () => {
  // Swaps nats.connect for an in-memory MESH_NODE_HEALTH, so the real CLI runs end to end.
  const preload = path.join(tmp, 'fake-nats.cjs');
  const health = {
    'lead-x': { nodeId: 'lead-x', platform: 'darwin', role: 'lead', reportedAt: new Date().toISOString(),
      services: [svc('mesh-task-daemon', 'active')], mem: { free: 100, total: 200 }, uptimeSeconds: 3600, deployVersion: 'abc1234' },
    w1: { nodeId: 'w1', platform: 'linux', role: 'worker', reportedAt: new Date().toISOString(), services: [svc('mesh-agent', 'inactive')] },
  };
  fs.writeFileSync(preload, `
    const Module = require('module');
    const realLoad = Module._load;
    const health = ${JSON.stringify(health)};
    Module._load = function (request, ...rest) {
      const mod = realLoad.call(this, request, ...rest);
      if (request !== 'nats') return mod;
      const sc = mod.StringCodec();
      const kv = {
        async keys() { return (async function* () { yield* Object.keys(health); })(); },
        async get(k) { return { value: sc.encode(JSON.stringify(health[k])) }; },
      };
      const nc = { publish() {}, async close() {}, jetstream: () => ({ views: { kv: async () => kv } }) };
      return { ...mod, connect: async () => nc };
    };
  `);
  const mesh = (...args) => spawnSync(process.execPath, ['--require', preload, path.join(ROOT, 'bin', 'mesh.js'), ...args], {
    encoding: 'utf8', timeout: 20000,
    env: { ...process.env, HOME: tmp, OPENCLAW_NODE_ID: 'lead-x', OPENCLAW_OBS_DB: path.join(tmp, 'obs.db') },
  });

  it('mesh status lists every node in MESH_NODE_HEALTH and returns', () => {
    const r = mesh('status');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /● lead-x \(this machine\)\s+\[ok\]/);
    assert.match(r.stdout, /Deployed:\s+abc1234/);
    assert.match(r.stdout, /● w1\s+\[degraded\]/);
  });

  it('mesh health --json --all grades every node and exits 1 when one is not ok', () => {
    const r = mesh('health', '--json', '--all');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.overall, 'degraded');
    assert.deepEqual(report.nodes.map(n => [n.nodeId, n.overall]), [['lead-x', 'ok'], ['w1', 'degraded']]);
    assert.deepEqual(report.nodes[1].problems, ['mesh-agent: inactive']);
  });

  it('mesh health (this node only) exits 0 when it is ok', () => {
    const r = mesh('health');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^OK\s+lead-x \(this machine\)/m);
  });

  for (const cmd of ['exec', 'capture', 'broadcast', 'repair']) {
    it(`mesh ${cmd} is refused as removed`, () => {
      const r = mesh(cmd, 'x');
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(`mesh ${cmd} was removed`));
    });
  }
});
