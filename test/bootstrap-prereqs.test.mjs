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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-bootstrap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  executable(path.join(bin, 'uname'), 'case "$1" in -s) echo Linux;; -m) echo aarch64;; esac');
  executable(path.join(bin, 'id'), '[ "$1" = -u ] && echo 0');
  executable(path.join(bin, 'apt-get'), 'exit 0');
  executable(path.join(bin, 'node'), 'echo "$OWNED_NODE_VERSION"');
  executable(path.join(bin, 'nats-server'), 'echo "nats-server: v$OWNED_NATS_VERSION"');
  executable(path.join(bin, 'python3'), 'exit 0');
  executable(path.join(bin, 'curl'), 'printf "%s\\n" "$*" >> "$OWNED_CURL_CALLS"; exit 1');
  for (const command of ['git', 'sqlite3', 'cc', 'jq']) executable(path.join(bin, command), 'exit 0');
  const env = { ...process.env, PATH: bin, OPENCLAW_NO_INSTALL: '1',
    OWNED_NODE_VERSION: 'v22.12.0', OWNED_NATS_VERSION: '2.12.15',
    OWNED_CURL_CALLS: path.join(root, 'curl-calls') };
  return { root, bin, env };
}

function run(f, extra = {}, args = ['--skip-llm', '--skip-mesh']) {
  return spawnSync('/bin/bash', [bootstrap, ...args],
    { env: { ...f.env, ...extra }, encoding: 'utf8' });
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
