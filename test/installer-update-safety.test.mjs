import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const helpers = path.join(repo, 'scripts/install/helpers.sh');
const installer = fs.readFileSync(path.join(repo, 'install.sh'), 'utf8');
const bootstrap = fs.readFileSync(path.join(repo, 'bootstrap.sh'), 'utf8');
const workspace = fs.readFileSync(path.join(repo, 'scripts/install/workspace.sh'), 'utf8');
const mode = installer.slice(installer.indexOf('if [ -f "$OPENCLAW_ROOT/config/installation.json" ]'), installer.indexOf('source "$REPO_DIR/scripts/install/llm-host.sh"'));
const fetchSource = bootstrap.slice(bootstrap.indexOf('step "Fetching $REPO@$REF"'), bootstrap.indexOf('step "Wave 1: running install.sh"'));
const souls = workspace.slice(workspace.indexOf('step "Step 5: Soul Definitions"'), workspace.indexOf('# Step 6:'));

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-update-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, '.openclaw');
  const env = { HOME: home, PATH: process.env.PATH, REPO_DIR: repo, NODE_BIN: process.execPath,
    OPENCLAW_ROOT: root, WORKSPACE: path.join(root, 'workspace'), ENV_FILE: path.join(root, 'openclaw.env'),
    DRY_RUN: 'false', UPDATE_ONLY: 'false', NODE_ROLE: 'lead', PROVIDER: 'shell', SKIP_LLM: 'true' };
  const run = (body, changes = {}) => spawnSync('bash', ['-c', `set -euo pipefail\nsource "$1"\n${body}`, 'owned-installer', helpers], {
    env: { ...env, ...changes }, encoding: 'utf8', timeout: 15_000,
  });
  const write = (name, value) => { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
  return { home, root, env, run, write };
}

test('known repeat installs enter update mode without changing explicit role/provider/model choices', t => {
  for (const [kind, expected] of [['empty', false], ['env-only', false], ['legacy', true], ['managed', true]]) {
    const f = fixture(t);
    if (kind === 'env-only' || kind === 'legacy') f.write('openclaw.env', 'owned=keep\n');
    if (kind === 'legacy') f.write('workspace/bin/memory-daemon.mjs', '// owned installed script\n');
    if (kind === 'managed') f.write('config/installation.json', '{"schema":1}\n');
    const result = f.run(`${mode}\nprintf 'RESULT=%s,%s,%s,%s\\n' "$UPDATE_ONLY" "$NODE_ROLE" "$PROVIDER" "$SKIP_LLM"`);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`RESULT=${expected},lead,shell,true`));
    assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
  }
});

test('another installer cannot take or remove an active owner lock', async t => {
  const f = fixture(t);
  const child = spawn('bash', ['-c', 'set -euo pipefail\nsource "$1"\nacquire_installer_lock\nprintf "READY\\n"\nread -r finish', 'owned-owner', helpers], {
    env: f.env, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  try {
    await Promise.race([once(child.stdout, 'data'), new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('owned lock owner not ready')), 3000); timer.unref();
    })]);
    const lock = path.join(f.root, '.installer-lock'), owner = fs.readFileSync(path.join(lock, 'owner.txt'));
    assert.equal(fs.statSync(lock).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(lock, 'owner.txt')).mode & 0o777, 0o600);
    const contender = f.run('acquire_installer_lock');
    assert.notEqual(contender.status, 0);
    assert.match(contender.stdout + contender.stderr, /interrupted installer owns/);
    assert.deepEqual(fs.readFileSync(path.join(lock, 'owner.txt')), owner);
  } finally {
    child.stdin.end('finish\n');
    const [code] = await closed;
    assert.equal(code, 0);
  }
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
});

test('primary failure and signal exit release only the owned installer lock; dry-run writes nothing', async t => {
  const f = fixture(t);
  const failure = f.run('acquire_installer_lock\nexit 19');
  assert.equal(failure.status, 19);
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
  const dry = fixture(t), result = dry.run('acquire_installer_lock', { DRY_RUN: 'true' });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(dry.root), false);
  const child = spawn('bash', ['-c', 'set -euo pipefail\nsource "$1"\nacquire_installer_lock\nprintf "READY\\n"\nwhile true; do sleep 0.1; done', 'owned-signal', helpers], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close'); await once(child.stdout, 'data'); child.kill('SIGTERM');
  const [code] = await closed;
  assert.equal(code, 143);
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
});

test('cluster cleanup composes with the outer installer lock on success and refusal', t => {
  for (const invalid of [false, true]) {
    const f = fixture(t);
    f.write('openclaw.env', 'OPENCLAW_NODE_ID=owned\nOPENCLAW_NODE_ROLE=lead\nOPENCLAW_NATS_TOKEN=owned-token\nOPENCLAW_NATS_CLUSTER_PASS=owned-route\nOPENCLAW_NATS_AUTH=token\nOPENCLAW_MODEL_ENABLED=0\nLLM_MODEL=owned\nLLM_BASE_URL=http://127.0.0.1:1\n');
    f.write('config/nats-auth.conf', 'authorization { token: "owned-token" }\n');
    f.write('config/nats.conf', '# preserve this old config on refusal\n');
    const validator = path.join(f.home, 'nats-server');
    fs.writeFileSync(validator, '#!/bin/sh\n! grep -q INVALID "$3"\n', { mode: 0o755 });
    const result = f.run('acquire_installer_lock\nsource "$REPO_DIR/scripts/install/config.sh"\ntest -d "$OPENCLAW_ROOT/.installer-lock"\nexit 19', {
      NATS_SERVER_BIN: validator, CLUSTER_PEERS: invalid ? 'INVALID:{}' : '127.0.0.2', CLUSTER_BIND: '127.0.0.1',
      DISABLE_MODELS: 'false', OPENCLAW_PROVIDER: 'shell', CLAUDE_PROJECT_WORKSPACE: 'owned', CLAUDE_PROJECT_HOME: 'owned', CLAUDE_PROJECT_REPO: 'owned',
    });
    assert.equal(result.status, invalid ? 1 : 19, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
    assert.equal(fs.readdirSync(path.join(f.root, 'config')).some(name => name.startsWith('.cluster-')), false);
    if (invalid) assert.equal(fs.readFileSync(path.join(f.root, 'config/nats.conf'), 'utf8'), '# preserve this old config on refusal\n');
  }
});

test('fresh bootstrap caches stay private and never replace an earlier source directory', t => {
  const f = fixture(t), stub = path.join(f.home, 'stub'), packed = path.join(f.home, 'packed');
  fs.mkdirSync(stub); fs.mkdirSync(path.join(packed, 'project'), { recursive: true });
  fs.writeFileSync(path.join(packed, 'project/install.sh'), '# owned downloaded source\n');
  const archive = path.join(f.home, 'source.tar.gz');
  const tar = spawnSync('tar', ['-czf', archive, '-C', packed, 'project'], { encoding: 'utf8' }); assert.equal(tar.status, 0, tar.stderr);
  fs.writeFileSync(path.join(stub, 'curl'), '#!/bin/sh\ncat "$OWNED_SOURCE_TAR"\n', { mode: 0o755 });
  const original = path.join(f.home, '.openclaw-src/openclaw-node'); fs.mkdirSync(original, { recursive: true }); fs.writeFileSync(path.join(original, 'owned'), 'retain old source bytes');
  const body = `step() { :; }\nok() { :; }\ndie() { echo "$*" >&2; exit 1; }\n${fetchSource}\nprintf 'OWNED_SRC=%s\\n' "$SRC"`;
  const run = () => f.run(body, { REPO: 'owned/source', REF: 'owned-ref', OPENCLAW_SRC: '', PATH: `${stub}:${process.env.PATH}`, OWNED_SOURCE_TAR: archive });
  const one = run(), two = run(); assert.equal(one.status, 0, one.stderr); assert.equal(two.status, 0, two.stderr);
  const a = one.stdout.match(/OWNED_SRC=(.+)/)[1], b = two.stdout.match(/OWNED_SRC=(.+)/)[1];
  assert.notEqual(a, b); assert.equal(fs.statSync(a).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(path.join(a, 'install.sh'), 'utf8'), '# owned downloaded source\n');
  assert.equal(fs.readFileSync(path.join(original, 'owned'), 'utf8'), 'retain old source bytes');
});

test('managed mesh bootstrap refuses before any dependency/Git/provisioning command', t => {
  const f = fixture(t), stub = path.join(f.home, 'stub'), calls = path.join(f.home, 'calls');
  f.write('config/installation.json', '{"schema":1}\n'); fs.mkdirSync(stub);
  for (const name of ['node', 'git', 'npm', 'curl']) fs.writeFileSync(path.join(stub, name), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$OWNED_CALLS"\nexit 99\n', { mode: 0o755 });
  const result = spawnSync('bash', [path.join(repo, 'mesh-install.sh'), '--repair'], { env: { HOME: f.home, OPENCLAW_ROOT: f.root, PATH: `${stub}:${process.env.PATH}`, OWNED_CALLS: calls }, encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /mesh bootstrap refused before Git\/npm/);
  assert.equal(fs.existsSync(calls), false);
});

test('seed refresh updates definitions while keeping learned genes/events and adding missing seeds', t => {
  const f = fixture(t), seed = path.join(f.home, 'repo/souls/owned/evolution'); fs.mkdirSync(seed, { recursive: true });
  fs.writeFileSync(path.join(seed, 'genes.json'), '{"seed":1}\n'); fs.writeFileSync(path.join(seed, 'events.jsonl'), '{"seed":true}\n');
  fs.writeFileSync(path.join(seed, '../SOUL.md'), 'updated soul definition\n');
  fs.writeFileSync(path.join(seed, 'capsules.json'), '{"definition":2}\n');
  f.write('souls/owned/SOUL.md', 'old soul definition\n'); f.write('souls/owned/evolution/capsules.json', '{"definition":1}\n');
  f.write('souls/owned/evolution/genes.json', '{"learned":"preserve this evolved gene"}\n'); f.write('souls/owned/evolution/events.jsonl', '{"owned_history":1}\n{"owned_history":2}\n');
  const before = [fs.readFileSync(path.join(f.root, 'souls/owned/evolution/genes.json')), fs.readFileSync(path.join(f.root, 'souls/owned/evolution/events.jsonl'))];
  const result = f.run(souls, { REPO_DIR: path.join(f.home, 'repo') }); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(f.root, 'souls/owned/SOUL.md'), 'utf8'), 'updated soul definition\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'souls/owned/evolution/capsules.json'), 'utf8'), '{"definition":2}\n');
  const fresh = path.join(f.home, 'repo/souls/new/evolution'); fs.mkdirSync(fresh, { recursive: true });
  fs.writeFileSync(path.join(fresh, 'genes.json'), '{"new_seed":1}\n'); fs.writeFileSync(path.join(fresh, 'events.jsonl'), '{"new_seed":true}\n');
  fs.writeFileSync(path.join(seed, 'new-seed.md'), 'new seed is installable\n');
  const second = f.run(souls, { REPO_DIR: path.join(f.home, 'repo') }); assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'souls/owned/evolution/genes.json')), before[0]);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'souls/owned/evolution/events.jsonl')), before[1]);
  assert.equal(fs.readFileSync(path.join(f.root, 'souls/owned/evolution/new-seed.md'), 'utf8'), 'new seed is installable\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'souls/new/evolution/genes.json'), 'utf8'), '{"new_seed":1}\n');
  assert.equal(fs.readFileSync(path.join(f.root, 'souls/new/evolution/events.jsonl'), 'utf8'), '{"new_seed":true}\n');
});
