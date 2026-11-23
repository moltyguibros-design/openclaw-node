/**
 * mesh-deploy-cli-options.test.js — `mesh deploy` (bin/mesh.js) only publishes
 * a real fleet trigger. bin/mesh-deploy.js documents --dry-run, --status,
 * --rollback, --local and --to under the same `mesh deploy` name; mesh.js
 * silently ignored them, so `mesh deploy --dry-run` deployed the fleet.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-deploy-opts-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const mesh = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'deploy', ...args], {
  encoding: 'utf8',
  env: {
    ...process.env, HOME: tmp, OPENCLAW_REPO_DIR: ROOT, OPENCLAW_NODE_ID: 'lead-x',
    OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'), OPENCLAW_NATS: 'nats://127.0.0.1:1',
  },
});

// A bus whose MESH_NODES registry holds only w1, and where w1 reports success;
// every publish and KV put lands in busLog.
const busLog = path.join(tmp, 'bus.jsonl');
const busStub = path.join(tmp, 'bus-stub.js');
fs.writeFileSync(busStub, `
  const Module = require('module');
  const fs = require('fs');
  const load = Module._load;
  const record = (e) => fs.appendFileSync(${JSON.stringify(busLog)}, JSON.stringify(e) + '\\n');
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
  const buckets = {
    MESH_NODES: { keys: async () => (async function* () { yield 'w1'; })(), get: async () => ({ value: enc({ nodeId: 'w1' }) }) },
    MESH_DEPLOY_RESULTS: {
      get: async (k) => (k.endsWith('-w1') ? { value: enc({ status: 'success' }) } : null),
      put: async (k) => record({ put: 'MESH_DEPLOY_RESULTS', key: k }),
    },
    MESH_DEPLOY_LATEST: { put: async (k) => record({ put: 'MESH_DEPLOY_LATEST', key: k }) },
  };
  const nc = {
    subscribe: () => ({ unsubscribe() {} }),
    publish: (subject) => record({ publish: subject }),
    flush: async () => {},
    close: async () => {},
    jetstream: () => ({ views: { kv: async (name) => {
      if (!buckets[name]) throw new Error('no bucket ' + name);
      return buckets[name];
    } } }),
  };
  Module._load = function (request, ...rest) {
    const mod = load.call(this, request, ...rest);
    return request === 'nats' ? { ...mod, connect: async () => nc } : mod;
  };
`);
const meshOnBus = (...args) => {
  fs.rmSync(busLog, { force: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'deploy', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, HOME: tmp, OPENCLAW_REPO_DIR: ROOT, OPENCLAW_NODE_ID: 'lead-x',
      OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'), NODE_OPTIONS: `--require ${busStub}`,
    },
  });
  const bus = fs.existsSync(busLog) ? fs.readFileSync(busLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { ...r, bus };
};

describe('mesh deploy options', () => {
  for (const opt of ['--dry-run', '--status', '--rollback', '--local', '--to']) {
    it(`${opt} is refused before any trigger is built`, () => {
      const r = mesh(opt);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.doesNotMatch(r.stdout, /Deploying/);
      assert.match(r.stderr, new RegExp(`unknown option ${opt}`));
      assert.match(r.stderr, /node bin\/mesh-deploy\.js/);
    });
  }

  it('--node <unknown> is refused before the marker or the trigger is written', () => {
    const r = meshOnBus('--node', 'no-such-node');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /unknown node no-such-node — known: w1/);
    assert.deepEqual(r.bus.filter((e) => !e.publish?.startsWith('openclaw.trace.')), []);
  });

  // A targeted deploy replaced the fleet-wide catch-up marker, so a node that
  // missed an earlier fleet-wide deploy never caught up.
  it('--node <registered> publishes the trigger and leaves the catch-up marker alone', () => {
    const r = meshOnBus('--node', 'w1');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.bus.some((e) => e.publish === 'mesh.deploy.trigger'), JSON.stringify(r.bus));
    assert.deepEqual(r.bus.filter((e) => e.put), [], 'a targeted deploy wrote the latest marker');
    assert.match(r.stdout, /targeted deploy: catch-up marker unchanged/);
    assert.match(r.stdout, /w1: success/);
  });

  it('a fleet-wide deploy writes the catch-up marker', () => {
    const r = meshOnBus();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(r.bus.filter((e) => e.put).map((e) => e.put).sort(), ['MESH_DEPLOY_LATEST', 'MESH_DEPLOY_RESULTS']);
  });

  it('--force, --component <x> and --node <x> are accepted', () => {
    const r = mesh('--force', '--component', 'mc', '--node', 'w1');
    assert.match(r.stdout, /Deploying .* \[FORCE\]/, r.stdout + r.stderr);
    assert.match(r.stdout, /Components: mc/);
    assert.match(r.stdout, /Targets: w1/);
  });
});
