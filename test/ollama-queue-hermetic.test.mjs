/**
 * ollama-queue-hermetic.test.mjs — ollama-queue.test.mjs pins its own short
 * retry delays, so an exported OLLAMA_QUEUE_RETRIES (the documented backfill
 * setting is "none") neither breaks its retry counts nor makes it sit through
 * the production 1 s + 2 s + 4 s backoff on every retried call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('ollama-queue.test.mjs passes with OLLAMA_QUEUE_RETRIES=none exported, without real backoff', () => {
  const env = { ...process.env, OLLAMA_QUEUE_RETRIES: 'none' };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--test', join('test', 'ollama-queue.test.mjs')], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  const elapsed = Date.now() - started;
  assert.equal(r.status, 0, r.stdout.split('\n').filter((l) => /not ok|error/.test(l)).join('\n'));
  assert.ok(elapsed < 20_000, `took ${elapsed} ms; the four retry tests used to idle 7 s each`);
});
