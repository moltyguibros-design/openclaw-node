/**
 * mesh-deploy-fleet-sha.test.js — a fleet trigger carries the sha the run
 * resolved (origin's tip), never the lead checkout's HEAD.
 *
 * The fetch sat inside the local-deploy branch, so `--node <remote>` alone
 * never fetched, and fleetDeploy signed and published `git rev-parse HEAD`:
 * a lead one commit behind origin pushed its stale HEAD to the fleet, and a
 * --dry-run previewed it.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
}).trim();

// A bus whose registry holds worker-7, which reports success for any sha; every
// publish is logged to busLog.
function writeBusStub(busStub, busLog) {
  fs.writeFileSync(busStub, `
    const Module = require('module');
    const fs = require('fs');
    const load = Module._load;
    const record = (e) => fs.appendFileSync(${JSON.stringify(busLog)}, JSON.stringify(e) + '\\n');
    const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
    const buckets = {
      MESH_NODES: { keys: async () => (async function* () { yield 'worker-7'; })(),
        get: async () => ({ value: enc({ nodeId: 'worker-7', role: 'worker', lastSeen: new Date().toISOString() }) }) },
      MESH_DEPLOY_RESULTS: { get: async () => ({ value: enc({ status: 'success', sha: 'x' }) }), put: async () => {} },
      MESH_DEPLOY_LATEST: { put: async () => {} },
    };
    const nc = {
      publish: (subject, data) => record({ subject, data: data && new TextDecoder().decode(data) }),
      flush: async () => {}, close: async () => {},
      jetstream: () => ({ views: { kv: async (name) => buckets[name] } }),
    };
    Module._load = function (request, ...rest) {
      const mod = load.call(this, request, ...rest);
      return request === 'nats' ? { ...mod, connect: async () => nc } : mod;
    };
  `);
}

describe('mesh-deploy fleet trigger sha', () => {
  let tmp, origin, seed, lead, busLog, busStub, shaA, shaB;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-fleet-sha-')));
    origin = path.join(tmp, 'origin.git');
    seed = path.join(tmp, 'seed');
    lead = path.join(tmp, 'lead');
    busLog = path.join(tmp, 'bus.jsonl');
    busStub = path.join(tmp, 'bus-stub.js');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
    git(tmp, 'init', '-q', '-b', 'main', seed);
    git(seed, 'remote', 'add', 'origin', origin);
    fs.writeFileSync(path.join(seed, 'NOTES.txt'), 'a\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-qm', 'A');
    git(seed, 'push', '-q', 'origin', 'main');
    shaA = git(seed, 'rev-parse', 'HEAD');
    git(tmp, 'clone', '-q', origin, lead);
    fs.writeFileSync(path.join(seed, 'NOTES.txt'), 'b\n');
    git(seed, 'commit', '-qam', 'B');
    git(seed, 'push', '-q', 'origin', 'main');
    shaB = git(seed, 'rev-parse', 'HEAD');
    writeBusStub(busStub, busLog);
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const deploy = (...args) => {
    fs.rmSync(busLog, { force: true });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh-deploy.js'), ...args], {
      encoding: 'utf8',
      env: {
        ...process.env, HOME: path.join(tmp, 'home'), OPENCLAW_REPO_DIR: lead, OPENCLAW_NODE_ID: 'lead-x',
        OPENCLAW_NODE_ROLE: 'lead', OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'), OPENCLAW_DEPLOY_BRANCH: 'main',
        NODE_OPTIONS: `--require ${busStub}`,
      },
    });
    const bus = fs.existsSync(busLog) ? fs.readFileSync(busLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { ...r, triggers: bus.filter(e => e.subject === 'mesh.deploy.trigger').map(e => JSON.parse(e.data)) };
  };
  const short = sha => git(lead, 'rev-parse', '--short', sha);

  it('a remote-only dry run previews origin\'s tip, not the lead\'s stale HEAD', () => {
    const r = deploy('--node', 'worker-7', '--dry-run');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`Fleet Deploy: ${short(shaB)} → 1 node`), r.stdout);
    assert.deepEqual(r.triggers, []);
  });

  it('a remote-only deploy publishes origin\'s tip and leaves the lead checkout where it was', () => {
    const r = deploy('--node', 'worker-7');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.triggers.length, 1, r.stdout);
    assert.equal(r.triggers[0].sha, short(shaB));
    assert.equal(r.triggers[0].branch, 'main');
    // A worker may build Mission Control: the run waits as long as the listener lets a deploy run.
    assert.match(r.stdout, /Waiting for 1 node\(s\) to report \(1200s timeout\)/);
    assert.equal(git(lead, 'rev-parse', 'HEAD'), shaA, 'a remote-only deploy moved the lead checkout');
  });

  // Each remote listener checks its own memory store before it moves back; only
  // --force tells it to go below that store's schema, and only inside the signature.
  it('a rollback --force carries the schema override inside the signed trigger, a plain one does not', async () => {
    fs.mkdirSync(path.join(tmp, 'home', '.openclaw'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'home', '.openclaw', '.deploy-state.json'),
      JSON.stringify({ lastSha: shaA, deployedSha: shaA, components: {} }));
    const plain = deploy('--rollback', '--node', 'worker-7');
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    assert.equal(plain.triggers.length, 1, plain.stdout);
    assert.equal(plain.triggers[0].sha, short(shaA));
    assert.equal('schemaOverride' in plain.triggers[0], false);

    const forced = deploy('--rollback', '--node', 'worker-7', '--force');
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    const [t] = forced.triggers;
    assert.equal(t.schemaOverride, true);
    const { verifyDeployTrigger } = await import('../lib/deploy-trigger-auth.mjs');
    const opts = { requireSigned: true, trustedKeys: [t.signer_pubkey], seenIds: null };
    assert.equal(verifyDeployTrigger(t, opts).ok, true);
    assert.equal(verifyDeployTrigger({ ...plain.triggers[0], schemaOverride: true }, {
      ...opts, trustedKeys: [plain.triggers[0].signer_pubkey],
    }).ok, false, 'an override added after signing fails verification');
  });

  it('fleetDeploy refuses to guess the sha', async () => {
    process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs-inproc.db');
    const { fleetDeploy } = require('../bin/fleet-deploy.js');
    const nc = { jetstream: () => ({ views: { kv: async () => { throw new Error('no bus'); } } }) };
    const warn = console.warn;
    console.warn = () => {};
    try {
      await assert.rejects(fleetDeploy(nc, { targetNodes: ['worker-7'], branch: 'main' }), /needs the sha/);
    } finally {
      console.warn = warn;
    }
  });
});

// A listener that refuses to roll back below its memory store's schema names
// the override to run on the lead: `--rollback --force --node <it> --to <sha>`
// (test/deploy-pinned-sha.test.mjs). It used to name a bare `--rollback
// --force`, which after a rollback that moved the lead too sent the lead's
// lastSha (the sha the lead had just left), and after a rollback of one node
// rolled the lead back and sent the override to every node.
describe('the rollback override a refusing listener names', () => {
  let tmp, lead, home, busLog, busStub, shaA, shaB;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-rollback-to-')));
    const origin = path.join(tmp, 'origin.git');
    const seed = path.join(tmp, 'seed');
    lead = path.join(tmp, 'lead');
    home = path.join(tmp, 'home');
    busLog = path.join(tmp, 'bus.jsonl');
    busStub = path.join(tmp, 'bus-stub.js');
    git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
    git(tmp, 'init', '-q', '-b', 'main', seed);
    git(seed, 'remote', 'add', 'origin', origin);
    // A skill: a component with no service to restart, so the lead's own rollback deploys something.
    fs.mkdirSync(path.join(seed, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'skills', 'demo', 'SKILL.md'), '# demo A\n');
    fs.mkdirSync(path.join(seed, 'scripts', 'install'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'scripts', 'install', 'retired-files.txt'), '');
    git(seed, 'add', '.');
    git(seed, 'commit', '-qm', 'A');
    shaA = git(seed, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(seed, 'skills', 'demo', 'SKILL.md'), '# demo B\n');
    git(seed, 'commit', '-qam', 'B');
    git(seed, 'push', '-q', 'origin', 'main');
    shaB = git(seed, 'rev-parse', 'HEAD');
    git(tmp, 'clone', '-q', origin, lead);
    writeBusStub(busStub, busLog);
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const statePath = () => path.join(home, '.openclaw', '.deploy-state.json');
  const readState = () => JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  // The lead deployed B, and A before it.
  const deployedB = () => {
    git(lead, 'checkout', '-q', '--detach', shaB);
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify({ lastSha: shaA, deployedSha: shaB, components: {} }));
  };
  const run = (...args) => {
    fs.rmSync(busLog, { force: true });
    const env = {
      ...process.env, HOME: home, OPENCLAW_REPO_DIR: lead, OPENCLAW_NODE_ID: 'lead-x',
      OPENCLAW_NODE_ROLE: 'lead', OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'), OPENCLAW_DEPLOY_BRANCH: 'main',
      OPENCLAW_WORKSPACE: path.join(home, '.openclaw', 'workspace'), NODE_OPTIONS: `--require ${busStub}`,
    };
    delete env.OPENCLAW_HOME;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh-deploy.js'), ...args], { encoding: 'utf8', env });
    const bus = fs.existsSync(busLog) ? fs.readFileSync(busLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { ...r, triggers: bus.filter(e => e.subject === 'mesh.deploy.trigger').map(e => JSON.parse(e.data)) };
  };
  const deploy = (...args) => {
    const r = run(...args);
    assert.equal(r.status, 0, `mesh-deploy ${args.join(' ')}:\n${r.stdout}\n${r.stderr}`);
    return r;
  };
  const short = sha => sha.slice(0, 7);
  const sent = r => r.triggers.map(t => [t.sha, t.nodes, t.schemaOverride === true]);
  const override = () => deploy('--rollback', '--force', '--node', 'worker-7', '--to', short(shaA));

  it('after a rollback that moved the lead too, sends the refused sha to that node only', () => {
    deployedB();
    const rollback = deploy('--rollback');
    assert.deepEqual(sent(rollback), [[short(shaA), ['all'], false]]);
    assert.equal(git(lead, 'rev-parse', 'HEAD'), shaA);
    const afterRollback = readState();
    assert.equal(afterRollback.lastSha, shaB, 'the lead\'s next --rollback target is the sha it left');

    const forced = override();
    assert.deepEqual(sent(forced), [[short(shaA), ['worker-7'], true]], forced.stdout);
    assert.equal(git(lead, 'rev-parse', 'HEAD'), shaA, 'the lead stays where its rollback put it');
    assert.deepEqual(readState(), afterRollback);
  });

  it('after a rollback of one node, leaves the lead alone and gives no other node the override', () => {
    deployedB();
    const rollback = deploy('--rollback', '--node', 'worker-7');
    assert.deepEqual(sent(rollback), [[short(shaA), ['worker-7'], false]]);
    const before = readState();

    const forced = override();
    assert.deepEqual(sent(forced), [[short(shaA), ['worker-7'], true]], forced.stdout);
    assert.equal(git(lead, 'rev-parse', 'HEAD'), shaB, 'the lead did not roll itself back');
    assert.deepEqual(readState(), before);
  });

  it('refuses a --to that is not a commit before anything is sent', () => {
    deployedB();
    const r = run('--rollback', '--node', 'worker-7', '--to', 'no-such-sha');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /--to no-such-sha is not a commit/);
    assert.deepEqual(r.triggers, []);
  });

  // Its revert goes back to the sha before it; any other sha would keep part of it.
  it('refuses --to on a lead whose last deploy failed partway, before anything moves', () => {
    deployedB();
    fs.writeFileSync(statePath(), JSON.stringify({ lastSha: shaA, deployedSha: shaA, pendingSha: shaB, pendingFrom: shaA, components: {} }));
    const r = run('--rollback', '--to', short(shaA));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /failed partway on this node — revert it first/);
    assert.deepEqual(r.triggers, []);
    assert.equal(git(lead, 'rev-parse', 'HEAD'), shaB);
  });
});
