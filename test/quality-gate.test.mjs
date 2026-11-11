/**
 * quality-gate.test.mjs — workspace-bin/quality-gate --check-all.
 *
 * The script runs under `#!/usr/bin/env bash`, which is macOS's stock bash
 * 3.2 unless Homebrew bash comes first on PATH. --check-all used mapfile (not
 * in 3.2) and expanded possibly-empty arrays under set -u, so it died there.
 * CI's bash 5 cannot reproduce that, so the source is checked directly and the
 * behavior is pinned.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'workspace-bin', 'quality-gate');

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function gate(workspace) {
  return spawnSync('bash', [SCRIPT, '--check-all'], {
    encoding: 'utf8',
    env: { ...process.env, OPENCLAW_WORKSPACE: workspace },
  });
}

describe('quality-gate --check-all', () => {
  it('uses nothing newer than bash 3.2', () => {
    const src = readFileSync(SCRIPT, 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
    assert.doesNotMatch(src, /\b(mapfile|readarray)\b/);
    assert.doesNotMatch(src, /"\$\{(STAGED|UNSTAGED)\[@\]\}"/);
  });

  it('checks the de-duplicated staged and unstaged files', () => {
    const ws = mkdtempSync(join(tmpdir(), 'quality-gate-'));
    git(ws, 'init', '-q');
    writeFileSync(join(ws, 'a.txt'), 'one\n');
    git(ws, 'add', 'a.txt');
    git(ws, 'commit', '-q', '-m', 'init');

    let r = gate(ws);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No files to check\./);

    writeFileSync(join(ws, 'a.txt'), 'two\n');
    writeFileSync(join(ws, 'b txt'), 'new\n');
    git(ws, 'add', 'b txt');
    r = gate(ws);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /checking 2 file\(s\)/);

    git(ws, 'add', 'a.txt');
    writeFileSync(join(ws, 'a.txt'), 'three\n');
    r = gate(ws);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /checking 2 file\(s\)/);
  });

  it('passes a staged deletion without an input warning', () => {
    const ws = mkdtempSync(join(tmpdir(), 'quality-gate-'));
    git(ws, 'init', '-q');
    writeFileSync(join(ws, 'gone.txt'), 'one\n');
    git(ws, 'add', 'gone.txt');
    git(ws, 'commit', '-q', '-m', 'init');
    git(ws, 'rm', '-q', 'gone.txt');
    const r = gate(ws);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /WARN \[input\]/);
  });
});

describe('quality-gate --files', () => {
  const run = (ws, args, cwd) => spawnSync('bash', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, OPENCLAW_WORKSPACE: ws },
  });
  const ws = mkdtempSync(join(tmpdir(), 'quality-gate-files-'));
  mkdirSync(join(ws, 'src'));
  writeFileSync(join(ws, 'src', 'a.js'), 'eval("x")\n');

  for (const [label, args, cwd] of [
    ['a workspace-relative path', ['--files', 'src/a.js'], ws],
    ['an absolute path', ['--files', join(ws, 'src', 'a.js')], tmpdir()],
    ['a cwd-relative path', ['--files', 'a.js'], join(ws, 'src')],
  ]) {
    it(`checks ${label}`, () => {
      const r = run(ws, args, cwd);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stdout, /WARN \[security\]: Suspicious pattern in .*src\/a\.js/);
    });
  }

  it('warns about an input that resolves nowhere instead of passing it', () => {
    const r = run(ws, ['--files', 'nope.js'], ws);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /WARN \[input\]: nope\.js not found/);
  });
});
