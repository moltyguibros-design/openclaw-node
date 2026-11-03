import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bootstrap = fileURLToPath(new URL('../bootstrap.sh', import.meta.url));

function executable(file, body) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-bootstrap-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  for (const dir of [bin, home, tmp]) fs.mkdirSync(dir, { mode: 0o700 });
  executable(path.join(bin, 'uname'), 'case "$1" in -s) echo Linux;; -m) echo aarch64;; esac');
  executable(path.join(bin, 'id'), '[ "$1" = -u ] && echo 0');
  executable(path.join(bin, 'apt-get'), 'printf "%s\\n" "$*" >> "$OWNED_APT_CALLS"; exit 0');
  executable(path.join(bin, 'node'), 'echo "$OWNED_NODE_VERSION"');
  executable(path.join(bin, 'nats-server'), 'echo "nats-server: v$OWNED_NATS_VERSION"');
  executable(path.join(bin, 'python3'), 'exit 0');
  executable(path.join(bin, 'curl'), 'printf "%s\\n" "$*" >> "$OWNED_CURL_CALLS"; exit 1');
  for (const command of ['git', 'sqlite3', 'cc', 'jq', 'rsync', 'openssl']) executable(path.join(bin, command), 'exit 0');
  const env = { ...process.env, PATH: bin, HOME: home, TMPDIR: tmp,
    OWNED_APT_CALLS: path.join(root, 'apt-calls'), OPENCLAW_NO_INSTALL: '1',
    OWNED_NODE_VERSION: 'v22.12.0', OWNED_NATS_VERSION: '2.12.15',
    OWNED_CURL_CALLS: path.join(root, 'curl-calls') };
  return { root, bin, env };
}

function run(f, extra = {}, args = ['--skip-llm', '--skip-mesh']) {
  const result = spawnSync('/bin/bash', [bootstrap, ...args],
    { env: { ...f.env, ...extra }, encoding: 'utf8', timeout: 10_000,
      killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

test('bootstrap stops before install with supported Node/NATS and explicit optional skips', t => {
  const f = fixture(t);
  const result = run(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /baseline complete/);
  assert.match(result.stdout, /tailscale skipped/);
  assert.equal(fs.existsSync(f.env.OWNED_CURL_CALLS), false);
});

test('bootstrap does not claim success with an old Node or NATS', t => {
  const f = fixture(t);
  for (const version of ['v22.11.9', 'v21.9.0']) {
    const result = run(f, { OWNED_NODE_VERSION: version });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /node 22\.12\+.*MISSING/);
  }
  const oldNats = run(f, { OWNED_NATS_VERSION: '2.12.6',
    OPENCLAW_NATS_SERVER_VERSION: '2.12.6' });
  assert.notEqual(oldNats.status, 0, oldNats.stdout + oldNats.stderr);
  assert.match(oldNats.stdout, /unsupported nats-server version/);
  assert.doesNotMatch(fs.readFileSync(f.env.OWNED_CURL_CALLS, 'utf8'), /nats-server/);
});

test('bootstrap sandbox skips both optional host tools', t => {
  const f = fixture(t);
  const result = run(f, {}, ['--sandbox']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /ollama skipped/);
  assert.match(result.stdout, /tailscale skipped/);
});

for (const missing of [['rsync'], ['openssl'], ['rsync', 'openssl']]) {
  test(`bootstrap refuses APT success with missing ${missing.join(' and ')}`, t => {
    const f = fixture(t);
    for (const command of missing) fs.unlinkSync(path.join(f.bin, command));
    const result = run(f);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    for (const command of missing) assert.match(result.stdout, new RegExp(`${command}.*MISSING`));
    assert.match(result.stdout, /install.sh NOT started/);
    assert.doesNotMatch(result.stdout, /baseline complete/);
    assert.match(fs.readFileSync(f.env.OWNED_APT_CALLS, 'utf8'), /^install -y /m);
    assert.equal(fs.existsSync(f.env.OWNED_CURL_CALLS), false);
  });
}

test('bootstrap requests rsync and openssl before a complete baseline handoff', t => {
  const f = fixture(t);
  const result = run(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = fs.readFileSync(f.env.OWNED_APT_CALLS, 'utf8').trim().split('\n').map(line => line.split(' '));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['update', '-y']);
  assert.deepEqual(calls[1].slice(0, 2), ['install', '-y']);
  for (const command of ['rsync', 'openssl']) assert.equal(calls[1].filter(arg => arg === command).length, 1);
  assert.match(result.stdout, /baseline complete/);
  assert.match(result.stdout, /OPENCLAW_NO_INSTALL=1/);
  assert.equal(fs.existsSync(f.env.OWNED_CURL_CALLS), false);
});
