/**
 * humanize-ai-text.test.mjs — skills/humanize-ai-text, a detector only.
 *
 * Its "curly quotes" counter was written with ASCII quotes, so it matched only
 * the straight double quote: real curly quotes scored 0 and ordinary text was
 * penalised. It also shipped transform.py ("Transform AI text to bypass
 * detection") and called itself a tool to make AI text "bypass detectors",
 * against the identity rule "No deceptive behavior"; honest rewriting is the
 * humanizer skill's job. Its Rule of Three matches were never counted.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'humanize-ai-text');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

function detect(args, input) {
  const r = spawnSync('python3', ['-B', join(SKILL, 'scripts', 'detect.py'), ...args], { input, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const curlyQuotes = text => JSON.parse(detect(['--json'], text)).curly_quotes;

describe('humanize-ai-text', () => {
  it('ships no transform or compare tool and never offers to evade detectors', () => {
    assert.equal(existsSync(join(SKILL, 'scripts', 'transform.py')), false);
    assert.equal(existsSync(join(SKILL, 'scripts', 'compare.py')), false);
    const md = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(md, /bypass|evade|transform\.py|compare\.py/i);
    assert.match(md, /^python3 scripts\/detect\.py /m);
  });
});

describe('humanize-ai-text detect.py', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('counts curly quotes', () => {
    assert.equal(curlyQuotes('“hello” it’s ‘x'), 4);
  });

  it('does not count straight quotes', () => {
    assert.equal(curlyQuotes('"hello" it\'s'), 0);
  });

  it('counts and reports Rule of Three triads', () => {
    const text = 'Our team will plan, execute, and deliver the work on time for the client.\n';
    const r = JSON.parse(detect(['-j'], text));
    assert.deepEqual(r.rule_of_three, [['plan, execute, and', 1]]);
    assert.equal(r.total_issues, 1);
    const report = detect([], text);
    assert.match(report, /AI DETECTION SCAN - 1 issues/);
    assert.match(report, /^RULE OF THREE:\n {2}• plan, execute, and: 1x$/m);
  });
});
