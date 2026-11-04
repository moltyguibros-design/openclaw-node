import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const helpers = join(root, 'scripts/install/helpers.sh');
const envSource = readFileSync(join(root, 'scripts/install/env.sh'), 'utf8');
const roleSource = envSource.slice(envSource.indexOf('# ── Resolve node role'), envSource.indexOf('# Lead pubkey'));
const services = readFileSync(join(root, 'scripts/install/services.sh'), 'utf8');
const notifySource = services.slice(services.indexOf('NOTIFY_CONFIG='), services.indexOf('if $SANDBOX;', services.indexOf('NOTIFY_CONFIG=')));

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'install-preservation-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const nodeRoot = join(home, '.openclaw');
  const config = join(nodeRoot, 'config');
  const units = join(home, 'units');
  for (const dir of [config, units, join(nodeRoot, 'workspace')]) mkdirSync(dir, { recursive: true });
  const envFile = join(nodeRoot, 'openclaw.env');
  writeFileSync(envFile, [
    'OPENCLAW_NODE_ID=owned-install', 'OPENCLAW_NODE_ROLE=lead', 'OPENCLAW_NATS_TOKEN=owned-test-token',
    'OPENCLAW_NATS_AUTH=token', 'OPENCLAW_MODEL_ENABLED=0', 'LLM_MODEL=owned-model',
    'LLM_BASE_URL=http://127.0.0.1:1', 'OPENCLAW_NATS=nats://127.0.0.1:1',
    'OPENCLAW_NATS_CLUSTER_PASS=owned-route-pass', 'MESH_LLM_PROVIDER=shell',
    'OWNED_LITERAL="O\'Reilly & | $literal \\path"', '',
  ].join('\n'));
  for (const name of ['daemon.json', 'transcript-sources.json', 'obsidian-sync.json', 'notify.json']) {
    writeFileSync(join(config, name), JSON.stringify({ owned: name, custom: true }) + '\n');
  }
  writeFileSync(join(nodeRoot, 'openclaw.json'), '{"custom":"preserve"}\n');
  for (const name of ['nats.conf', 'nats-1.conf', 'nats-2.conf', 'nats-3.conf']) {
    writeFileSync(join(config, name), `# existing clustered ${name}\ncluster { name: owned-existing }\n`);
  }
  writeFileSync(join(config, 'nats-auth.conf'), 'authorization { token: "owned-test-token" }\n');
  writeFileSync(join(config, 'nats-writer-cohort.json'), '{"custom":"existing-cohort"}\n');
  const validator = join(home, 'nats-server');
  writeFileSync(validator, `#!/bin/sh
[ "$1" = -t ] && [ "$2" = -c ] || exit 91
[ -f "$(dirname "$3")/nats-auth.conf" ] || exit 92
if grep -q 'INVALID' "$3"; then exit 93; fi
exit 0
`, { mode: 0o755 });
  const env = {
    HOME: home, PATH: process.env.PATH, REPO_DIR: root, NODE_BIN: process.execPath,
    OPENCLAW_ROOT: nodeRoot, WORKSPACE: join(nodeRoot, 'workspace'), ENV_FILE: envFile,
    OPENCLAW_SYSTEMD_DIR: units, DRY_RUN: 'false', UPDATE_ONLY: 'true', SKIP_LLM: 'true',
    DISABLE_MODELS: 'false', NODE_ROLE: 'lead', OPENCLAW_PROVIDER: 'shell',
    CLUSTER_PEERS: '', CLUSTER_BIND: '', NATS_SERVER_BIN: process.env.OPENCLAW_TEST_NATS_VALIDATOR || validator,
    CLAUDE_PROJECT_WORKSPACE: 'owned', CLAUDE_PROJECT_HOME: 'owned', CLAUDE_PROJECT_REPO: 'owned',
  };
  function run(script = 'source "$REPO_DIR/scripts/install/config.sh"', changes = {}) {
    return spawnSync('bash', ['-c', `set -euo pipefail\nsource "$1"\nOS=linux\n${script}`, 'owned-test', helpers], {
      env: { ...env, ...changes }, encoding: 'utf8', timeout: 20_000,
    });
  }
  return { home, nodeRoot, config, envFile, units, env, run };
}

function filesBelow(dir, prefix = '') {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = join(prefix, entry.name), path = join(dir, entry.name);
    return entry.isDirectory() ? Object.entries(filesBelow(path, name)) : [[name, readFileSync(path).toString('base64')]];
  }));
}

test('env reader retains literal characters and only removes matching outer quotes', t => {
  const f = fixture(t);
  writeFileSync(f.envFile, `# ignored=value\nOWNED_LITERAL = "O'Reilly & | $literal \\path"\nOWNED_SINGLE='a \\ b'\nOWNED_ONE='\nOWNED_EXEC=$(touch ${f.home}/executed)\n`);
  const result = f.run(`load_env_file "$ENV_FILE"\n"$NODE_BIN" -e 'console.log(JSON.stringify([process.env.OWNED_LITERAL,process.env.OWNED_SINGLE,process.env.OWNED_ONE,process.env.OWNED_EXEC]))'`);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ["O'Reilly & | $literal \\path", 'a \\ b', "'", `$(touch ${f.home}/executed)`]);
  assert.equal(readdirSync(f.home).includes('executed'), false);
});

test('role precedence is explicit choice, saved env, rendered legacy unit, platform default', t => {
  const f = fixture(t);
  writeFileSync(join(f.units, 'openclaw-mesh-deploy-listener.service'), '[Service]\nEnvironment=OPENCLAW_NODE_ROLE=lead\n');
  for (const [explicit, saved, expected] of [['worker', 'lead', 'worker'], ['', 'worker', 'worker'], ['', '', 'lead']]) {
    const result = f.run(`${roleSource}\nprintf '%s' "$NODE_ROLE"`, { NODE_ROLE: explicit, OPENCLAW_NODE_ROLE: saved });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.endsWith(expected));
  }
  rmSync(join(f.units, 'openclaw-mesh-deploy-listener.service'));
  const result = f.run(`${roleSource}\nprintf '%s' "$NODE_ROLE"`, { NODE_ROLE: '', OPENCLAW_NODE_ROLE: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.endsWith('worker'));
});

test('ordinary update keeps all custom configs and private backups contain the old bytes', t => {
  const f = fixture(t), before = filesBelow(f.nodeRoot);
  const result = f.run(`source "$REPO_DIR/scripts/install/config.sh"\n${notifySource}\nprintf '%s' "$OPENCLAW_NODE_ROLE"`, { NODE_ROLE: 'worker' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.endsWith('worker'));
  assert.match(readFileSync(f.envFile, 'utf8'), /^OPENCLAW_NODE_ROLE=worker$/m);
  assert.match(readFileSync(f.envFile, 'utf8'), /^OWNED_LITERAL="O'Reilly & \| \$literal \\path"$/m);
  for (const [name, bytes] of Object.entries(before).filter(([name]) => name !== 'openclaw.env')) {
    assert.equal(readFileSync(join(f.nodeRoot, name)).toString('base64'), bytes, name);
  }
  const backup = join(f.nodeRoot, 'config-backups', readdirSync(join(f.nodeRoot, 'config-backups'))[0]);
  assert.equal(statSync(backup).mode & 0o777, 0o700);
  for (const [name, bytes] of Object.entries(before)) {
    assert.equal(readFileSync(join(backup, name)).toString('base64'), bytes, name);
    assert.equal(statSync(join(backup, name)).mode & 0o777, 0o600, name);
  }
  assert.equal(readdirSync(backup).includes('identity.key'), false);
});

test('dry-run leaves every existing file and directory unchanged', t => {
  const f = fixture(t), before = filesBelow(f.home);
  const result = f.run(`source "$REPO_DIR/scripts/install/config.sh"\n${notifySource}`, { DRY_RUN: 'true', CLUSTER_PEERS: '127.0.0.2', CLUSTER_BIND: '127.0.0.1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(filesBelow(f.home), before);
});

test('invalid explicit topology leaves live config and env unchanged', t => {
  const f = fixture(t), beforeConfig = readFileSync(join(f.config, 'nats.conf')), beforeEnv = readFileSync(f.envFile);
  const result = f.run(undefined, { CLUSTER_PEERS: 'INVALID:{}', CLUSTER_BIND: '127.0.0.1' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(readFileSync(join(f.config, 'nats.conf')), beforeConfig);
  assert.deepEqual(readFileSync(f.envFile), beforeEnv);
  assert.equal(readdirSync(f.config).some(name => name.startsWith('.cluster-')), false);
});

test('valid explicit topology selects only the validated file and persists its derived settings', t => {
  const f = fixture(t), auth = readFileSync(join(f.config, 'nats-auth.conf'));
  const result = f.run(undefined, { CLUSTER_PEERS: '127.0.0.2,127.0.0.3', CLUSTER_BIND: '127.0.0.1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(join(f.config, 'nats.conf'), 'utf8'), /listen: 127\.0\.0\.1:4222/);
  assert.match(readFileSync(join(f.config, 'nats.conf'), 'utf8'), /nats-route:\/\/openclaw-route:owned-route-pass@127\.0\.0\.2:6222/);
  assert.match(readFileSync(f.envFile, 'utf8'), /^OPENCLAW_KV_REPLICAS=3$/m);
  assert.match(readFileSync(f.envFile, 'utf8'), /^OPENCLAW_NATS=nats:\/\/127\.0\.0\.1:4222$/m);
  assert.deepEqual(readFileSync(join(f.config, 'nats-auth.conf')), auth);
});


test('fresh cluster validation does not invoke the auth CLI before generating its real token', t => {
  const f = fixture(t);
  rmSync(f.envFile);
  rmSync(f.config, { recursive: true });
  mkdirSync(f.config);
  const result = f.run(undefined, { CLUSTER_PEERS: '127.0.0.2,127.0.0.3', CLUSTER_BIND: '127.0.0.1',
    OPENCLAW_NODE_ID: 'owned-fresh', OPENCLAW_NATS_TOKEN: '', OPENCLAW_NATS: 'nats://127.0.0.1:1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const token = readFileSync(f.envFile, 'utf8').match(/^OPENCLAW_NATS_TOKEN=(.+)$/m)?.[1];
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.ok(readFileSync(join(f.config, 'nats-auth.conf'), 'utf8').includes(JSON.stringify(token)));
  assert.doesNotMatch(result.stdout, /Existing nats-auth.conf preserved/);
});


test('an explicitly empty quoted route secret persists the generated credential used by the candidate', t => {
  const f = fixture(t);
  writeFileSync(f.envFile, readFileSync(f.envFile, 'utf8').replace('OPENCLAW_NATS_CLUSTER_PASS=owned-route-pass', 'OPENCLAW_NATS_CLUSTER_PASS=""'));
  const result = f.run(undefined, { CLUSTER_PEERS: '127.0.0.2', CLUSTER_BIND: '127.0.0.1' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const password = readFileSync(f.envFile, 'utf8').match(/^OPENCLAW_NATS_CLUSTER_PASS=(.+)$/m)?.[1];
  assert.match(password, /^[a-f0-9]{64}$/);
  assert.ok(readFileSync(join(f.config, 'nats.conf'), 'utf8').includes(`password: "${password}"`));
});


test('a route secret provided only through the shell is persisted for later updates', t => {
  const f = fixture(t);
  writeFileSync(f.envFile, readFileSync(f.envFile, 'utf8').replace(/^OPENCLAW_NATS_CLUSTER_PASS=.*\n/m, ''));
  const result = f.run(undefined, { CLUSTER_PEERS: '127.0.0.2', CLUSTER_BIND: '127.0.0.1', OPENCLAW_NATS_CLUSTER_PASS: 'owned-shell-route' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(f.envFile, 'utf8'), /^OPENCLAW_NATS_CLUSTER_PASS=owned-shell-route$/m);
  assert.match(readFileSync(join(f.config, 'nats.conf'), 'utf8'), /password: "owned-shell-route"/);
});

test('a quoted-empty client token is replaced rather than shadowing the generated token', t => {
  const f = fixture(t);
  writeFileSync(f.envFile, readFileSync(f.envFile, 'utf8').replace('OPENCLAW_NATS_TOKEN=owned-test-token', 'OPENCLAW_NATS_TOKEN=""'));
  rmSync(join(f.config, 'nats-auth.conf'));
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const text = readFileSync(f.envFile, 'utf8');
  const token = text.match(/^OPENCLAW_NATS_TOKEN=(.+)$/m)?.[1];
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(text.match(/^OPENCLAW_NATS_TOKEN=/gm).length, 1);
  assert.ok(readFileSync(join(f.config, 'nats-auth.conf'), 'utf8').includes(JSON.stringify(token)));
});

const literalWriteCases = [
  ['ampersand', 'left&right', 'left&right'],
  ['pipe', 'left|right', 'left|right'],
  ['backslash', String.raw`C:\owned\value`, String.raw`C:\owned\value`],
  ['dollar', '$HOME $(touch "__OWNED_DIR__/executed") `touch "__OWNED_DIR__/backtick"`', '$HOME $(touch "__OWNED_DIR__/executed") `touch "__OWNED_DIR__/backtick"`'],
  ['quotes', `O'Reilly says "yes"`, `O'Reilly says "yes"`],
  ['Unicode', 'français_日本語', 'français_日本語'],
  ['empty', '', ''],
  ['trailing-backslash', 'ends\\', 'ends\\'],
  ['outer-quotes', '"kept as file data"', 'kept as file data'],
];

for (const [label, sourceValue, sourceDecoded] of literalWriteCases) {
  test(`env writer preserves literal ${label} bytes and existing reader semantics`, t => {
    const f = fixture(t);
    const value = sourceValue.replaceAll('__OWNED_DIR__', f.home);
    const decoded = sourceDecoded.replaceAll('__OWNED_DIR__', f.home);
    const before = '# untouched comment\nOWNED_TARGET=old\nOTHER="bytes & | remain"\nOWNED_TARGET=duplicate\nOWNED_TARGET_SUFFIX=untouched\n';
    writeFileSync(f.envFile, before);
    chmodSync(f.envFile, 0o600);
    const beforeFiles = filesBelow(f.nodeRoot);
    const result = f.run(`set_env_key OWNED_TARGET "$OWNED_VALUE"
load_env_file "$ENV_FILE"
"$NODE_BIN" -e 'process.stdout.write(JSON.stringify(process.env.OWNED_TARGET))'`, { OWNED_VALUE: value });
    assert.equal(result.status, 0, result.stderr);
    const expected = `# untouched comment\nOWNED_TARGET=${value}\nOTHER="bytes & | remain"\nOWNED_TARGET=${value}\nOWNED_TARGET_SUFFIX=untouched\n`;
    assert.equal(readFileSync(f.envFile, 'utf8'), expected);
    assert.equal(result.stdout, JSON.stringify(decoded));
    assert.deepEqual(filesBelow(f.nodeRoot), { ...beforeFiles, 'openclaw.env': Buffer.from(expected).toString('base64') });
    assert.equal(statSync(f.envFile).mode & 0o777, 0o600);
    assert.equal(readdirSync(f.home).includes('executed'), false);
    assert.equal(readdirSync(f.home).includes('backtick'), false);
  });
}

for (const [label, initial, expected] of [
  ['unterminated', '# keep\nOTHER=unchanged', '# keep\nOTHER=unchanged\nOWNED_TARGET=a&b|c\\d\n'],
  ['empty', '', 'OWNED_TARGET=a&b|c\\d\n'],
  ['missing', null, 'OWNED_TARGET=a&b|c\\d\n'],
]) {
  test(`env writer appends a distinct literal key to an ${label} file`, t => {
    const f = fixture(t);
    if (initial === null) rmSync(f.envFile);
    else writeFileSync(f.envFile, initial);
    const result = f.run('set_env_key OWNED_TARGET "$OWNED_VALUE"', { OWNED_VALUE: String.raw`a&b|c\d` });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(f.envFile, 'utf8'), expected);
  });
}

for (const missing of [false, true]) {
  test(`env writer dry-run leaves ${missing ? 'missing' : 'existing'} target unchanged`, t => {
    const f = fixture(t);
    if (missing) rmSync(f.envFile);
    const before = filesBelow(f.home);
    const result = f.run('set_env_key LLM_MODEL "$OWNED_VALUE"', { DRY_RUN: 'true', OWNED_VALUE: String.raw`a&b|c\d` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\]/);
    assert.deepEqual(filesBelow(f.home), before);
  });
}

for (const [label, value] of [['LF', 'first\nOTHER=corrupt'], ['CR', 'first\rOTHER=corrupt']]) {
  test(`env writer refuses ${label} before changing files`, t => {
    const f = fixture(t), before = filesBelow(f.home);
    const result = f.run('set_env_key LLM_MODEL "$OWNED_VALUE"', { OWNED_VALUE: value });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /env values must fit on one line/);
    assert.deepEqual(filesBelow(f.home), before);
  });
}

test('env writer propagates a failed replacement without claiming success', t => {
  const f = fixture(t), bin = join(f.home, 'fake-bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'sed'), '#!/bin/sh\nprintf "owned replacement refused\\n" >&2\nexit 73\n', { mode: 0o755 });
  const before = filesBelow(f.nodeRoot);
  const result = f.run('set_env_key LLM_MODEL "$OWNED_VALUE"\nprintf unexpected-success', { PATH: `${bin}:${f.env.PATH}`, OWNED_VALUE: 'a&b|c' });
  assert.equal(result.status, 73);
  assert.match(result.stderr, /owned replacement refused/);
  assert.doesNotMatch(result.stdout, /unexpected-success/);
  assert.deepEqual(filesBelow(f.nodeRoot), before);
});
