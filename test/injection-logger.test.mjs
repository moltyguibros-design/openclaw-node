/**
 * injection-logger.test.mjs — Unit tests for lib/injection-logger.mjs
 *
 * Covers: logInjection (append + ensure dir + rotate), promptExcerpt
 * truncation, INJECTION_LOG_DISABLED env opt-out.
 *
 * Run: node --test test/injection-logger.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Configure log path BEFORE importing the module (env var is read at import time)
const TMP = mkdtempSync(join(tmpdir(), 'injection-logger-test-'));
const LOG_PATH = join(TMP, 'subdir', 'memory-injections.jsonl');
process.env.INJECTION_LOG_PATH = LOG_PATH;
process.env.INJECTION_LOG_ROTATE_BYTES = '1024';  // small for rotation tests
delete process.env.INJECTION_LOG_DISABLED;

const { logInjection, flushInjectionLog, promptExcerpt, scrubSecrets } = await import('../lib/injection-logger.mjs');

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('promptExcerpt', () => {
  it('returns empty string for null/undefined/empty', () => {
    assert.equal(promptExcerpt(null), '');
    assert.equal(promptExcerpt(undefined), '');
    assert.equal(promptExcerpt(''), '');
  });

  it('flattens whitespace into single spaces', () => {
    assert.equal(promptExcerpt('  hello\n\nworld\t!  '), 'hello world !');
  });

  it('truncates at default 200 chars and appends ellipsis', () => {
    const long = 'a'.repeat(500);
    const result = promptExcerpt(long);
    assert.equal(result.length, 201); // 200 + ellipsis (1 char)
    assert.ok(result.endsWith('…'));
  });

  it('honors custom max', () => {
    const long = 'a'.repeat(100);
    const result = promptExcerpt(long, 10);
    assert.equal(result.length, 11);
    assert.ok(result.endsWith('…'));
  });

  it('does not truncate short prompts', () => {
    assert.equal(promptExcerpt('short'), 'short');
  });

  it('stringifies non-string input', () => {
    assert.equal(promptExcerpt(42), '42');
  });
});

describe('scrubSecrets', () => {
  it('redacts key-shaped text and keeps the rest, newlines included', () => {
    assert.equal(scrubSecrets('export OPENAI_KEY=sk-' + 'A'.repeat(40)), 'export OPENAI_KEY=[REDACTED]');
    assert.equal(scrubSecrets('line1\nline2'), 'line1\nline2');
  });

  // Built at runtime so the committed file holds no secret-shaped line.
  const modernKeys = {
    anthropic: 'sk-' + 'ant-api03-' + 'Ab1'.repeat(30) + '-_AA',
    openaiProject: 'sk-' + 'proj-' + 'Ab1'.repeat(14),
    openrouter: 'sk-' + 'or-v1-' + 'a1'.repeat(16),
    githubFineGrained: 'github_' + 'pat_' + 'A1b'.repeat(10),
    githubOauth: 'gh' + 'o_' + 'A'.repeat(36),
    slackUser: 'xox' + 'p-' + '1234567890-' + 'a1'.repeat(16),
    aws: 'AK' + 'IA' + 'ABCDEFGHIJ234567',
  };
  for (const [shape, k] of Object.entries(modernKeys)) {
    it(`redacts the ${shape} key shape whole`, () => {
      assert.equal(scrubSecrets(`key ${k} end`), 'key [REDACTED] end');
    });
  }

  it('leaves kebab identifiers that merely contain sk- alone', () => {
    const text = 'sk-folding-cube and task-' + 'abcdefghijklmnopqrstuvwxyz';
    assert.equal(scrubSecrets(text), text);
  });

  it('redacts a key glued after - or _, and a token run from its first sk-', () => {
    const k = 'sk-' + 'proj-' + 'Ab1'.repeat(14);
    assert.equal(scrubSecrets(`id-${k} x_${k}`), 'id-[REDACTED] x_[REDACTED]');
    assert.equal(scrubSecrets(`a sk-short-${k} b`), 'a [REDACTED] b');
    assert.equal(scrubSecrets(`sk-short and x ${k}`), 'sk-short and x [REDACTED]');
  });

  // Each `sk-` in one long token run used to rescan the rest of the run: seconds at 100 KB.
  for (const [shape, text] of [
    ['-sk- tokens', ('-sk-' + 'a'.repeat(19)).repeat(5000)],
    ['bare sk- repeats', 'sk-'.repeat(35000)],
  ]) {
    it(`scrubs a 100 KB run of ${shape} in linear time`, () => {
      const t0 = performance.now();
      const out = scrubSecrets(text);
      const ms = performance.now() - t0;
      assert.equal(out, text);
      assert.ok(ms < 250, `scrubSecrets took ${ms.toFixed(0)} ms`);
    });
  }
});

describe('logInjection', () => {
  it('creates the log directory if missing', async () => {
    await logInjection({ session_id: 'a' });
    assert.ok(existsSync(LOG_PATH), 'log file should exist');
  });

  it('appends one JSON line per call', async () => {
    // Reset by truncating
    writeFileSync(LOG_PATH, '');
    await logInjection({ session_id: 'x', frontend: 'test' });
    await logInjection({ session_id: 'y', frontend: 'test' });
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('enriches each record with a ts timestamp', async () => {
    writeFileSync(LOG_PATH, '');
    await logInjection({ session_id: 'z' });
    const line = readFileSync(LOG_PATH, 'utf-8').trim();
    const parsed = JSON.parse(line);
    assert.ok(parsed.ts);
    assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(parsed.session_id, 'z');
  });

  it('does not throw when payload is unusual', async () => {
    writeFileSync(LOG_PATH, '');
    await logInjection({ session_id: 'a', items: { concepts: ['x'] } });
    await logInjection({});
    // Should still have 2 lines
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  });

  it('flushInjectionLog resolves once writes nobody awaited have landed', async () => {
    writeFileSync(LOG_PATH, '');
    // The injector fires these and forgets them; close() relies on the flush instead.
    for (let i = 0; i < 5; i++) logInjection({ session_id: `unawaited-${i}` });
    await flushInjectionLog();
    const lines = readFileSync(LOG_PATH, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 5);
  });

  it('rotates the file when it exceeds ROTATE_AT_BYTES', async () => {
    writeFileSync(LOG_PATH, '');
    // Fill past the 1024-byte cap configured at top of file
    const big = { session_id: 'big', payload: 'x'.repeat(200) };
    for (let i = 0; i < 10; i++) await logInjection(big);
    // First few calls write directly, then a rotation should occur
    const files = readdirSync(join(LOG_PATH, '..'));
    const rotated = files.filter(f => f.match(/memory-injections\.\d{4}-/));
    assert.ok(rotated.length >= 1, 'should have created at least one rotated file');
  });
});

describe('INJECTION_LOG_DISABLED env opt-out', () => {
  it('short-circuits when DISABLED=1 (verified via fresh import)', async () => {
    // Use a fresh module via cache-busting query param
    process.env.INJECTION_LOG_DISABLED = '1';
    const ALT_PATH = join(TMP, 'disabled-test.jsonl');
    process.env.INJECTION_LOG_PATH = ALT_PATH;
    const mod = await import('../lib/injection-logger.mjs?disabled-test');
    await mod.logInjection({ session_id: 'should-not-log' });
    assert.equal(existsSync(ALT_PATH), false);
    // Restore
    delete process.env.INJECTION_LOG_DISABLED;
  });
});
