import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { withInstallerLock, withOwnedDirectoryLock } from '../lib/installer-lock.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-lock-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, root: path.join(home, 'root') };
}

function env(f) {
  return { PATH: process.env.PATH, HOME: f.home, OPENCLAW_ROOT: f.root, DRY_RUN: 'false', REPO_DIR: repo,
    NODE_BIN: process.execPath, OWNED_LOCK_MODULE: path.join(repo, 'lib/installer-lock.mjs') };
}

test('Node owner excludes a Bash contender and cleans only its own private metadata', t => {
  const f = fixture(t);
  const result = withInstallerLock(f.root, 'owned-node', root => {
    const directory = path.join(root, '.installer-lock'), owner = path.join(directory, 'owner.txt');
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700); assert.equal(fs.statSync(owner).mode & 0o777, 0o600);
    const before = fs.readFileSync(owner);
    const contender = spawnSync('bash', ['-c', 'source "$1"; acquire_installer_lock', 'owned-contender', path.join(repo, 'scripts/install/helpers.sh')], { env: env(f), encoding: 'utf8' });
    assert.notEqual(contender.status, 0); assert.deepEqual(fs.readFileSync(owner), before);
    return 42;
  });
  assert.equal(result, 42); assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
});

test('direct Node child inherits matching Bash nonce without releasing its parent lock', t => {
  const f = fixture(t);
  const child = spawnSync('bash', ['-c', `set -euo pipefail
source "$1"
acquire_installer_lock
"$NODE_BIN" --input-type=module -e 'const fs=await import("node:fs");const {withInstallerLock}=await import(process.env.OWNED_LOCK_MODULE);const result=withInstallerLock(process.env.OPENCLAW_ROOT,"owned-child",root=>fs.existsSync(root+"/.installer-lock/owner.txt"));console.log("CHILD_OWNED="+result);'
test -f "$OPENCLAW_ROOT/.installer-lock/owner.txt"
exit 19`, 'owned-parent', path.join(repo, 'scripts/install/helpers.sh')], { env: env(f), encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 19, child.stderr); assert.match(child.stdout, /CHILD_OWNED=true/);
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
});

test('incorrect inherited nonce refuses without taking or removing the owner lock', t => {
  const f = fixture(t), directory = path.join(f.root, '.installer-lock'); fs.mkdirSync(directory, { recursive: true });
  const owner = path.join(directory, 'owner.txt'), before = `pid=${process.pid}\nnonce=owned-real-nonce\n`;
  fs.writeFileSync(owner, before);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'const {withInstallerLock}=await import(process.env.OWNED_LOCK_MODULE);withInstallerLock(process.env.OPENCLAW_ROOT,"must-refuse",()=>{throw Error("must not enter");});'], {
    env: { ...env(f), OPENCLAW_INSTALLER_LOCK_PID: String(process.pid), OPENCLAW_INSTALLER_LOCK_NONCE: 'wrong-nonce' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.notEqual(child.status, 0); assert.match(child.stderr, /Inherited installer lock/);
  assert.equal(fs.readFileSync(owner, 'utf8'), before);
});

test('Bash cleanup retains a changed nonce even when the PID matches, preserving the primary exit', t => {
  const f = fixture(t);
  const child = spawnSync('bash', ['-c', `set -euo pipefail
source "$1"
acquire_installer_lock
printf 'pid=%s\\nnonce=foreign-invocation\\n' "$$" > "$OPENCLAW_ROOT/.installer-lock/owner.txt"
exit 19`, 'owned-changed-nonce', path.join(repo, 'scripts/install/helpers.sh')], { env: env(f), encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 19, child.stderr);
  assert.match(fs.readFileSync(path.join(f.root, '.installer-lock/owner.txt'), 'utf8'), /nonce=foreign-invocation/);
  assert.match(child.stdout + child.stderr, /ownership changed/);
});

test('owner changes and unexpected files retain the lock and never replace the primary result or error', t => {
  const f = fixture(t); fs.mkdirSync(f.root);
  const changed = path.join(f.root, 'changed');
  assert.throws(() => withOwnedDirectoryLock(changed, 'owned', () => {
    fs.writeFileSync(path.join(changed, 'owner.txt'), 'foreign owner'); throw Error('owned primary failure');
  }), /owned primary failure/);
  assert.equal(fs.readFileSync(path.join(changed, 'owner.txt'), 'utf8'), 'foreign owner');
  const unexpected = path.join(f.root, 'unexpected');
  assert.equal(withOwnedDirectoryLock(unexpected, 'owned', () => {
    fs.writeFileSync(path.join(unexpected, 'retain'), 'unexpected owned fixture bytes'); return 53;
  }), 53);
  assert.equal(fs.readFileSync(path.join(unexpected, 'retain'), 'utf8'), 'unexpected owned fixture bytes');
  assert.equal(fs.existsSync(path.join(unexpected, 'owner.txt')), false);
  const failure = path.join(f.root, 'ordinary-failure');
  assert.throws(() => withOwnedDirectoryLock(failure, 'owned', () => { throw Error('ordinary failure'); }), /ordinary failure/);
  assert.equal(fs.existsSync(failure), false);
});

test('mutating wave2 refuses before network/settings/services while check remains advisory', t => {
  const f = fixture(t), directory = path.join(f.root, '.installer-lock'), stub = path.join(f.home, 'stub');
  fs.mkdirSync(directory, { recursive: true }); fs.mkdirSync(stub);
  fs.writeFileSync(path.join(directory, 'owner.txt'), 'pid=owned-interrupted\nnonce=retain\n');
  const config = path.join(f.root, 'openclaw.env'), calls = path.join(f.home, 'calls');
  fs.writeFileSync(config, 'OPENCLAW_MODEL_ENABLED=0\nLLM_MODEL=owned\n');
  for (const name of ['curl', 'ollama', 'systemctl']) fs.writeFileSync(path.join(stub, name), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$OWNED_CALLS"\nexit 99\n', { mode: 0o755 });
  const run = extra => spawnSync('bash', [path.join(repo, 'scripts/install/llm-setup.sh'), '--endpoint', 'http://127.0.0.1:1', '--model', 'owned', ...extra], {
    env: { ...env(f), OPENCLAW_LLM_HOST: '0', PATH: `${stub}:${process.env.PATH}`, OWNED_CALLS: calls }, encoding: 'utf8', timeout: 10_000,
  });
  const before = fs.readFileSync(config), mutation = run([]);
  assert.notEqual(mutation.status, 0); assert.match(mutation.stdout + mutation.stderr, /interrupted installer owns/);
  assert.deepEqual(fs.readFileSync(config), before); assert.equal(fs.existsSync(calls), false);
  const check = run(['--check']); assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.deepEqual(fs.readFileSync(config), before); assert.equal(fs.existsSync(calls), false);
  assert.equal(fs.readFileSync(path.join(directory, 'owner.txt'), 'utf8'), 'pid=owned-interrupted\nnonce=retain\n');
});
