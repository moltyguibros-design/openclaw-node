/**
 * mesh-deploy-cli-options.test.js — `mesh deploy` (bin/mesh.js) only publishes
 * a real fleet trigger. bin/mesh-deploy.js documents --dry-run, --status,
 * --rollback, --local and --to under the same `mesh deploy` name; mesh.js
 * silently ignored them, so `mesh deploy --dry-run` deployed the fleet.
 *
 * The trigger carries origin's tip of the deploy branch, as mesh-deploy's own
 * fleet trigger does: mesh.js sent the lead checkout's HEAD and branch, so a
 * lead behind origin deployed stale code and one on a work branch sent it.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-deploy-opts-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
}).trim();

// origin: main at B, stable at A. The lead cloned at A, then committed C on a
// work branch it never pushed. A repo with no origin stands beside it.
const origin = path.join(tmp, 'origin.git');
const seed = path.join(tmp, 'seed');
const lead = path.join(tmp, 'lead');
const orphan = path.join(tmp, 'orphan');
git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
git(tmp, 'init', '-q', '-b', 'main', seed);
git(seed, 'remote', 'add', 'origin', origin);
git(seed, 'commit', '-q', '--allow-empty', '-m', 'A');
git(seed, 'push', '-q', 'origin', 'main', 'main:stable');
const shaA = git(seed, 'rev-parse', 'HEAD');
git(tmp, 'clone', '-q', origin, lead);
git(seed, 'commit', '-q', '--allow-empty', '-m', 'B');
git(seed, 'push', '-q', 'origin', 'main');
const shaB = git(seed, 'rev-parse', 'HEAD');
git(lead, 'checkout', '-q', '-b', 'wip');
git(lead, 'commit', '-q', '--allow-empty', '-m', 'C');
const shaC = git(lead, 'rev-parse', 'HEAD');
git(tmp, 'init', '-q', '-b', 'main', orphan);
git(orphan, 'commit', '-q', '--allow-empty', '-m', 'O');

const baseEnv = () => {
  const e = { ...process.env, HOME: tmp, OPENCLAW_REPO_DIR: lead, OPENCLAW_NODE_ID: 'lead-x', OPENCLAW_OBS_DB: path.join(tmp, 'obs.db') };
  delete e.OPENCLAW_DEPLOY_BRANCH;
  return e;
};

const mesh = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'deploy', ...args], {
  encoding: 'utf8',
  env: { ...baseEnv(), OPENCLAW_NATS: 'nats://127.0.0.1:1' },
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
    publish: (subject, data) => record({ publish: subject, data: data && new TextDecoder().decode(data) }),
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
const meshOnBus = (args, env = {}) => {
  fs.rmSync(busLog, { force: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'deploy', ...args], {
    encoding: 'utf8',
    env: { ...baseEnv(), NODE_OPTIONS: `--require ${busStub}`, ...env },
  });
  const bus = fs.existsSync(busLog) ? fs.readFileSync(busLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const triggers = bus.filter((e) => e.publish === 'mesh.deploy.trigger').map((e) => JSON.parse(e.data));
  return { ...r, bus, triggers };
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
    const r = meshOnBus(['--node', 'no-such-node']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /unknown node no-such-node — known: w1/);
    assert.deepEqual(r.bus.filter((e) => !e.publish?.startsWith('openclaw.trace.')), []);
  });

  // A targeted deploy replaced the fleet-wide catch-up marker, so a node that
  // missed an earlier fleet-wide deploy never caught up.
  it('--node <registered> publishes the trigger and leaves the catch-up marker alone', () => {
    const r = meshOnBus(['--node', 'w1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.bus.some((e) => e.publish === 'mesh.deploy.trigger'), JSON.stringify(r.bus));
    assert.deepEqual(r.bus.filter((e) => e.put), [], 'a targeted deploy wrote the latest marker');
    assert.match(r.stdout, /targeted deploy: catch-up marker unchanged/);
    assert.match(r.stdout, /w1: success/);
  });

  it('a fleet-wide deploy writes the catch-up marker', () => {
    const r = meshOnBus([]);
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

describe('mesh deploy trigger sha', () => {
  it("signs and publishes origin's tip of main, not the lead's HEAD or work branch, and leaves the checkout alone", () => {
    const r = meshOnBus(['--force', '--component', 'mc', '--node', 'w1']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.triggers.length, 1, JSON.stringify(r.bus));
    const [t] = r.triggers;
    assert.ok(shaB.startsWith(t.sha) && t.sha.length >= 7, `trigger sha ${t.sha} is not origin/main ${shaB} (lead HEAD ${shaC})`);
    assert.equal(t.branch, 'main');
    assert.deepEqual([t.force, t.components, t.nodes], [true, ['mc'], ['w1']]);
    assert.ok(t.signature && t.signer_pubkey, 'the trigger went out unsigned');
    assert.match(r.stdout, new RegExp(`Deploying ${t.sha} \\(main\\) \\[FORCE\\]`));
    assert.equal(git(lead, 'rev-parse', 'HEAD'), shaC, 'the trigger moved the lead checkout');
    assert.equal(git(lead, 'symbolic-ref', '--short', 'HEAD'), 'wip');
  });

  it('OPENCLAW_DEPLOY_BRANCH names the branch whose tip it sends', () => {
    const r = meshOnBus([], { OPENCLAW_DEPLOY_BRANCH: 'stable' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.triggers.length, 1, JSON.stringify(r.bus));
    assert.ok(shaA.startsWith(r.triggers[0].sha), `trigger sha ${r.triggers[0].sha} is not origin/stable ${shaA}`);
    assert.equal(r.triggers[0].branch, 'stable');
  });

  it('a checkout whose origin cannot be fetched publishes nothing', () => {
    const r = meshOnBus([], { OPENCLAW_REPO_DIR: orphan });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /origin\/main/);
    assert.doesNotMatch(r.stdout, /Deploying/);
    assert.deepEqual(r.bus.filter((e) => !e.publish?.startsWith('openclaw.trace.')), []);
  });
});

// The skill, the README and `mesh help` still said it deployed "the repo HEAD"
// or "the repo's current sha and branch", and the help never named the
// variable that now picks what ships.
describe('mesh deploy docs', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'help'], { encoding: 'utf8', env: baseEnv() }).stdout;
  const skill = read('skills/mesh/SKILL.md');
  const docs = {
    help: help.split('\n').filter((l) => /mesh deploy|OPENCLAW_/.test(l)).join('\n'),
    skill: skill.slice(skill.indexOf('\n### Deploy\n'), skill.indexOf('\n## Health\n')),
    readme: read('README.md').split('\n').find((l) => l.startsWith('node ~/openclaw/bin/mesh.js deploy')),
  };

  for (const [name, text] of Object.entries(docs)) {
    it(`${name} says it deploys origin's tip of the deploy branch, not the checkout's HEAD`, () => {
      assert.ok(text && text.length > 40, `no mesh deploy text found in ${name}`);
      assert.doesNotMatch(text, /\bHEAD\b|current sha|current branch/);
      assert.match(text, /origin/);
      assert.match(text, /OPENCLAW_DEPLOY_BRANCH/);
    });
  }

  it('help and skill name the default branch and where the repo is read from', () => {
    assert.match(docs.help, /OPENCLAW_DEPLOY_BRANCH\b.*default main/);
    assert.match(docs.help, /OPENCLAW_REPO_DIR\b/);
    assert.match(docs.skill, /`main`/);
    assert.match(docs.skill, /\$OPENCLAW_REPO_DIR/);
  });
});
