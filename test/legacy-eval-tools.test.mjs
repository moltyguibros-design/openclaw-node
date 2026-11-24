/**
 * legacy-eval-tools.test.mjs — the closed Block 3 / Gulf-1 tools still run with
 * their defaults: the query set is read from memory-plan/plans/legacy/eval/
 * (memory-plan/eval/ no longer exists), results are written outside that
 * append-only archive, and the embed backfill checkpoint is written atomically.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gulf1 = await import('../bin/run-gulf1-' + 'eval.mjs');
const block3 = await import('../bin/run-block3-validation.mjs');
const embed = await import('../bin/embed-existing-sessions.mjs');

const insideArchive = (p) => !relative(join(ROOT, 'memory-plan'), p).startsWith('..');

test('the default query set exists in the legacy archive and parses', () => {
  assert.equal(gulf1.DEFAULT_QUERIES, join(ROOT, 'memory-plan/plans/legacy/eval/gulf1-queries.json'));
  assert.ok(existsSync(gulf1.DEFAULT_QUERIES));
  assert.ok(gulf1.parseQuerySet(readFileSync(gulf1.DEFAULT_QUERIES, 'utf-8')).length > 0);
});

test('default outputs land outside the append-only archive', () => {
  assert.equal(insideArchive(gulf1.DEFAULT_EVAL_OUT_DIR), false);
  assert.equal(insideArchive(block3.DEFAULT_OUT), false);
});

for (const tool of ['run-gulf1-' + 'eval.mjs', 'run-tuning-harness.mjs']) {
  test(`${tool} --help names the legacy query set and an output outside memory-plan`, () => {
    const out = spawnSync(process.execPath, [join(ROOT, 'bin', tool), '--help'], { encoding: 'utf-8', cwd: tmpdir() });
    assert.equal(out.status, 0, out.stderr);
    assert.ok(out.stdout.includes(gulf1.DEFAULT_QUERIES));
    assert.doesNotMatch(out.stdout, /memory-plan\/eval\//);
    assert.ok(out.stdout.includes(gulf1.DEFAULT_EVAL_OUT_DIR));
  });
}

test('the embed checkpoint replaces the old file atomically (rename, not an in-place rewrite)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-cp-'));
  try {
    const cp = join(dir, 'nested', 'checkpoint.json');
    embed.saveCheckpoint(cp, { completed: ['s1'], totalChunks: 3, startedAt: 'x' });
    const first = statSync(cp).ino;
    embed.saveCheckpoint(cp, { completed: ['s1', 's2'], totalChunks: 5, startedAt: 'x' });
    assert.notEqual(statSync(cp).ino, first, 'a new inode: the content was renamed into place');
    assert.deepEqual(JSON.parse(readFileSync(cp, 'utf-8')).completed, ['s1', 's2']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
