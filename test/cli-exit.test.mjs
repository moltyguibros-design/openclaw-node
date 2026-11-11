import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('cli.js passes the installer exit code through', () => {
  for (const code of [0, 3]) {
    const r = withStubBash(`exit ${code}`, (dir) =>
      spawnSync(process.execPath, [CLI, '--dry-run'], { env: { PATH: dir }, encoding: 'utf8' }));
    assert.equal(r.status, code);
  }
});
