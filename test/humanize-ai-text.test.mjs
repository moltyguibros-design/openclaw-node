/**
 * humanize-ai-text.test.mjs — skills/humanize-ai-text/scripts/detect.py.
 *
 * Its "curly quotes" counter was written with ASCII quotes, so it matched only
 * the straight double quote: real curly quotes scored 0, ordinary text was
 * penalised, and a transform that straightened quotes raised the issue count.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'skills', 'humanize-ai-text', 'scripts');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

function py(script, args, input) {
  const r = spawnSync('python3', ['-B', join(SCRIPTS, script), ...args], { input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const curlyQuotes = text => JSON.parse(py('detect.py', ['--json'], text)).curly_quotes;

describe('humanize-ai-text detect.py', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('counts curly quotes', () => {
    assert.equal(curlyQuotes('“hello” it’s ‘x'), 4);
  });

  it('does not count straight quotes', () => {
    assert.equal(curlyQuotes('"hello" it\'s'), 0);
  });

  it('reports no curly quotes after transform.py straightens them', () => {
    const before = '“hello” it’s';
    const after = py('transform.py', ['--quiet'], before);
    assert.equal(curlyQuotes(before), 3);
    assert.equal(curlyQuotes(after), 0);
  });
});
