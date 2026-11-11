/**
 * fleet-deploy-results.test.js — a listener's 'skipped' result (no component
 * of the trigger applies to its role, or catch-up never moves a node back) is
 * not a failure: `fleet-deploy --component mc` must not list every worker as
 * [FAIL] and count it under Failed.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringCodec } = require('nats');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-deploy-'));
// NODE_ID, REPO_DIR and the observability DB path are read at module load.
process.env.HOME = tmp;
process.env.OPENCLAW_IDENTITY_DIR = path.join(tmp, '.openclaw');
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'lead-x';
process.env.OPENCLAW_REPO_DIR = ROOT;

const { fleetDeploy } = require('../bin/fleet-deploy.js');

const sc = StringCodec();

function memKv(entries) {
  return {
    async keys() {
      return (async function* () { for (const k of Object.keys(entries)) yield k; })();
    },
    async get(k) {
      const v = typeof entries === 'function' ? entries(k) : entries[k];
      return v === undefined ? null : { value: sc.encode(JSON.stringify(v)) };
    },
    async put() {},
  };
}

function fakeNc(results) {
  const now = new Date().toISOString();
  const buckets = {
    MESH_NODES: memKv({
      w1: { nodeId: 'w1', role: 'worker', lastSeen: now },
      w2: { nodeId: 'w2', role: 'worker', lastSeen: now },
    }),
    MESH_DEPLOY_RESULTS: memKv((k) => results[k.slice(k.lastIndexOf('-') + 1)]),
  };
  return {
    publish() {},
    jetstream() { return { views: { kv: async (name) => buckets[name] } }; },
  };
}

async function captureOutput(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
}

describe('fleet-deploy result reporting', () => {
  let savedWarn;
  before(() => { savedWarn = console.warn; console.warn = () => {}; });
  after(() => { console.warn = savedWarn; fs.rmSync(tmp, { recursive: true, force: true }); });

  it("a 'skipped' node is reported as skipped, not as a failure", async () => {
    const out = await captureOutput(() => fleetDeploy(fakeNc({
      w1: { nodeId: 'w1', status: 'skipped', log: 'No matching components for role worker', durationSeconds: 0 },
      w2: { nodeId: 'w2', status: 'failed', errors: ['deploy script exited 1'], durationSeconds: 3 },
    }), { components: ['mc'], timeoutMs: 5000 }));

    assert.doesNotMatch(out, /\[FAIL\] w1/, out);
    assert.match(out, /w1 — skipped: No matching components for role worker/);
    assert.match(out, /\[FAIL\] w2 — failed after 3s/);
    assert.match(out, /Skipped:\s+1\b/);
    assert.match(out, /Failed:\s+1\b/);
  });
});
