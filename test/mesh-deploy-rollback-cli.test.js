/**
 * mesh-deploy-rollback-cli.test.js — `mesh-deploy --rollback` honors --dry-run
 * and --node. The fleet step was hard-coded `dryRun: false`, so a preview
 * published a real forced deploy of HEAD, and the local step ignored a
 * remote-only --node, rolling this node back too.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

describe('mesh-deploy --rollback', () => {
  let tmp, repo, home, stub, out, shaA, shaB;
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-deploy-rollback-'));
    repo = path.join(tmp, 'repo');
    home = path.join(tmp, 'home');
    out = path.join(tmp, 'fleet-calls.jsonl');
    stub = path.join(tmp, 'stub.js');
    fs.mkdirSync(repo);
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    git('init', '-q');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'NOTES.txt'), 'a\n');
    git('add', '.');
    git('commit', '-qm', 'A');
    shaA = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'NOTES.txt'), 'b\n');
    git('commit', '-qam', 'B');
    shaB = git('rev-parse', 'HEAD');
    fs.writeFileSync(stub, `
      const Module = require('module');
      const fs = require('fs');
      const load = Module._load;
      Module._load = function (request, ...rest) {
        if (request.endsWith('fleet-deploy')) return {
          fleetDeploy: async (nc, o) => fs.appendFileSync(${JSON.stringify(out)}, JSON.stringify(o) + '\\n'),
          discoverNodes: async () => [{ nodeId: 'worker-7' }],
        };
        if (request === 'nats') return { connect: async () => ({ close: async () => {} }) };
        return load.call(this, request, ...rest);
      };
    `);
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const rollback = (...args) => {
    fs.writeFileSync(path.join(home, '.openclaw', '.deploy-state.json'),
      JSON.stringify({ lastSha: shaA, deployedSha: shaB, components: {} }));
    fs.rmSync(out, { force: true });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh-deploy.js'), '--rollback', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env, HOME: home, OPENCLAW_REPO_DIR: repo, OPENCLAW_NODE_ID: 'lead-x', OPENCLAW_NODE_ROLE: 'lead',
        OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'), OPENCLAW_NATS: 'nats://127.0.0.1:1',
        NODE_OPTIONS: `--require ${stub}`,
      },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { ...r, calls };
  };

  it('--dry-run previews the fleet step instead of publishing it', () => {
    const r = rollback('--dry-run');
    assert.equal(r.calls.length, 1, r.stdout);
    assert.equal(r.calls[0].dryRun, true);
    assert.equal(git('rev-parse', 'HEAD'), shaB);
  });

  it('--node <remote> rolls back only that node, at the rollback commit', () => {
    const r = rollback('--node', 'worker-7', '--no-restart');
    assert.equal(r.calls.length, 1, r.stdout);
    assert.deepEqual(r.calls[0].targetNodes, ['worker-7']);
    assert.equal(r.calls[0].sha, shaA.slice(0, 7));
    assert.equal(r.calls[0].dryRun, false);
    assert.equal(git('rev-parse', 'HEAD'), shaB, 'this checkout stays put');
    assert.doesNotMatch(r.stdout, /Rolled back to/);
  });
});
