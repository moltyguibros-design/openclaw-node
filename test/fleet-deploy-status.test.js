/**
 * fleet-deploy-status.test.js — `fleet-deploy --status` asks each node's deploy listener
 * (mesh.deploy.status.<nodeId>) for its live version, and measures it against the branch a
 * fleet deploy from this lead would send, not a hardcoded origin/main.
 *
 * The listener's responder had no caller, and showStatus always fetched origin/main.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { StringCodec } = require('nats');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-status-'));
const REPO = path.join(tmp, 'repo');
const ORIGIN = path.join(tmp, 'origin.git');
process.env.HOME = tmp;
process.env.OPENCLAW_REPO_DIR = REPO;
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'lead';
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' });

const { showStatus, queryNodeStatus, statusBranch } = require('../bin/fleet-deploy.js');

const sc = StringCodec();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

function memKv(entries) {
  const store = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async keys() { return (async function* () { for (const k of store.keys()) yield k; })(); },
    async get(k) { return store.has(k) ? { value: sc.encode(store.get(k)) } : null; },
  };
}

/** A bus with a MESH_NODES registry and the listeners that answer status queries. */
function fakeNc(registry, listeners) {
  const asked = [];
  return {
    asked,
    jetstream() { return { views: { kv: async (name) => (name === 'MESH_NODES' ? memKv(registry) : memKv({})) } }; },
    async request(subject) {
      asked.push(subject);
      const nodeId = subject.slice('mesh.deploy.status.'.length);
      if (!listeners[nodeId]) throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' });
      return { data: sc.encode(JSON.stringify({ nodeId, ...listeners[nodeId] })) };
    },
  };
}

async function captured(fn) {
  const lines = [];
  const saved = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = saved; }
  // eslint-disable-next-line no-control-regex
  return lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
}

let featureSha;

before(() => {
  git(tmp, 'init', '-q', '--bare', ORIGIN);
  fs.mkdirSync(REPO);
  git(REPO, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(REPO, 'a'), '1\n');
  git(REPO, 'add', '.');
  git(REPO, 'commit', '-q', '-m', 'one');
  git(REPO, 'remote', 'add', 'origin', ORIGIN);
  git(REPO, 'push', '-q', 'origin', 'main');
  git(REPO, 'checkout', '-q', '-b', 'feature-x');
  fs.writeFileSync(path.join(REPO, 'a'), '2\n');
  git(REPO, 'commit', '-q', '-am', 'two');
  git(REPO, 'push', '-q', 'origin', 'feature-x');
  featureSha = git(REPO, 'rev-parse', '--short', 'HEAD');
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('fleet-deploy --status', () => {
  it('queries each node live and compares against the lead\'s current branch', async () => {
    const old = new Date(Date.now() - 3600_000).toISOString();
    const nc = fakeNc(
      {
        'node-a': { nodeId: 'node-a', role: 'worker', deployVersion: 'stale00', lastSeen: old },
        'node-b': { nodeId: 'node-b', role: 'worker', deployVersion: featureSha, lastSeen: old },
      },
      { 'node-a': { deployVersion: featureSha, deploying: false } },
    );
    const out = await captured(() => showStatus(nc));
    assert.deepEqual(nc.asked.sort(), ['mesh.deploy.status.node-a', 'mesh.deploy.status.node-b']);
    assert.match(out, new RegExp(`Repo: +feature-x @ ${featureSha}`));
    const row = (id) => out.split('\n').find((l) => l.trim().startsWith(id));
    assert.match(row('node-a'), new RegExp(`${featureSha} +current +now \\(live\\)`), 'the live answer beats the stale registry version');
    assert.match(row('node-b'), /OFFLINE +1h ago, no reply/);
  });

  it('a node mid-deploy reads DEPLOYING', async () => {
    const nc = fakeNc({ 'node-a': { nodeId: 'node-a', role: 'worker' } }, { 'node-a': { deployVersion: 'stale00', deploying: true } });
    assert.match(await captured(() => showStatus(nc)), /node-a .*DEPLOYING/);
  });

  it('never puts an id that is not a subject token on the bus', async () => {
    const nc = fakeNc({}, {});
    assert.equal(await queryNodeStatus(nc, 'a.>'), null);
    assert.equal(await queryNodeStatus(nc, 'a b'), null);
    assert.deepEqual(nc.asked, []);
  });

  it('a detached lead compares against OPENCLAW_DEPLOY_BRANCH', () => {
    git(REPO, 'checkout', '-q', '--detach');
    try {
      process.env.OPENCLAW_DEPLOY_BRANCH = 'release';
      assert.equal(statusBranch(REPO), 'release');
    } finally {
      delete process.env.OPENCLAW_DEPLOY_BRANCH;
      git(REPO, 'checkout', '-q', 'feature-x');
    }
    assert.equal(statusBranch(REPO), 'feature-x');
  });
});
