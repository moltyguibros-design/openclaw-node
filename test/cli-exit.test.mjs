import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli.js');

function withStubBash(body, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cli-exit-'));
  try {
    const stub = join(dir, 'bash');
    writeFileSync(stub, `#!/bin/sh\n${body}\n`);
    chmodSync(stub, 0o755);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('cli.js fails when bash cannot be spawned', () => {
  const r = spawnSync(process.execPath, [CLI, '--dry-run'], {
    env: { PATH: '/nonexistent' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ENOENT/);
});

test('cli.js fails when the installer is killed by a signal', () => {
  const r = withStubBash('kill -TERM $$', (dir) =>
    spawnSync(process.execPath, [CLI, '--dry-run'], { env: { PATH: dir }, encoding: 'utf8' }));
  assert.equal(r.signal, null);
  assert.equal(r.status, 1);
});

test('cli.js under npx installs from a stable per-version copy, not the npx cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-npx-'));
  try {
    const pkg = join(dir, 'npm-cache', '_npx', 'f00d', 'node_modules', 'openclaw-node-harness');
    mkdirSync(join(pkg, 'node_modules', 'hoisted-leftover'), { recursive: true });
    mkdirSync(join(pkg, 'lib'));
    copyFileSync(CLI, join(pkg, 'cli.js'));
    copyFileSync(join(ROOT, 'lib', 'openclaw-root.js'), join(pkg, 'lib', 'openclaw-root.js'));
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'openclaw-node-harness', version: '9.9.9' }));
    writeFileSync(join(pkg, 'install.sh'), 'echo "SCRIPT=$(cd "$(dirname "$0")" && pwd) CWD=$(pwd) ARGS=$*"\n');
    const home = join(dir, 'home');
    mkdirSync(home);
    const run = (...a) => spawnSync(process.execPath, [join(pkg, 'cli.js'), ...a], {
      env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8',
    });

    const stable = join(home, '.openclaw', 'harness', '9.9.9');
    const r = run('--update');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`SCRIPT=${stable} CWD=${stable} ARGS=--update`), r.stdout);
    assert.ok(existsSync(join(stable, 'cli.js')));
    assert.ok(!existsSync(join(stable, 'node_modules')), 'npx node_modules are not carried over');

    const again = run();
    assert.equal(again.status, 0, again.stderr);
    assert.ok(again.stdout.includes(`SCRIPT=${stable} `), 'a second run reuses the copy');

    const dry = run('--dry-run');
    assert.match(dry.stdout, /\[dry-run\] would copy/);
    assert.ok(dry.stdout.includes(`SCRIPT=${pkg} `), 'a dry run writes nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cli.js passes the installer exit code through', () => {
  for (const code of [0, 3]) {
    const r = withStubBash(`exit ${code}`, (dir) =>
      spawnSync(process.execPath, [CLI, '--dry-run'], { env: { PATH: dir }, encoding: 'utf8' }));
    assert.equal(r.status, code);
  }
});
