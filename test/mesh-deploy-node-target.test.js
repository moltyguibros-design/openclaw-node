/**
 * mesh-deploy-node-target.test.js — `mesh-deploy.js --node <x>` means exactly
 * node x. An unrecognised name used to match neither hardcoded alias list and
 * fall through to "deploy this node, then trigger every node".
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { LEGACY_ALIASES, loadNodeAliases, planNodeTargets, unknownNodes } = require('../lib/node-aliases');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-node-target-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('planNodeTargets', () => {
  const opts = { localId: 'lead-x', aliases: LEGACY_ALIASES };

  it('an exact remote id targets that node only', () => {
    assert.deepEqual(planNodeTargets(['worker-7'], opts), { deployLocal: false, remoteIds: ['worker-7'] });
  });

  it('self, local and this node\'s own id deploy here only', () => {
    for (const name of ['self', 'local', 'SELF', 'lead-x']) {
      assert.deepEqual(planNodeTargets([name], opts), { deployLocal: true, remoteIds: [] }, name);
    }
  });

  it('legacy nicknames map to node ids', () => {
    for (const name of ['ubuntu', 'linux', 'calos']) {
      assert.deepEqual(planNodeTargets([name], opts).remoteIds, ['calos-vmware-virtual-platform'], name);
    }
    for (const name of ['mac', 'macos', 'moltymac']) {
      assert.deepEqual(planNodeTargets([name], opts).remoteIds, ['moltymacs-virtual-machine'], name);
    }
    assert.deepEqual(planNodeTargets(['mac'], { ...opts, localId: 'moltymacs-virtual-machine' }),
      { deployLocal: true, remoteIds: [] });
  });

  it('mesh-aliases.json entries resolve too', () => {
    const home = path.join(tmp, 'alias-home');
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    fs.writeFileSync(path.join(home, '.openclaw', 'mesh-aliases.json'), JSON.stringify({ w7: 'worker-7' }));
    const plan = planNodeTargets(['w7', 'self'], { localId: 'lead-x', aliases: loadNodeAliases(home) });
    assert.deepEqual(plan, { deployLocal: true, remoteIds: ['worker-7'] });
  });

  it('unknownNodes lists ids the registry has never seen', () => {
    assert.deepEqual(unknownNodes(['w1', 'worker-7'], [{ nodeId: 'w1' }, { nodeId: 'w2' }]), ['worker-7']);
  });
});

describe('mesh-deploy.js --node', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh-deploy.js'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmp,
      OPENCLAW_NODE_ID: 'lead-x',
      OPENCLAW_NODE_ROLE: 'lead',
      OPENCLAW_REPO_DIR: path.join(tmp, 'no-repo'),
      OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'),
      OPENCLAW_NATS: 'nats://127.0.0.1:1',
    },
  });

  it('an id it cannot find in the fleet registry is refused before anything deploys', () => {
    const r = run('--node', 'worker-7', '--dry-run');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Deploying to/, r.stdout);
    assert.match(r.stdout, /--node worker-7/);
  });

  it('--local with a remote --node is refused', () => {
    const r = run('--local', '--node', 'worker-7', '--dry-run');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /Deploying to/, r.stdout);
    assert.match(r.stdout, /--local conflicts with --node worker-7/);
  });

  it('--node self deploys this node only, without asking the registry', () => {
    const r = run('--node', 'self', '--dry-run');
    assert.match(r.stdout, /Deploying to/, r.stdout);
    assert.match(r.stdout, /Repo not found/);
    assert.doesNotMatch(r.stdout, /--node/);
  });

  // A typo used to deploy nothing, exit 0, and publish a trigger every node skipped.
  it('an unknown --component is refused before anything is fetched or published', () => {
    const r = run('--component', 'skil');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /DEPLOY_ERROR .*unknown component skil — known: .*\bskills\b/);
    assert.doesNotMatch(r.stdout, /Deploying to|Fetching origin/);
  });

  it('known ids and all pass; pinned mode (the listener\'s rollback runs an older MANIFEST) is not checked', () => {
    for (const args of [['--component', 'skills'], ['--component', 'all'], ['--local', '--to', 'abc1234', '--component', 'skil']]) {
      const r = run(...args);
      assert.doesNotMatch(r.stdout + r.stderr, /unknown component/, args.join(' '));
    }
  });
});
