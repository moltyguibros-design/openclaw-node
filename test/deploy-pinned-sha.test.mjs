/**
 * deploy-pinned-sha.test.mjs — a deploy installs what changed; a failed deploy
 * rolls back to preSha and stays there.
 *
 * 2026-09-26 audit of main df503b3: the listener fast-forwarded the tree, then
 * ran `mesh-deploy.js --local`, whose own fetch-and-diff saw HEAD == origin and
 * deployed nothing (success reported, nothing restarted); its rollback re-ran
 * that fetching deploy and fast-forwarded straight back onto the failed commit.
 *
 * Real git end to end: a bare origin, a node clone driven by the listener's
 * runDeploy — which runs the clone's own bin/mesh-deploy.js, the file under
 * test copied in — a throwaway HOME as the runtime tree, and launchctl /
 * systemctl / npm stubs on PATH that log what the deploy asked of them.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-pinned-')));
const HOME = path.join(ROOT, 'home');
const ORIGIN = path.join(ROOT, 'origin.git');
const SEED = path.join(ROOT, 'seed');
const NODE = path.join(ROOT, 'node');
const FAKEBIN = path.join(ROOT, 'fakebin');
const CALLS = path.join(ROOT, 'calls.log');
const IS_MAC = process.platform === 'darwin';

// Where mesh-deploy installs on a lead, all derived from HOME.
const RT = {
  bin: path.join(HOME, 'openclaw', 'bin'),
  skills: path.join(HOME, '.openclaw', 'workspace', 'skills'),
  workspace: path.join(HOME, '.openclaw', 'workspace'),
  mc: path.join(HOME, '.openclaw', 'workspace', 'projects', 'mission-control'),
  state: path.join(HOME, '.openclaw', '.deploy-state.json'),
};

// The preload makes os.platform() answer DEPLOY_TEST_PLATFORM, so the launchd
// and the systemd restart paths both run on any host, and puts the deploy's
// node in a dir of its own, as NODE_BIN is: the dir a deploy runs npm under,
// which here holds no npm, so the stubs below answer instead of the real one.
const PRELOAD = path.join(ROOT, 'platform.cjs');
fs.writeFileSync(PRELOAD, "if (process.env.DEPLOY_TEST_PLATFORM) require('os').platform = () => process.env.DEPLOY_TEST_PLATFORM;\n" +
  "if (process.env.DEPLOY_TEST_EXECPATH) process.execPath = process.env.DEPLOY_TEST_EXECPATH;\n");
const NODEBIN = path.join(ROOT, 'nodebin');
fs.mkdirSync(NODEBIN);
fs.symlinkSync(process.execPath, path.join(NODEBIN, 'node'));

// Before the listener loads: it reads REPO_DIR/HOME/role at require time and
// hands this environment to the deploy script it spawns.
Object.assign(process.env, {
  NODE_OPTIONS: `--require ${PRELOAD}`,
  DEPLOY_TEST_EXECPATH: path.join(NODEBIN, 'node'),
  HOME,
  OPENCLAW_REPO_DIR: NODE,
  OPENCLAW_NODE_ROLE: 'lead',
  OPENCLAW_NODE_ID: 'deploy-test-node',
  // As the service units set it: the clone has no node_modules of its own.
  NODE_PATH: path.join(REPO, 'node_modules'),
  PATH: `${FAKEBIN}${path.delimiter}${process.env.PATH}`,
  DEPLOY_TEST_CALLS: CALLS,
  DEPLOY_TEST_UNITS: 'openclaw-mesh-agent openclaw-mission-control',
  GIT_AUTHOR_NAME: 'deploy-test',
  GIT_AUTHOR_EMAIL: 'deploy-test@example.invalid',
  GIT_COMMITTER_NAME: 'deploy-test',
  GIT_COMMITTER_EMAIL: 'deploy-test@example.invalid',
});

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}
function stub(name, body) {
  write(FAKEBIN, name, `#!/bin/sh\necho "${name} $* @ $(pwd -P)" >> "$DEPLOY_TEST_CALLS"\n${body}\n`);
  fs.chmodSync(path.join(FAKEBIN, name), 0o755);
}
function commit(message) {
  git(SEED, 'add', '-A');
  git(SEED, 'commit', '-q', '-m', message);
  git(SEED, 'push', '-q', 'origin', 'main');
  return git(SEED, 'rev-parse', 'HEAD');
}

// A daemon built from a tree whose mesh-agent.js says BREAK_DEPLOY fails to start.
// DEPLOY_TEST_UNITS: systemd units installed here. DEPLOY_TEST_STOPPED: units
// or launchd labels installed but stopped, as the service manager reports them.
const broken = 'grep -q BREAK_DEPLOY "$OPENCLAW_REPO_DIR/bin/mesh-agent.js" 2>/dev/null';
stub('systemctl', `case "$*" in
  *LoadState*) for u in $DEPLOY_TEST_UNITS; do [ "$u" = "$6" ] && { echo loaded; exit 0; }; done; echo not-found; exit 0 ;;
  *is-active*) for u in $DEPLOY_TEST_STOPPED; do [ "$u" = "$3" ] && { echo inactive; exit 3; }; done; echo active; exit 0 ;;
esac
if ${broken}; then echo "Job for $3.service failed" >&2; exit 1; fi`);
stub('launchctl', `case "$1" in
  print) for u in $DEPLOY_TEST_STOPPED; do [ "$u" = "\${2##*/}" ] && { echo "state = not running"; exit 0; }; done; printf 'state = running\\npid = 4242\\n' ;;
  kickstart) if ${broken}; then echo "kickstart: service failed to start" >&2; exit 1; fi ;;
esac`);
// The registry has a newer openclaw than the installed CLI: what made the old
// fetching deploy run `npm update -g openclaw` on its own.
stub('npm', `case "$*" in
  "view openclaw version") echo "\${DEPLOY_TEST_NPM_OPENCLAW:-9.9.9}" ;;
  "prefix -g") echo "$DEPLOY_TEST_NPM_PREFIX" ;;
  "ci --omit=dev") echo "npm-path0 \${PATH%%:*}" >> "$DEPLOY_TEST_CALLS"; rm -rf node_modules; mkdir -p node_modules/nats ;;
  "rebuild better-sqlite3") echo "npm-path0 \${PATH%%:*}" >> "$DEPLOY_TEST_CALLS" ;;
  "run build") mkdir -p .next; echo partial > .next/BUILD_ID; [ -n "\${DEPLOY_TEST_BUILD_FAIL:-}" ] && exit 1; echo built > .next/BUILD_ID ;;
esac`);
stub('npx', `case "$*" in
  *" tsc -p packages/event-schemas/tsconfig.json") mkdir -p packages/event-schemas/dist; echo "built $(cat packages/event-schemas/src/events.ts)" > packages/event-schemas/dist/index.js ;;
  "-y npm@10 ci") rm -rf node_modules; mkdir -p node_modules ;;
esac`);
// The banner the published CLI prints for --version.
stub('openclaw', 'echo "OpenClaw ${DEPLOY_TEST_OPENCLAW:-1.0.0} (abcdef1)"');
stub('python3', '');
if (IS_MAC) {
  for (const label of ['ai.openclaw.mesh-agent', 'ai.openclaw.mission-control']) {
    write(HOME, `Library/LaunchAgents/${label}.plist`, '<plist/>\n');
  }
}

// What a node's clone needs to run bin/mesh-deploy.js.
const DEPLOY_SCRIPT_FILES = ['bin/mesh-deploy.js', 'lib/mesh-roles.js', 'lib/tracer.js', 'lib/obs-db.js', 'lib/node-id.js', 'lib/node-aliases.js',
  'scripts/install/retired-files.txt', 'scripts/install/mc-build.sh', 'scripts/install/deps.sh', 'scripts/install/helpers.sh'];
git(ROOT, 'init', '-q', '--bare', '-b', 'main', ORIGIN);
git(ROOT, 'init', '-q', '-b', 'main', SEED);
git(SEED, 'remote', 'add', 'origin', ORIGIN);
for (const rel of DEPLOY_SCRIPT_FILES) {
  write(SEED, rel, fs.readFileSync(path.join(REPO, rel)));
}
write(SEED, 'bin/mesh-agent.js', '// agent v0\n');
write(SEED, 'skills/demo/SKILL.md', '# demo v0\n');
write(SEED, 'skills/demo/old-name.md', 'renamed in v1\n');
write(SEED, 'skills/retired/SKILL.md', '# retired in v1\n');
write(SEED, 'identity/SOUL.md', '# soul v0\n');
write(SEED, 'mission-control/package.json', '{ "name": "mission-control" }\n');
write(SEED, 'mission-control/src/app/page.tsx', "export default () => 'v0';\n");
const S0 = commit('v0');
git(ROOT, 'clone', '-q', ORIGIN, NODE);

const require = createRequire(import.meta.url);
const { runDeploy } = require('../bin/mesh-deploy-listener.js');

const read = p => fs.readFileSync(p, 'utf8');
const calls = () => (fs.existsSync(CALLS) ? read(CALLS) : '');
const head = () => git(NODE, 'rev-parse', 'HEAD');
const state = () => JSON.parse(read(RT.state));
const trigger = (sha, extra = {}) => ({ sha: sha.slice(0, 7), branch: 'main', components: ['all'], initiator: 'lead-test', ...extra });
const restartOf = svc => (IS_MAC
  ? `launchctl kickstart -k gui/${process.getuid()}/ai.openclaw.${svc}`
  : `systemctl --user try-restart openclaw-${svc}`);

// File-level: the describes below all use ROOT's stubs and fixtures.
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

describe('pinned-sha deploy through the listener (bare origin + node clone)', () => {
  let S1, S2, S3;

  it('--force reinstalls every component at the signed sha even when nothing changed', async () => {
    const r = await runDeploy(trigger(S0, { force: true }));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.equal(head(), S0);
    const ids = r.componentsDeployed.map(c => c.id);
    for (const id of ['mesh-daemons', 'mesh-cli', 'shared-lib', 'mc', 'skills', 'workspace-docs']) {
      assert.ok(ids.includes(id), `${id} deployed (got ${ids.join(', ')})`);
    }
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v0\n');
    assert.equal(read(path.join(RT.skills, 'retired', 'SKILL.md')), '# retired in v1\n');
    // Mission Control as install.sh builds it: npm@10 ci and the native rebuild under the deploy's node.
    for (const call of ['npx -y npm@10 ci', 'npm rebuild better-sqlite3', 'npm run build']) {
      assert.ok(calls().includes(`${call} @ ${RT.mc}`), `${call}:\n${calls()}`);
    }
    assert.ok(calls().includes(`npm-path0 ${NODEBIN}`), calls());
    assert.equal(read(path.join(RT.mc, '.next', 'BUILD_ID')), 'built\n');
    assert.equal(state().deployedSha, S0);
    assert.equal(state().lastSha, null, 'a same-sha reinstall is not a version to roll back to');
  });

  it('deploys the diff from the last deployed sha: copies, deletions, renames, MC build, restarts', async () => {
    write(RT.workspace, 'SOUL.md', '# soul, edited on this node\n');
    fs.rmSync(CALLS, { force: true });
    write(SEED, 'bin/mesh-agent.js', '// agent v1\n');
    write(SEED, 'skills/demo/SKILL.md', '# demo v1\n');
    git(SEED, 'mv', 'skills/demo/old-name.md', 'skills/demo/new-name.md');
    git(SEED, 'rm', '-q', 'skills/retired/SKILL.md');
    write(SEED, 'identity/SOUL.md', '# soul v1\n');
    write(SEED, 'mission-control/src/app/page.tsx', "export default () => 'v1';\n");
    S1 = commit('v1');

    const r = await runDeploy(trigger(S1));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.equal(head(), S1, 'the node checked out the signed sha');
    assert.deepEqual(r.componentsDeployed.map(c => c.id).sort(), ['mc', 'mesh-daemons', 'skills']);

    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v1\n');
    assert.equal(read(path.join(RT.skills, 'demo', 'SKILL.md')), '# demo v1\n');
    assert.ok(fs.existsSync(path.join(RT.skills, 'demo', 'new-name.md')), 'rename target installed');
    assert.ok(!fs.existsSync(path.join(RT.skills, 'demo', 'old-name.md')), 'rename source removed');
    assert.ok(!fs.existsSync(path.join(RT.skills, 'retired')), 'deleted skill removed and its empty dir pruned');
    assert.equal(read(path.join(RT.mc, 'src', 'app', 'page.tsx')), "export default () => 'v1';\n");
    assert.ok(calls().includes(`npm run build @ ${RT.mc}`), calls());
    assert.ok(!calls().includes('npm@10 ci'), 'a source-only change keeps node_modules');
    assert.ok(calls().includes(restartOf('mesh-agent')), calls());
    assert.ok(calls().includes(restartOf('mission-control')), calls());

    assert.equal(read(path.join(RT.workspace, 'SOUL.md')), '# soul, edited on this node\n', 'preInstall veto kept the operator edit');
    assert.equal(read(path.join(RT.workspace, 'SOUL.md.repo')), '# soul v1\n');
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, S0);
  });

  it('a deploy whose daemon fails to restart rolls back to preSha and stays there', async () => {
    fs.rmSync(CALLS, { force: true });
    write(SEED, 'bin/mesh-agent.js', '// agent v2 BREAK_DEPLOY\n');
    write(SEED, 'skills/demo/SKILL.md', '# demo v2\n');
    S2 = commit('v2: its mesh-agent fails to start');

    const r = await runDeploy(trigger(S2));
    assert.equal(r.status, 'failed');
    assert.match(r.errors[0], /restart \S*mesh-agent\S* failed/);
    assert.equal(r.rolledBack, true, r.errors.join('; '));
    assert.equal(r.rollbackSha, S1.slice(0, 7));

    assert.equal(head(), S1, 'the tree is back on preSha');
    assert.equal(git(NODE, 'rev-parse', 'origin/main'), S2, 'the failed commit is still the branch tip — the rollback did not fetch its way back to it');
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v1\n');
    assert.equal(read(path.join(RT.skills, 'demo', 'SKILL.md')), '# demo v1\n');
    assert.equal(calls().split(restartOf('mesh-agent')).length - 1, 2, 'failed restart, then the rollback restart');
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, S0, 'rolling back off a failed sha does not make it the --rollback target');
  });

  it('a run that deploys nothing leaves lastSha alone', async () => {
    const r = await runDeploy(trigger(S1));
    assert.equal(r.status, 'success', r.errors.join('; '));
    assert.deepEqual(r.componentsDeployed, []);
    assert.equal(head(), S1);
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, S0);
  });

  it('catch-up never moves a node backward', async () => {
    const r = await runDeploy(trigger(S0), { forwardOnly: true });
    assert.equal(r.status, 'skipped');
    assert.equal(head(), S1);
  });

  it('a tree the pre-fix listener already fast-forwarded still deploys the diff from the recorded sha', () => {
    write(SEED, 'bin/mesh-agent.js', '// agent v3\n');
    write(SEED, 'skills/demo/SKILL.md', '# demo v3\n');
    S3 = commit('v3');
    // What the old listener did before handing over to `mesh-deploy.js --local`.
    git(NODE, 'fetch', '-q', 'origin', 'main');
    git(NODE, 'merge', '-q', '--ff-only', 'origin/main');
    execFileSync(process.execPath, [path.join(NODE, 'bin', 'mesh-deploy.js'), '--local'], { cwd: NODE, stdio: 'pipe' });

    assert.equal(head(), S3);
    assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v3\n');
    assert.equal(read(path.join(RT.skills, 'demo', 'SKILL.md')), '# demo v3\n');
    assert.equal(state().deployedSha, S3);
    assert.equal(state().lastSha, S1);
  });

  it('refuses a checkout whose tracked files differ from the signed sha, before anything moves', async () => {
    write(SEED, 'bin/mesh-agent.js', '// agent v4\n');
    const S4 = commit('v4');
    // The lead's listener runs on the operator's working checkout, at the HEAD it published.
    git(NODE, 'fetch', '-q', 'origin', 'main');
    git(NODE, 'checkout', '-q', '--detach', S4);
    write(NODE, 'bin/mesh-agent.js', '// WIP, uncommitted\n');
    try {
      const r = await runDeploy(trigger(S4));
      assert.equal(r.status, 'failed', 'an uncommitted edit is not deployed as the signed sha');
      assert.match(r.errors[0], /tracked files differ from the commit \(M bin\/mesh-agent\.js\)/);
      assert.equal(r.rolledBack, undefined, 'refused before anything was touched, so nothing to roll back');
      assert.equal(read(path.join(RT.bin, 'mesh-agent.js')), '// agent v3\n', 'the edit never reached the runtime');
      assert.equal(state().deployedSha, S3);
    } finally {
      git(NODE, 'checkout', '-q', '--', 'bin/mesh-agent.js');
      git(NODE, 'checkout', '-q', '--detach', S3);
    }
  });

  it('refuses a sha that is not on origin, and a checkout carrying unpushed commits', async () => {
    const unknown = await runDeploy(trigger('0123456789abcdef0123456789abcdef01234567'));
    assert.equal(unknown.status, 'failed');
    assert.match(unknown.errors[0], /not on origin\/main/);
    assert.equal(unknown.rolledBack, undefined, 'nothing was touched, so nothing to roll back');
    assert.equal(head(), S3);

    write(NODE, 'local.txt', 'work in progress\n');
    git(NODE, 'add', 'local.txt');
    git(NODE, 'commit', '-q', '-m', 'local work');
    const local = head();
    const r = await runDeploy(trigger(S2));
    assert.equal(r.status, 'failed');
    assert.match(r.errors[0], /not on origin\/main — refusing to move this checkout/);
    assert.equal(head(), local, 'the checkout was left where it was');
  });
});

// ── Independent nodes, bin/mesh-deploy.js run directly ──────────────────────
// Each case below gets its own origin, clone and runtime HOME, and runs the
// clone's deploy script as the listener does (`--local --to <sha>`) or as
// `mesh deploy` does on the node itself (`--local`).

function makeNode(name, files) {
  const dir = path.join(ROOT, name);
  const fx = {
    home: path.join(dir, 'home'), origin: path.join(dir, 'origin.git'), seed: path.join(dir, 'seed'),
    node: path.join(dir, 'node'), callLog: path.join(dir, 'calls.log'),
  };
  fx.rt = rel => path.join(fx.home, rel);
  fx.commit = (message, changed) => {
    for (const [rel, content] of Object.entries(changed)) write(fx.seed, rel, content);
    git(fx.seed, 'add', '-A');
    git(fx.seed, 'commit', '-q', '-m', message);
    git(fx.seed, 'push', '-q', 'origin', 'main');
    // Pinned mode never fetches: the listener brings the sha in first, and so does this.
    if (fs.existsSync(fx.node)) git(fx.node, 'fetch', '-q', 'origin', 'main');
    return git(fx.seed, 'rev-parse', 'HEAD');
  };
  fx.deploy = (args, env = {}) => spawnSync(process.execPath,
    ['--require', PRELOAD, path.join(fx.node, 'bin', 'mesh-deploy.js'), '--local', ...args], {
      cwd: fx.node, encoding: 'utf8',
      env: { ...process.env, HOME: fx.home, OPENCLAW_REPO_DIR: fx.node, DEPLOY_TEST_CALLS: fx.callLog, ...env },
    });
  // Each stub call as logged, without the " @ <cwd>" suffix.
  fx.calls = () => (fs.existsSync(fx.callLog) ? read(fx.callLog) : '').split('\n').filter(Boolean).map(l => l.split(' @ ')[0]);
  git(ROOT, 'init', '-q', '--bare', '-b', 'main', fx.origin);
  git(ROOT, 'init', '-q', '-b', 'main', fx.seed);
  git(fx.seed, 'remote', 'add', 'origin', fx.origin);
  const script = Object.fromEntries(DEPLOY_SCRIPT_FILES.map(rel => [rel, fs.readFileSync(path.join(REPO, rel))]));
  fx.S0 = fx.commit('v0', { ...script, ...files });
  git(ROOT, 'clone', '-q', fx.origin, fx.node);
  return fx;
}
const ranOk = run => assert.equal(run.status, 0, `deploy failed:\n${run.stdout}\n${run.stderr}`);
const resultOf = run => JSON.parse(run.stdout.split('\n').find(l => l.startsWith('DEPLOY_RESULT ')).slice('DEPLOY_RESULT '.length));
const fileMode = p => fs.statSync(p).mode & 0o777;

describe('`mesh deploy --force` on a live node leaves what the node owns alone', () => {
  // A worker with a live node's state: an operator-configured openclaw.json,
  // learned soul genes and events, and a repo that carries a quarantined skill.
  const LIVE_CONFIG = '{"gateway":"configured on this node: channels, tokens, auth profiles"}\n';
  const LEARNED_GENES = '{"genes":"learned on this node"}\n';
  const LEARNED_EVENTS = '{"event":"learned on this node"}\n';
  let fx, run;
  before(() => {
    fx = makeNode('force', {
      'bin/mesh-agent.js': '// agent v0\n',
      'config/openclaw.json.template': '{"workspace":"${OPENCLAW_WORKSPACE}"}\n',
      'souls/daedalus/evolution/genes.json': '{"genes":"seed"}\n',
      'souls/daedalus/evolution/events.jsonl': '{"event":"seed"}\n',
      'souls/newcomer/evolution/genes.json': '{"genes":"newcomer seed"}\n',
      'skills/demo/SKILL.md': '# demo\n',
      'skills/mesh/SKILL.md': '# mesh\n',
      'skills/dist/demo.skill': 'packaged\n',
      'skills/scripts/golden.sh': '#!/bin/sh\n',
      'skills/_quarantine/memorylayer/SKILL.md': '# quarantined: ships memory to a SaaS\n',
      'skills/demo/scripts/run.sh': '#!/bin/sh\n',
    });
    // What earlier deploys left in the managed dir, beside an operator's own skill
    // and the mesh skill integrations.sh installs there on purpose.
    write(fx.home, '.openclaw/skills/demo/SKILL.md', '# demo, stale managed copy\n');
    write(fx.home, '.openclaw/skills/dist/demo.skill', 'packaged\n');
    write(fx.home, '.openclaw/skills/mesh/SKILL.md', '# mesh\n');
    write(fx.home, '.openclaw/skills/operator-own/SKILL.md', '# mine\n');
    // Installed before memorylayer was quarantined and deep-research deleted.
    write(fx.home, '.openclaw/skills/memorylayer/SKILL.md', '# memorylayer, stale managed copy\n');
    write(fx.home, '.openclaw/workspace/skills/memorylayer/SKILL.md', '# memorylayer, workspace copy\n');
    write(fx.home, '.openclaw/workspace/skills/deep-research/SKILL.md', '# deep-research, workspace copy\n');
    write(fx.home, '.openclaw/openclaw.json', LIVE_CONFIG);
    write(fx.home, '.openclaw/openclaw.env', 'DISCORD_BOT_TOKEN=discord-fixture\n');
    write(fx.home, '.openclaw/souls/daedalus/evolution/genes.json', LEARNED_GENES);
    write(fx.home, '.openclaw/souls/daedalus/evolution/events.jsonl', LEARNED_EVENTS);
    // The fetching flow: what `mesh deploy --force` runs on the node itself,
    // and what the pre-fix listener ran for every trigger.
    run = fx.deploy(['--force'], { OPENCLAW_NODE_ROLE: 'worker' });
  });

  it('reinstalls the node and succeeds', () => {
    ranOk(run);
    assert.equal(read(fx.rt('.openclaw/workspace/skills/demo/SKILL.md')), '# demo\n');
  });

  it('leaves openclaw.json alone when its template did not change: no rewrite, no backup', () => {
    assert.equal(read(fx.rt('.openclaw/openclaw.json')), LIVE_CONFIG);
    assert.deepEqual(fs.readdirSync(fx.rt('.openclaw')).filter(f => f.startsWith('openclaw.json.bak')), []);
  });

  it('never overwrites learned soul genes or events, and seeds a soul that has none', () => {
    assert.equal(read(fx.rt('.openclaw/souls/daedalus/evolution/genes.json')), LEARNED_GENES);
    assert.equal(read(fx.rt('.openclaw/souls/daedalus/evolution/events.jsonl')), LEARNED_EVENTS);
    assert.equal(read(fx.rt('.openclaw/souls/newcomer/evolution/genes.json')), '{"genes":"newcomer seed"}\n');
  });

  it('ships skills to the workspace dir install.sh uses, without dist/ or the top-level scripts/', () => {
    assert.ok(fs.existsSync(fx.rt('.openclaw/workspace/skills/mesh/SKILL.md')));
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/skills/dist')), 'skills/dist shipped');
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/skills/scripts')), 'skills/scripts shipped');
    assert.equal(read(fx.rt('.openclaw/workspace/skills/demo/scripts/run.sh')), '#!/bin/sh\n', 'a skill keeps its own scripts/');
  });

  it('archives the stale managed copies it used to deploy, keeping mesh and operator skills', () => {
    const archives = fs.readdirSync(fx.rt('.openclaw')).filter(f => f.startsWith('skills.retired-'));
    assert.equal(archives.length, 1);
    const archive = fx.rt(`.openclaw/${archives[0]}`);
    assert.equal(read(path.join(archive, 'demo', 'SKILL.md')), '# demo, stale managed copy\n');
    assert.ok(fs.existsSync(path.join(archive, 'dist', 'demo.skill')));
    assert.equal(read(path.join(archive, 'memorylayer', 'SKILL.md')), '# memorylayer, stale managed copy\n');
    assert.deepEqual(fs.readdirSync(fx.rt('.openclaw/skills')).sort(), ['mesh', 'operator-own']);
  });

  it('archives the workspace copies of quarantined and deleted skills where install.sh does', () => {
    const [dated] = fs.readdirSync(fx.rt('.openclaw/retired'));
    const archive = fx.rt(`.openclaw/retired/${dated}/skills`);
    assert.equal(read(path.join(archive, 'memorylayer', 'SKILL.md')), '# memorylayer, workspace copy\n');
    assert.equal(read(path.join(archive, 'deep-research', 'SKILL.md')), '# deep-research, workspace copy\n');
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/skills/memorylayer')));
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/skills/deep-research')));
  });

  it('never installs skills/_quarantine', () => {
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/skills/_quarantine')), 'the quarantined skill reached the node');
  });

  it('never runs npm or the openclaw CLI: no implicit, unpinned CLI update', () => {
    assert.deepEqual(fx.calls().filter(l => /^(npm|openclaw) /.test(l)), []);
  });
});

describe('openclaw.json is rewritten only from a changed template, rendered as the installer renders it', () => {
  const LIVE_CONFIG = '{"gateway":"configured on this node"}\n';
  const TEMPLATE = v => `{"workspace":"\${OPENCLAW_WORKSPACE}","token":"\${DISCORD_BOT_TOKEN}","unset":"\${DEPLOY_TEST_UNSET}","v":${v}}\n`;
  let fx, S1, S2;
  const config = () => fx.rt('.openclaw/openclaw.json');
  const backups = () => fs.readdirSync(fx.rt('.openclaw')).filter(f => f.startsWith('openclaw.json.bak.'));
  before(() => {
    fx = makeNode('config', { 'config/openclaw.json.template': TEMPLATE(0), 'config/daemon.json.template': '{"v":0}\n' });
    // An earlier deploy installed the template; the operator has since configured the gateway.
    write(fx.home, '.openclaw/config/openclaw.json.template', TEMPLATE(0));
    write(fx.home, '.openclaw/openclaw.json', LIVE_CONFIG);
    write(fx.home, '.openclaw/openclaw.env', '# node secrets\nDISCORD_BOT_TOKEN="discord-fixture"\n');
  });

  it('a diff that changes another config/ file leaves openclaw.json alone', () => {
    S1 = fx.commit('v1: daemon template', { 'config/daemon.json.template': '{"v":1}\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1]));
    assert.equal(read(config()), LIVE_CONFIG);
    assert.deepEqual(backups(), []);
  });

  it('a diff that changes the template re-renders it, after a timestamped 0600 backup', () => {
    S2 = fx.commit('v2: template', { 'config/openclaw.json.template': TEMPLATE(2) });
    ranOk(fx.deploy(['--from', S1, '--to', S2]));
    const text = read(config());
    assert.ok(!text.includes('${'), `a placeholder was left in: ${text}`);
    assert.deepEqual(JSON.parse(text), { workspace: fx.rt('.openclaw/workspace'), token: 'discord-fixture', unset: '', v: 2 });
    assert.equal(fileMode(config()), 0o600);
    assert.equal(backups().length, 1);
    const backup = fx.rt(path.join('.openclaw', backups()[0]));
    assert.equal(read(backup), LIVE_CONFIG);
    assert.equal(fileMode(backup), 0o600);
  });

  it('a missing openclaw.json is generated by a same-sha reinstall', () => {
    fs.rmSync(config());
    ranOk(fx.deploy(['--from', S2, '--to', S2, '--force']));
    assert.equal(JSON.parse(read(config())).workspace, fx.rt('.openclaw/workspace'));
    assert.equal(fileMode(config()), 0o600);
    assert.equal(backups().length, 1, 'nothing existed to back up');
  });

  it('renders the node workspace from OPENCLAW_WORKSPACE, not the default path', () => {
    fs.rmSync(config());
    const workspace = fx.rt('custom-workspace');
    ranOk(fx.deploy(['--from', S2, '--to', S2, '--force'], { OPENCLAW_WORKSPACE: workspace }));
    assert.equal(JSON.parse(read(config())).workspace, workspace);
  });
});

describe('the openclaw CLI is installed only when named, and only at a pinned version', () => {
  let fx, prefix, lockedPrefix;
  const npmCalls = () => fx.calls().filter(l => l.startsWith('npm '));
  const installOpenclaw = (env, ...args) => {
    fs.rmSync(fx.callLog, { force: true });
    return fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'openclaw', ...args], env);
  };
  before(() => {
    fx = makeNode('openclaw-cli', { 'bin/mesh-agent.js': '// agent v0\n' });
    prefix = path.join(ROOT, 'openclaw-cli', 'npm-prefix');
    fs.mkdirSync(path.join(prefix, 'lib', 'node_modules'), { recursive: true });
    lockedPrefix = path.join(ROOT, 'openclaw-cli', 'npm-prefix-root-owned');
    fs.mkdirSync(path.join(lockedPrefix, 'lib', 'node_modules'), { recursive: true });
  });

  it('`--component openclaw` refuses without an exact OPENCLAW_CLI_VERSION', () => {
    for (const version of [undefined, 'latest', '^1.2.0']) {
      const run = installOpenclaw({ OPENCLAW_CLI_VERSION: version, DEPLOY_TEST_NPM_PREFIX: prefix });
      assert.equal(run.status, 1, `OPENCLAW_CLI_VERSION=${version}:\n${run.stdout}`);
      assert.match(run.stdout, /DEPLOY_ERROR .*OPENCLAW_CLI_VERSION/);
      assert.deepEqual(npmCalls(), []);
    }
  });

  it('installs exactly the pinned version', () => {
    ranOk(installOpenclaw({ OPENCLAW_CLI_VERSION: '2026.9.1', DEPLOY_TEST_NPM_PREFIX: prefix }));
    assert.deepEqual(npmCalls(), ['npm prefix -g', 'npm install -g openclaw@2026.9.1']);
  });

  // NodeSource and system npm put the global prefix under /usr; install.sh
  // runs every global install there with sudo.
  it('refuses with the sudo command when the global prefix is not writable', {
    skip: process.getuid?.() === 0 && 'root can write any directory',
  }, () => {
    fs.chmodSync(path.join(lockedPrefix, 'lib', 'node_modules'), 0o555);
    try {
      const env = { OPENCLAW_CLI_VERSION: '2026.9.1', DEPLOY_TEST_NPM_PREFIX: lockedPrefix };
      const run = installOpenclaw(env);
      assert.equal(run.status, 1, run.stdout);
      assert.match(run.stdout, /DEPLOY_ERROR .*not writable by this user — run: sudo npm install -g openclaw@2026\.9\.1/);
      assert.deepEqual(npmCalls(), ['npm prefix -g']);
      const dry = installOpenclaw(env, '--dry-run');
      ranOk(dry);
      assert.match(dry.stdout, /Would refuse: the global npm prefix .* is not writable by this user/);
      assert.deepEqual(npmCalls(), ['npm prefix -g']);
    } finally {
      fs.chmodSync(path.join(lockedPrefix, 'lib', 'node_modules'), 0o755);
    }
  });
});

describe('mesh-deploy --status compares the OpenClaw version, not the --version banner', () => {
  let fx;
  before(() => { fx = makeNode('status', { 'bin/mesh-agent.js': '// agent v0\n' }); });
  const status = (installed, latest) => {
    const run = fx.deploy(['--status'], { DEPLOY_TEST_OPENCLAW: installed, DEPLOY_TEST_NPM_OPENCLAW: latest });
    ranOk(run);
    return run.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  };

  it('reports no update when the installed CLI is the registry version', () => {
    assert.doesNotMatch(status('2026.11.6', '2026.11.6'), /Update available: OpenClaw Gateway/);
  });

  it('reports a newer registry version against the bare installed version', () => {
    const out = status('2026.11.6', '2026.11.7');
    assert.match(out, /Update available: OpenClaw Gateway\n {4}Current: 2026\.11\.6\n {4}Latest: {2}2026\.11\.7\n/);
  });
});

// Without --all, compile-boot prints the main profile to stdout and writes
// nothing under .boot/; install.sh copies boot/manifest.yaml there.
describe('boot profiles are recompiled with --all after a compiler, manifest or AGENTS.md change', () => {
  let fx, S1, S2, S3;
  const compileAll = () => `python3 ${fx.rt('.openclaw/workspace/bin/compile-boot')} --all`;
  const pythonCalls = () => fx.calls().filter(l => l.startsWith('python3 '));
  before(() => {
    fx = makeNode('boot', {
      'bin/mesh-agent.js': '// agent v0\n',
      'workspace-bin/compile-boot': '#!/usr/bin/env python3\n# v0\n',
      'boot/manifest.yaml': 'profiles: {}\n',
      'identity/AGENTS.md': '# agents v0\n',
    });
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--force']));
  });

  it('a compiler change recompiles every profile', () => {
    fs.rmSync(fx.callLog, { force: true });
    S1 = fx.commit('v1: compiler', { 'workspace-bin/compile-boot': '#!/usr/bin/env python3\n# v1\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1]));
    assert.deepEqual(pythonCalls(), [compileAll()]);
  });

  it('a manifest change installs .boot/manifest.yaml and recompiles', () => {
    fs.rmSync(fx.callLog, { force: true });
    S2 = fx.commit('v2: manifest', { 'boot/manifest.yaml': 'profiles: {v: 2}\n' });
    const run = fx.deploy(['--from', S1, '--to', S2]);
    ranOk(run);
    assert.equal(read(fx.rt('.openclaw/workspace/.boot/manifest.yaml')), 'profiles: {v: 2}\n');
    assert.ok(resultOf(run).components.some(c => c.id === 'boot-manifest'), run.stdout);
    assert.deepEqual(pythonCalls(), [compileAll()]);
  });

  it('an AGENTS.md that reaches the workspace recompiles; one this node keeps does not', () => {
    fs.rmSync(fx.callLog, { force: true });
    fs.rmSync(fx.rt('.openclaw/workspace/AGENTS.md'));
    S3 = fx.commit('v3: agents', { 'identity/AGENTS.md': '# agents v3\n' });
    ranOk(fx.deploy(['--from', S2, '--to', S3]));
    assert.equal(read(fx.rt('.openclaw/workspace/AGENTS.md')), '# agents v3\n');
    assert.deepEqual(pythonCalls(), [compileAll()]);

    fs.rmSync(fx.callLog, { force: true });
    write(fx.home, '.openclaw/workspace/AGENTS.md', '# agents, edited on this node\n');
    const S4 = fx.commit('v4: agents', { 'identity/AGENTS.md': '# agents v4\n' });
    ranOk(fx.deploy(['--from', S3, '--to', S4]));
    assert.deepEqual(pythonCalls(), []);
  });
});

// The fleet half of `mesh deploy` with fleet-deploy and nats replaced: what
// fleetDeploy reports, or a bus that refuses the connect, decides the summary
// line and the exit status.
const FLEET_STUB = path.join(ROOT, 'fleet-stub.cjs');
write(ROOT, 'fleet-stub.cjs', `
const Module = require('module');
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request.endsWith('/fleet-deploy')) return { fleetDeploy: async () => JSON.parse(process.env.DEPLOY_TEST_FLEET_OUTCOME) };
  if (request.endsWith('/nats-resolve')) return { natsConnectOpts: o => o };
  if (request === 'nats') return { connect: async () => {
    if (process.env.DEPLOY_TEST_NATS_DOWN) throw new Error('connect ECONNREFUSED 127.0.0.1:4222');
    return { close: async () => {} };
  } };
  return load.call(this, request, ...rest);
};
`);

describe('mesh deploy reports the fleet outcome in its summary and exit status', () => {
  let fx;
  const outcome = o => JSON.stringify({ expected: 1, succeeded: 0, skipped: 0, failed: 0, missing: 0, stillDeploying: 0, ...o });
  const deployFleet = env => {
    const run = spawnSync(process.execPath, ['--require', FLEET_STUB, path.join(fx.node, 'bin', 'mesh-deploy.js')], {
      cwd: fx.node, encoding: 'utf8',
      env: { ...process.env, HOME: fx.home, OPENCLAW_REPO_DIR: fx.node, DEPLOY_TEST_CALLS: fx.callLog, ...env },
    });
    return { ...run, stdout: run.stdout.replace(/\x1b\[[0-9;]*m/g, '') };
  };
  before(() => { fx = makeNode('fleet-outcome', { 'bin/mesh-agent.js': '// agent v0\n' }); });

  it('a failed node fails the run', () => {
    const run = deployFleet({ DEPLOY_TEST_FLEET_OUTCOME: outcome({ failed: 1 }) });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /Remote:\s+FAILED \(1 of 1 node/);
    assert.doesNotMatch(run.stdout, /Remote:\s+deployed/);
  });

  it('an unreachable bus fails the run', () => {
    const run = deployFleet({ DEPLOY_TEST_NATS_DOWN: '1' });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /Fleet deploy failed: connect ECONNREFUSED/);
    assert.match(run.stdout, /Remote:\s+FAILED/);
  });

  it('a node pending catch-up is partial, not a failure', () => {
    const run = deployFleet({ DEPLOY_TEST_FLEET_OUTCOME: outcome({ missing: 1 }) });
    ranOk(run);
    assert.match(run.stdout, /Remote:\s+partial \(1 pending catch-up, 0 still deploying\)/);
  });

  it('every node succeeded or skipped: deployed', () => {
    const run = deployFleet({ DEPLOY_TEST_FLEET_OUTCOME: outcome({ expected: 2, succeeded: 1, skipped: 1 }) });
    ranOk(run);
    assert.match(run.stdout, /Remote:\s+deployed/);
  });
});

describe('a deploy restarts only the services that are running', () => {
  let fx, S1;
  before(() => {
    fx = makeNode('restart', { 'bin/mesh-agent.js': '// agent v0\n' });
    for (const label of ['ai.openclaw.mesh-agent', 'ai.openclaw.mesh-health-publisher']) {
      write(fx.home, `Library/LaunchAgents/${label}.plist`, '<plist/>\n');
    }
  });

  it('systemd: an inactive unit is left stopped, a running one gets try-restart', () => {
    S1 = fx.commit('v1', { 'bin/mesh-agent.js': '// agent v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], {
      DEPLOY_TEST_PLATFORM: 'linux',
      DEPLOY_TEST_UNITS: 'openclaw-mesh-agent openclaw-mesh-health-publisher',
      DEPLOY_TEST_STOPPED: 'openclaw-mesh-agent', // autostart:false — the operator starts it
    });
    ranOk(run);
    const systemctl = fx.calls().filter(l => l.startsWith('systemctl '));
    assert.ok(systemctl.includes('systemctl --user try-restart openclaw-mesh-health-publisher'), systemctl.join('\n'));
    assert.deepEqual(systemctl.filter(l => /start openclaw-mesh-agent$/.test(l)), [], 'the stopped unit was started');
    assert.match(run.stdout, /openclaw-mesh-agent not running \(inactive\) — left stopped/);
    assert.doesNotMatch(run.stdout, /Restarted openclaw-mesh-agent/);
    assert.deepEqual(resultOf(run).restarted, ['openclaw-mesh-health-publisher']);
  });

  it('launchd: a stopped agent is neither loaded nor kickstarted, a running one gets kickstart -k', () => {
    fs.rmSync(fx.callLog, { force: true });
    const S2 = fx.commit('v2', { 'bin/mesh-agent.js': '// agent v2\n' });
    const run = fx.deploy(['--from', S1, '--to', S2], {
      DEPLOY_TEST_PLATFORM: 'darwin',
      DEPLOY_TEST_STOPPED: 'ai.openclaw.mesh-agent', // RunAtLoad=false, not started by hand
    });
    ranOk(run);
    const uid = process.getuid();
    const launchctl = fx.calls().filter(l => l.startsWith('launchctl '));
    assert.ok(launchctl.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.mesh-health-publisher`), launchctl.join('\n'));
    assert.deepEqual(launchctl.filter(l => /^launchctl (load|unload) /.test(l)), [], 'unload/load kills a hand-started agent');
    assert.ok(!launchctl.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.mesh-agent`), 'the stopped agent was started');
    assert.match(run.stdout, /ai\.openclaw\.mesh-agent not running — left stopped/);
    assert.deepEqual(resultOf(run).restarted, ['ai.openclaw.mesh-health-publisher']);
  });
});

describe('a deploy installs the commit, never the working tree', () => {
  let fx, S1;
  const nodeHead = () => git(fx.node, 'rev-parse', 'HEAD');
  before(() => {
    fx = makeNode('dirty', { 'bin/mesh-agent.js': '// agent v0\n', 'skills/demo/SKILL.md': '# demo v0\n' });
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'all']));
    S1 = fx.commit('v1', { 'bin/mesh-agent.js': '// agent v1\n' });
  });

  it('`mesh deploy` refuses a tracked edit before fast-forwarding, and installs nothing', () => {
    // Unchanged S0 → S1, so a fast-forward would carry it and --force would install it.
    write(fx.node, 'skills/demo/SKILL.md', '# demo, edited in the checkout\n');
    try {
      const run = fx.deploy(['--force']);
      assert.equal(run.status, 1, run.stdout);
      assert.match(run.stdout, /DEPLOY_ERROR .*tracked files in .* differ from the commit \(M skills\/demo\/SKILL\.md\)/);
      assert.equal(nodeHead(), fx.S0, 'the branch was not fast-forwarded');
      assert.equal(read(fx.rt('.openclaw/workspace/skills/demo/SKILL.md')), '# demo v0\n');
      assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v0\n');
    } finally {
      git(fx.node, 'checkout', '-q', '--', 'skills/demo/SKILL.md');
    }
  });

  it('a pinned deploy refuses an uncommitted edit at the target sha; untracked files and mode-only changes do not block', () => {
    git(fx.node, 'checkout', '-q', '--detach', S1);
    write(fx.node, 'bin/mesh-agent.js', '// WIP, uncommitted\n');
    const refused = fx.deploy(['--from', fx.S0, '--to', S1]);
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stdout, /DEPLOY_ERROR .*differ from the commit \(M bin\/mesh-agent\.js\)/);
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v0\n', 'the WIP edit reached the runtime');
    assert.equal(JSON.parse(read(fx.rt('.openclaw/.deploy-state.json'))).deployedSha, fx.S0);

    git(fx.node, 'checkout', '-q', '--', 'bin/mesh-agent.js');
    write(fx.node, 'notes/scratch.txt', 'untracked — nothing installs it\n');
    fs.chmodSync(path.join(fx.node, 'skills', 'demo', 'SKILL.md'), 0o755); // as the installer's chmod +x does
    ranOk(fx.deploy(['--from', fx.S0, '--to', S1]));
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v1\n');
  });
});

describe('--dry-run writes nothing into the workspace', () => {
  let fx, run;
  before(() => {
    fx = makeNode('dry-run', { 'identity/SOUL.md': '# soul v0\n' });
    write(fx.home, '.openclaw/workspace/SOUL.md', '# soul, edited on this node\n');
    const S1 = fx.commit('v1', { 'identity/SOUL.md': '# soul v1\n' });
    run = fx.deploy(['--from', fx.S0, '--to', S1, '--dry-run']);
  });

  it('reports the local edit without saving a .repo copy', () => {
    ranOk(run);
    assert.match(run.stdout, /SOUL\.md differs from repo version/);
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/SOUL.md.repo')));
    assert.equal(read(fx.rt('.openclaw/workspace/SOUL.md')), '# soul, edited on this node\n');
  });
});

describe('a lib/ deploy restarts every daemon that loads lib, and the listener only from outside itself', () => {
  const LIB_UNITS = 'openclaw-mesh-task-daemon openclaw-mesh-bridge openclaw-mesh-agent ' +
    'openclaw-mesh-health-publisher openclaw-mesh-tool-discord openclaw-mesh-deploy-listener';
  let fx;
  before(() => {
    fx = makeNode('lib-restarts', { 'bin/mesh-agent.js': '// agent v0\n', 'lib/shared.js': '// v0\n' });
    for (const svc of ['mesh-health-publisher', 'mesh-tool-discord', 'mesh-deploy-listener']) {
      write(fx.home, `Library/LaunchAgents/ai.openclaw.${svc}.plist`, '<plist/>\n');
    }
  });

  it('systemd, pinned (the listener\'s child): health publisher and Discord tool restart; the listener restart is deferred', () => {
    fs.rmSync(fx.callLog, { force: true });
    const S1 = fx.commit('v1: lib', { 'lib/shared.js': '// v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: LIB_UNITS });
    ranOk(run);
    const systemctl = fx.calls().filter(l => l.startsWith('systemctl '));
    for (const svc of ['openclaw-mesh-health-publisher', 'openclaw-mesh-tool-discord']) {
      assert.ok(systemctl.includes(`systemctl --user try-restart ${svc}`), `${svc} kept the old lib:\n${systemctl.join('\n')}`);
    }
    assert.deepEqual(systemctl.filter(l => /restart openclaw-mesh-deploy-listener$/.test(l)), [],
      'a pinned deploy restarted the listener that runs it');
    assert.deepEqual(resultOf(run).deferredRestart, ['openclaw-mesh-deploy-listener']);
  });

  it('launchd, pinned: the same, with launchd labels', () => {
    fs.rmSync(fx.callLog, { force: true });
    const S1 = git(fx.node, 'rev-parse', 'HEAD');
    const S2 = fx.commit('v2: lib', { 'lib/shared.js': '// v2\n' });
    const run = fx.deploy(['--from', S1, '--to', S2], { DEPLOY_TEST_PLATFORM: 'darwin' });
    ranOk(run);
    const uid = process.getuid();
    const launchctl = fx.calls().filter(l => l.startsWith('launchctl kickstart'));
    for (const svc of ['mesh-health-publisher', 'mesh-tool-discord']) {
      assert.ok(launchctl.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.${svc}`), launchctl.join('\n'));
    }
    assert.ok(!launchctl.some(l => l.endsWith('ai.openclaw.mesh-deploy-listener')), launchctl.join('\n'));
    assert.deepEqual(resultOf(run).deferredRestart, ['ai.openclaw.mesh-deploy-listener']);
  });

  it('a deploy run from a shell (not the listener) restarts the listener in place', () => {
    fs.rmSync(fx.callLog, { force: true });
    git(fx.node, 'checkout', '-q', 'main');
    fx.commit('v3: listener', { 'bin/mesh-deploy-listener.js': '// listener v3\n' });
    const run = fx.deploy([], { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: LIB_UNITS });
    ranOk(run);
    assert.ok(resultOf(run).restarted.includes('openclaw-mesh-deploy-listener'), run.stdout);
    assert.deepEqual(resultOf(run).deferredRestart, []);
  });
});

describe('the listener schedules its own restart outside its own process tree', () => {
  const require = createRequire(import.meta.url);
  const { scheduleSelfRestart } = require('../bin/mesh-deploy-listener.js');
  const recorder = () => {
    const spawned = [];
    const spawnFn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { on() {}, unref() {} }; };
    return { spawned, spawnFn };
  };

  it('systemd: a transient timer restarts the unit after a delay', () => {
    const { spawned, spawnFn } = recorder();
    assert.deepEqual(scheduleSelfRestart(['openclaw-mesh-deploy-listener'], { platform: 'linux', spawnFn }), ['openclaw-mesh-deploy-listener']);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].cmd, 'systemd-run');
    assert.deepEqual(spawned[0].args, ['--user', '--on-active=10s', '--', 'systemctl', '--user', 'restart', 'openclaw-mesh-deploy-listener']);
    assert.equal(spawned[0].opts.detached, true);
  });

  it('launchd: a detached child kickstarts the job after a delay', () => {
    const { spawned, spawnFn } = recorder();
    scheduleSelfRestart(['ai.openclaw.mesh-deploy-listener'], { platform: 'darwin', spawnFn, uid: 501 });
    assert.equal(spawned[0].cmd, '/bin/sh');
    assert.match(spawned[0].args[1], /^sleep 10; exec launchctl kickstart -k "\$1"$/);
    assert.equal(spawned[0].args.at(-1), 'gui/501/ai.openclaw.mesh-deploy-listener');
    assert.equal(spawned[0].opts.detached, true);
  });

  it('restarts nothing but the listener itself', () => {
    const { spawned, spawnFn } = recorder();
    assert.deepEqual(scheduleSelfRestart(['openclaw-mesh-agent', 'x; rm -rf /'], { platform: 'linux', spawnFn }), []);
    assert.equal(spawned.length, 0);
  });
});

describe('a deploy that changes config/harness-rules.json merges it into the file mesh-agent reads', () => {
  const rules = enforcement => JSON.stringify([
    { id: 'scan', description: 'upstream', content: 'upstream text', mesh_enforcement: enforcement },
  ], null, 2) + '\n';
  let fx, run;
  const live = () => fx.rt('.openclaw/harness-rules.json');
  before(() => {
    fx = makeNode('harness', {
      'bin/harness-sync.js': fs.readFileSync(path.join(REPO, 'bin/harness-sync.js')),
      'config/harness-rules.json': rules('warn'),
    });
    // Installed by install.sh, then edited on this node.
    write(fx.home, '.openclaw/harness-rules.json', JSON.stringify([
      { id: 'scan', description: 'upstream', content: 'edited on this node', mesh_enforcement: 'warn' },
      { id: 'mine', description: 'a rule only this node has' },
    ], null, 2) + '\n');
    const S1 = fx.commit('v1: enforce', { 'config/harness-rules.json': rules('block') });
    run = fx.deploy(['--from', fx.S0, '--to', S1], {
      DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: 'openclaw-mesh-agent',
    });
  });

  it('source-owned fields reach the live rules; the node\'s edits and own rules stay', () => {
    ranOk(run);
    const merged = JSON.parse(read(live()));
    const scan = merged.find(r => r.id === 'scan');
    assert.equal(scan.mesh_enforcement, 'block', 'the new enforcement never reached the node');
    assert.equal(scan.content, 'edited on this node');
    assert.ok(merged.some(r => r.id === 'mine'));
  });

  it('restarts mesh-agent, which caches the rules', () => {
    assert.ok(fx.calls().includes('systemctl --user try-restart openclaw-mesh-agent'), fx.calls().join('\n'));
  });

  it('no longer copies the rules into the unread ~/.openclaw/config', () => {
    assert.ok(!fs.existsSync(fx.rt('.openclaw/config/harness-rules.json')));
  });
});

describe('workspace agent docs come from identity/, as install.sh installs them', () => {
  const DOCS = ['CLAUDE', 'SOUL', 'PRINCIPLES', 'AGENTS', 'DELEGATION', 'HEARTBEAT', 'MEMORY_SPEC', 'TOOLS'];
  let fx, run;
  const ws = f => fx.rt(path.join('.openclaw/workspace', f));
  before(() => {
    fx = makeNode('identity-docs', Object.fromEntries(DOCS.map(d => [`identity/${d}.md`, `# ${d} v0\n`])));
    write(fx.home, '.openclaw/workspace/AGENTS.md', '# AGENTS, edited on this node\n');
    run = fx.deploy(['--from', fx.S0, '--to', fx.S0, '--component', 'workspace-docs']);
  });

  it('installs install.sh\'s eight docs into the workspace', () => {
    ranOk(run);
    for (const d of DOCS.filter(d => d !== 'AGENTS')) assert.equal(read(ws(`${d}.md`)), `# ${d} v0\n`, d);
  });

  it('keeps a node-edited doc and saves the repo copy beside it, without holding back the others', () => {
    assert.equal(read(ws('AGENTS.md')), '# AGENTS, edited on this node\n');
    assert.equal(read(ws('AGENTS.md.repo')), '# AGENTS v0\n');
  });

  it('--force writes nothing into the unread ~/.openclaw/identity', () => {
    ranOk(fx.deploy(['--from', fx.S0, '--to', fx.S0, '--force']));
    assert.ok(!fs.existsSync(fx.rt('.openclaw/identity')), 'identity docs were copied into a directory nothing reads');
  });
});

describe('a deploy updates the workspace runtime the memory daemon and node-watch run from', () => {
  const UNITS = 'openclaw-memory-daemon openclaw-node-watch';
  let fx, S1, S2;
  const ws = rel => fx.rt(path.join('.openclaw/workspace', rel));
  before(() => {
    fx = makeNode('workspace-runtime', {
      'lib/memory-store.mjs': '// v0\n',
      'workspace-bin/session-recap': '#!/bin/sh\n# v0\n',
      'workspace-bin/archive-transcripts.sh': '# timer v0\n',
      'bin/node-watch.mjs': '// v0\n',
      'bin/observer.mjs': '// timer v0\n',
    });
  });

  it('lib/ reaches the workspace lib, and the daemons that import it restart', () => {
    S1 = fx.commit('v1: lib', { 'lib/memory-store.mjs': '// v1\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: UNITS });
    ranOk(run);
    assert.equal(read(ws('lib/memory-store.mjs')), '// v1\n');
    assert.equal(read(fx.rt('openclaw/lib/memory-store.mjs')), '// v1\n');
    for (const svc of ['openclaw-memory-daemon', 'openclaw-node-watch']) {
      assert.ok(resultOf(run).restarted.includes(svc), `${svc} kept the old lib: ${run.stdout}`);
    }
  });

  it('workspace scripts reach the workspace bin; the timer cohort is never rewritten', () => {
    fs.rmSync(fx.callLog, { force: true });
    S2 = fx.commit('v2: scripts', {
      'workspace-bin/session-recap': '#!/bin/sh\n# v2\n',
      'workspace-bin/archive-transcripts.sh': '# timer v2\n',
      'bin/node-watch.mjs': '// v2\n',
      'bin/observer.mjs': '// timer v2\n',
    });
    write(fx.home, '.openclaw/workspace/bin/observer.mjs', '// fenced by the timer handoff\n');
    const run = fx.deploy(['--from', S1, '--to', S2], { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: UNITS });
    ranOk(run);
    assert.equal(read(ws('bin/session-recap')), '#!/bin/sh\n# v2\n');
    assert.equal(read(ws('bin/node-watch.mjs')), '// v2\n');
    assert.equal(read(ws('bin/observer.mjs')), '// fenced by the timer handoff\n');
    assert.ok(!fs.existsSync(ws('bin/archive-transcripts.sh')));
    assert.ok(resultOf(run).restarted.includes('openclaw-node-watch'), run.stdout);
  });

  it('refuses to write through a workspace lib symlinked outside the checkout', () => {
    const elsewhere = path.join(path.dirname(fx.home), 'elsewhere-lib');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.rmSync(ws('lib'), { recursive: true, force: true });
    fs.symlinkSync(elsewhere, ws('lib'));
    const S3 = fx.commit('v3: lib', { 'lib/memory-store.mjs': '// v3\n' });
    const run = fx.deploy(['--from', S2, '--to', S3], { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: UNITS });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /DEPLOY_ERROR .*refusing to write through symlinked/);
    assert.deepEqual(fs.readdirSync(elsewhere), []);

    // Linked to the checkout itself: the checkout already is the runtime.
    fs.rmSync(ws('lib'));
    fs.symlinkSync(path.join(fx.node, 'lib'), ws('lib'));
    ranOk(fx.deploy(['--from', S2, '--to', S3], { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: UNITS }));
    assert.equal(git(fx.node, 'status', '--porcelain'), '', 'the deploy wrote into the checkout');
  });
});

describe('a dependency or event-schemas change refreshes the node\'s dependencies (the deps component)', () => {
  const UNITS = 'openclaw-mesh-agent openclaw-memory-daemon openclaw-node-watch openclaw-mesh-deploy-listener';
  let fx, S1;
  const env = { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: UNITS };
  before(() => {
    fx = makeNode('deps', {
      'bin/mesh-agent.js': '// agent v0\n',
      'package.json': '{"name":"r","dependencies":{"nats":"^2"}}\n',
      'package-lock.json': '{"lockfileVersion":3,"v":0}\n',
      'packages/event-schemas/tsconfig.json': '{}\n',
      'packages/event-schemas/src/events.ts': 'v0',
    });
    write(fx.node, 'node_modules/nats/package.json', '{}\n');
  });

  it('a lockfile-only change runs npm ci in the checkout under the deploy\'s node and restarts the daemons', () => {
    S1 = fx.commit('v1: lockfile', { 'package-lock.json': '{"lockfileVersion":3,"v":1}\n' });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], env);
    ranOk(run);
    assert.deepEqual(resultOf(run).components.map(c => c.id), ['deps']);
    const calls = read(fx.callLog);
    assert.ok(calls.includes(`npm ci --omit=dev @ ${fs.realpathSync(fx.node)}`), calls);
    assert.ok(calls.includes(`npm-path0 ${NODEBIN}`), `npm ran under another node:\n${calls}`);
    for (const svc of ['openclaw-mesh-agent', 'openclaw-memory-daemon', 'openclaw-node-watch']) {
      assert.ok(resultOf(run).restarted.includes(svc), `${svc} kept the old modules: ${run.stdout}`);
    }
    assert.deepEqual(resultOf(run).deferredRestart, ['openclaw-mesh-deploy-listener']);
    assert.ok(fs.realpathSync(fx.rt('.openclaw/workspace/node_modules/nats')).startsWith(fs.realpathSync(fx.node)),
      'the workspace daemons resolve the reinstalled tree');
  });

  it('an event-schemas source change rebuilds the dist and copies packages/ to the workspace', () => {
    fs.rmSync(fx.callLog, { force: true });
    const S2 = fx.commit('v2: schema', { 'packages/event-schemas/src/events.ts': 'v2' });
    const run = fx.deploy(['--from', S1, '--to', S2], env);
    ranOk(run);
    assert.deepEqual(resultOf(run).components.map(c => c.id), ['deps']);
    assert.ok(!fx.calls().includes('npm ci --omit=dev'), 'the lockfile did not change: no reinstall');
    assert.equal(read(path.join(fx.node, 'packages/event-schemas/dist/index.js')), 'built v2\n');
    assert.equal(read(fx.rt('.openclaw/workspace/packages/event-schemas/dist/index.js')), 'built v2\n');
    assert.equal(git(fx.node, 'status', '--porcelain', '--untracked-files=no'), '', 'the deploy dirtied the checkout');
  });
});

describe('a Mission Control build that fails keeps the previous build and fails the deploy', () => {
  const env = { OPENCLAW_NODE_ROLE: 'lead', DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: 'openclaw-mission-control' };
  let fx;
  before(() => {
    fx = makeNode('mc-build', {
      'mission-control/package.json': '{ "name": "mission-control" }\n',
      'mission-control/src/app/page.tsx': "export default () => 'v0';\n",
    });
    ranOk(fx.deploy(['--force'], env));
  });

  it('the failed build is replaced by the one it set aside, and the deploy exits non-zero', () => {
    const S1 = fx.commit('v1', { 'mission-control/src/app/page.tsx': "export default () => 'v1';\n" });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], { ...env, DEPLOY_TEST_BUILD_FAIL: '1' });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /Mission Control build FAILED — the previous build is still in place/);
    assert.equal(read(fx.rt('.openclaw/workspace/projects/mission-control/.next/BUILD_ID')), 'built\n');
    assert.ok(!fs.existsSync(fx.rt('.openclaw/workspace/projects/mission-control/.next.prev')));
  });
});

// A `mesh deploy` that failed partway on the lead left the components before the
// failure copied, and --rollback (lastSha, deployedBase) then reverted the deploy
// before it, leaving the files only the failed commit had added.
describe('mesh deploy --rollback after a deploy that failed partway reverts the failed deploy', () => {
  const env = { DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: 'openclaw-mesh-agent' };
  let fx, S1, S2;
  const ws = rel => fx.rt(path.join('.openclaw/workspace', rel));
  before(() => {
    fx = makeNode('partial', { 'bin/mesh-agent.js': '// agent v0\n', 'lib/shared.js': '// lib v0\n' });
    S1 = fx.commit('v1', { 'bin/mesh-agent.js': '// agent v1\n', 'lib/shared.js': '// lib v1\n' });
    ranOk(fx.deploy([], env));
  });

  it('records the failed sha, keeps lastSha, and prints the recovery command', () => {
    S2 = fx.commit('v2', {
      'bin/mesh-agent.js': '// agent v2\n',
      'bin/mesh-bridge.js': '// bridge, new in v2\n',
      'lib/shared.js': '// lib v2\n',
    });
    // shared-lib (after mesh-daemons) refuses a workspace lib linked outside the checkout.
    const elsewhere = path.join(path.dirname(fx.home), 'partial-elsewhere');
    fs.mkdirSync(elsewhere, { recursive: true });
    fs.rmSync(ws('lib'), { recursive: true, force: true });
    fs.symlinkSync(elsewhere, ws('lib'));
    const run = fx.deploy([], env);
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /refusing to write through symlinked/);
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v2\n', 'mesh-daemons ran before the failure');
    assert.equal(state().pendingSha, S2);
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, fx.S0);
    assert.match(run.stdout, /node bin\/mesh-deploy\.js --rollback .*failed deploy of /);
    fs.rmSync(ws('lib'));
    fs.mkdirSync(ws('lib'));
  });

  it('--rollback reverts that deploy to the last good one, removing what only it added', () => {
    const run = fx.deploy(['--rollback'], env);
    ranOk(run);
    assert.match(run.stdout, new RegExp(`reverting the failed deploy of ${S2.slice(0, 7)}`));
    assert.equal(git(fx.node, 'rev-parse', 'HEAD'), S1);
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v1\n');
    assert.ok(!fs.existsSync(fx.rt('openclaw/bin/mesh-bridge.js')), 'the failed deploy\'s new file stayed');
    assert.equal(state().pendingSha, undefined);
    assert.equal(state().deployedSha, S1);
    assert.equal(state().lastSha, fx.S0, 'reverting a failed deploy is not a version to roll back to');
  });

  it('a later --rollback goes back to the deploy before, as before', () => {
    const run = fx.deploy(['--rollback'], env);
    ranOk(run);
    assert.equal(git(fx.node, 'rev-parse', 'HEAD'), fx.S0);
    assert.equal(read(fx.rt('openclaw/bin/mesh-agent.js')), '// agent v0\n');
  });

  function state() { return JSON.parse(read(fx.rt('.openclaw/.deploy-state.json'))); }
});

// install.sh puts Mission Control, the memory daemon, the boot compiler and the
// lane watchdog on every node; the deploy treated them as lead-only, so a
// worker's copies never updated.
describe('a worker deploys what the installer put on it', () => {
  const env = { OPENCLAW_NODE_ROLE: 'worker', DEPLOY_TEST_PLATFORM: 'linux', DEPLOY_TEST_UNITS: 'openclaw-memory-daemon openclaw-mission-control' };
  let fx;
  before(() => {
    fx = makeNode('worker-runtime', {
      'workspace-bin/memory-daemon.mjs': '// daemon v0\n',
      'mission-control/package.json': '{ "name": "mission-control" }\n',
      'mission-control/src/app/page.tsx': "export default () => 'v0';\n",
    });
  });

  it('the memory daemon and Mission Control reach a worker and restart there', () => {
    const S1 = fx.commit('v1', {
      'workspace-bin/memory-daemon.mjs': '// daemon v1\n',
      'mission-control/src/app/page.tsx': "export default () => 'v1';\n",
    });
    const run = fx.deploy(['--from', fx.S0, '--to', S1], env);
    ranOk(run);
    assert.deepEqual(resultOf(run).components.map(c => c.id).sort(), ['mc', 'memory-daemon']);
    assert.equal(read(fx.rt('.openclaw/workspace/bin/memory-daemon.mjs')), '// daemon v1\n');
    assert.equal(read(fx.rt('.openclaw/workspace/projects/mission-control/src/app/page.tsx')), "export default () => 'v1';\n");
    for (const svc of ['openclaw-memory-daemon', 'openclaw-mission-control']) {
      assert.ok(resultOf(run).restarted.includes(svc), `${svc}: ${run.stdout}`);
    }
  });
});
