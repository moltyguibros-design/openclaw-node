import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/install/prereqs.sh', import.meta.url));
const systemDeps = fileURLToPath(new URL('../scripts/install/system-deps.sh', import.meta.url));

function executable(file, body) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-prereqs-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  for (const dir of [bin, home, tmp]) fs.mkdirSync(dir, { mode: 0o700 });
  for (const command of ['id', 'mktemp', 'rm', 'cp', 'chmod', 'tar', 'gzip']) {
    const usr = `/usr/bin/${command}`, system = fs.existsSync(usr) ? usr : `/bin/${command}`;
    fs.symlinkSync(system, path.join(bin, command));
  }
  fs.symlinkSync('/bin/bash', path.join(bin, 'bash'));
  if (process.platform === 'linux') fs.symlinkSync('/usr/bin/sha256sum', path.join(bin, 'sha256sum'));
  executable(path.join(bin, 'uname'), 'case "$1" in -s) echo Linux;; -m) echo aarch64;; esac');
  executable(path.join(bin, 'apt-get'), 'printf "%s\\n" "$*" >> "$OWNED_APT_CALLS"; exit 0');
  executable(path.join(bin, 'sudo'), 'exec "$@"');
  executable(path.join(bin, 'node'), 'echo "${OWNED_NODE_VERSION}"');
  executable(path.join(bin, 'nats-server'), 'echo "nats-server: v${OWNED_NATS_VERSION}"');
  executable(path.join(bin, 'python3'), 'exit 0');
  executable(path.join(bin, 'curl'), 'while [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then shift; cp "$OWNED_ARCHIVE" "$1"; exit $?; fi; shift; done; exit 1');
  executable(path.join(bin, 'install'), 'printf "%s\\n" "$*" >> "$OWNED_INSTALL_CALLS"; cp "$1" "$OWNED_BIN/nats-server"; chmod +x "$OWNED_BIN/nats-server"');
  for (const command of ['git', 'sqlite3', 'cc', 'jq', 'rsync', 'openssl']) executable(path.join(bin, command), 'exit 0');
  if (process.platform === 'darwin') executable(path.join(bin, 'sha256sum'), 'exec /usr/bin/shasum -a 256 "$@"');
  const env = { ...process.env, PATH: bin, HOME: home, TMPDIR: tmp,
    OWNED_APT_CALLS: path.join(root, 'apt-calls'), OWNED_BIN: bin,
    OWNED_NODE_VERSION: 'v22.12.0', OWNED_NATS_VERSION: '2.12.15',
    OWNED_INSTALL_CALLS: path.join(root, 'install-calls'),
    OPENCLAW_SKIP_LLM: '1', OPENCLAW_SKIP_MESH: '1' };
  return { root, bin, env };
}

function run(f, extra = {}, check = true) {
  const result = spawnSync('/bin/bash', [script, ...(check ? ['--check'] : [])],
    { env: { ...f.env, ...extra }, encoding: 'utf8', timeout: 10_000,
      killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test('check enforces Node 22.12 floor and retains NATS when mesh is skipped', t => {
  const f = fixture(t);
  assert.equal(run(f).status, 0);
  const oldNode = run(f, { OWNED_NODE_VERSION: 'v22.11.9' });
  assert.notEqual(oldNode.status, 0);
  assert.match(oldNode.stdout, /node 22\.12\+.*MISSING/);
  const oldNats = run(f, { OWNED_NATS_VERSION: '2.12.6' });
  assert.notEqual(oldNats.status, 0);
  assert.match(oldNats.stdout, /nats-server 2\.12\.15\+.*MISSING/);
  assert.equal(fs.existsSync(f.env.OWNED_INSTALL_CALLS), false);
});

test('check requires Tailscale only when mesh is enabled', t => {
  const f = fixture(t);
  assert.equal(run(f).status, 0);
  const enabled = run(f, { OPENCLAW_SKIP_MESH: '0' });
  assert.notEqual(enabled.status, 0);
  assert.match(enabled.stdout, /tailscale.*MISSING/);
  executable(path.join(f.bin, 'tailscale'), 'exit 0');
  assert.equal(run(f, { OPENCLAW_SKIP_MESH: '0' }).status, 0);
});

test('Linux archive must match the supplied digest before any owned install', t => {
  const f = fixture(t), version = '2.12.16';
  const dir = path.join(f.root, `nats-server-v${version}-linux-arm64`);
  fs.mkdirSync(dir);
  executable(path.join(dir, 'nats-server'), `echo 'nats-server: v${version}'`);
  const archive = path.join(f.root, 'nats-server.tar.gz');
  const tar = spawnSync('tar', ['czf', archive, '-C', f.root, path.basename(dir)], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const settings = { OWNED_NATS_VERSION: '2.12.6', OWNED_ARCHIVE: archive,
    OPENCLAW_NATS_SERVER_VERSION: version };
  const noDigest = run(f, settings, false);
  assert.notEqual(noDigest.status, 0);
  assert.equal(fs.existsSync(f.env.OWNED_INSTALL_CALLS), false);
  const badDigest = run(f, { ...settings, OPENCLAW_NATS_SERVER_SHA256: '0'.repeat(64) }, false);
  assert.notEqual(badDigest.status, 0);
  assert.match(badDigest.stdout, /checksum mismatch/);
  assert.equal(fs.existsSync(f.env.OWNED_INSTALL_CALLS), false);
  const verified = run(f, { ...settings, OPENCLAW_NATS_SERVER_SHA256: digest }, false);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.equal(fs.readFileSync(f.env.OWNED_INSTALL_CALLS, 'utf8').trim().split('\n').length, 1);
});

test('system dependency step forwards the mesh choice in dry-run and install paths', t => {
  const f = fixture(t), repo = path.join(f.root, 'source');
  fs.mkdirSync(path.join(repo, 'scripts/install'), { recursive: true });
  executable(path.join(repo, 'scripts/install/prereqs.sh'),
    'printf "%s/%s/%s\\n" "$OPENCLAW_SKIP_LLM" "$OPENCLAW_SKIP_MESH" "$1" >> "$OWNED_FORWARD"');
  const forward = path.join(f.root, 'forward');
  for (const dryRun of ['true', 'false']) {
    const result = spawnSync('/bin/bash', ['-c',
      'step(){ :; }; info(){ :; }; warn(){ :; }; error(){ :; }; source "$OWNED_SYSTEM_DEPS"'],
    { env: { ...f.env, REPO_DIR: repo, OWNED_FORWARD: forward, OWNED_SYSTEM_DEPS: systemDeps,
      UPDATE_ONLY: 'false', DRY_RUN: dryRun, SKIP_LLM: 'true', SKIP_MESH: 'true' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual(fs.readFileSync(forward, 'utf8').trim().split('\n'), ['1/1/--check', '1/1/']);
});

for (const missing of [['rsync'], ['openssl'], ['rsync', 'openssl']]) {
  test(`check refuses missing ${missing.join(' and ')}`, t => {
    const f = fixture(t);
    for (const command of missing) fs.unlinkSync(path.join(f.bin, command));
    const result = run(f);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    for (const command of missing) assert.match(result.stdout, new RegExp(`${command}.*MISSING`));
    assert.equal(fs.existsSync(f.env.OWNED_APT_CALLS), false);
    assert.equal(fs.existsSync(f.env.OWNED_INSTALL_CALLS), false);
  });

  test(`Linux baseline refuses APT success with missing ${missing.join(' and ')}`, t => {
    const f = fixture(t);
    for (const command of missing) fs.unlinkSync(path.join(f.bin, command));
    const result = run(f, {}, false);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    for (const command of missing) assert.match(result.stdout, new RegExp(`${command}.*MISSING`));
    assert.match(fs.readFileSync(f.env.OWNED_APT_CALLS, 'utf8'), /^install -y /m);
    assert.equal(fs.existsSync(f.env.OWNED_INSTALL_CALLS), false);
  });
}

test('Linux baseline requests rsync and openssl before reporting success', t => {
  const f = fixture(t);
  const result = run(f, {}, false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = fs.readFileSync(f.env.OWNED_APT_CALLS, 'utf8').trim().split('\n').map(line => line.split(' '));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['update', '-y']);
  assert.deepEqual(calls[1].slice(0, 2), ['install', '-y']);
  for (const command of ['rsync', 'openssl']) {
    assert.equal(calls[1].filter(arg => arg === command).length, 1);
    assert.match(result.stdout, new RegExp(command));
  }
  assert.equal(fs.existsSync(f.env.OWNED_INSTALL_CALLS), false);
});
