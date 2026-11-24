/**
 * deploy-trigger-branch.test.js — a detached lead checkout never sends
 * `branch: 'HEAD'` in a deploy trigger.
 *
 * mesh-deploy's rollback, pinned and off-branch deploys all `checkout --detach`;
 * `git rev-parse --abbrev-ref HEAD` then prints 'HEAD', and every listener
 * validated the signed sha against origin/HEAD, which its `git fetch origin
 * HEAD` never updates: "signed sha … is not on origin/HEAD".
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-branch-')));
const REPO = path.join(tmp, 'repo');
const ORIGIN = path.join(tmp, 'origin.git');
process.env.HOME = tmp;
process.env.OPENCLAW_IDENTITY_DIR = path.join(tmp, '.openclaw');
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'lead-x';

const git = (...args) => execFileSync('git', args, {
  cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
}).trim();

const { triggerBranch } = require('../bin/fleet-deploy.js');

describe('deploy trigger branch on a detached lead', () => {
  let sha;
  before(() => {
    fs.mkdirSync(REPO);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', ORIGIN]);
    git('init', '-q', '-b', 'main');
    git('remote', 'add', 'origin', ORIGIN);
    fs.writeFileSync(path.join(REPO, 'f'), 'x\n');
    git('add', 'f');
    git('commit', '-q', '-m', 'c');
    git('push', '-q', 'origin', 'main');
    sha = git('rev-parse', '--short', 'HEAD');
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('fleet-deploy: a branch checkout sends its branch', () => {
    git('checkout', '-q', '-b', 'release');
    assert.equal(triggerBranch(REPO), 'release');
    git('checkout', '-q', 'main');
  });

  it('fleet-deploy: a detached checkout sends the deploy branch, not HEAD', () => {
    git('checkout', '-q', '--detach');
    try {
      assert.equal(triggerBranch(REPO), 'main');
      process.env.OPENCLAW_DEPLOY_BRANCH = 'stable';
      assert.equal(triggerBranch(REPO), 'stable');
    } finally {
      delete process.env.OPENCLAW_DEPLOY_BRANCH;
      git('checkout', '-q', 'main');
    }
  });

  it('mesh deploy: a detached checkout announces and sends the deploy branch', () => {
    git('checkout', '-q', '--detach');
    try {
      // The bus is unreachable: the command stops after naming what it would trigger.
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'deploy'], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, OPENCLAW_REPO_DIR: REPO, OPENCLAW_NATS: 'nats://127.0.0.1:1', OPENCLAW_DEPLOY_BRANCH: '' },
      });
      assert.match(r.stdout, new RegExp(`Deploying ${sha} \\(main\\)`), r.stdout + r.stderr);
    } finally {
      git('checkout', '-q', 'main');
    }
  });
});
