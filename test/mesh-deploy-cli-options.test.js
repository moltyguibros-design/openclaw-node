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

  it('--force, --component <x> and --node <x> are accepted', () => {
    const r = mesh('--force', '--component', 'mc', '--node', 'w1');
    assert.match(r.stdout, /Deploying .* \[FORCE\]/, r.stdout + r.stderr);
    assert.match(r.stdout, /Components: mc/);
    assert.match(r.stdout, /Targets: w1/);
  });
});
