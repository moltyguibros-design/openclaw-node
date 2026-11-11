/**
 * skill-audit.test.mjs — workspace-bin/skill-audit grades SKILL.md files.
 *
 * It carried a get_security_score() helper that nothing called, which read as
 * if the audit included a scanner score. The helper is gone; the audit must
 * still run end to end.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'workspace-bin', 'skill-audit');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

describe('skill-audit', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('has no uncalled security-score helper', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(src, /get_security_score|SCANNER_PATH|^import subprocess/m);
  });

  it('audits a skills dir and prints JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-audit-'));
    mkdirSync(join(dir, 'weather'));
    writeFileSync(join(dir, 'weather', 'SKILL.md'), [
      '---',
      'name: weather',
      'description: Report the current weather for a city. Use when the user asks about weather or forecasts.',
      '---',
      '# Weather',
      '',
      'Prints the forecast.',
      '',
    ].join('\n'));
    const r = spawnSync('python3', ['-B', SCRIPT, '--skills-dir', dir, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.total_skills, 1);
    assert.deepEqual(out.skills.map(s => s.name), ['weather']);
    assert.match(out.skills[0].grade, /^[A-F]$/);
  });

  it('--verbose lists every failing check in the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skill-audit-'));
    mkdirSync(join(dir, 'bare'));
    writeFileSync(join(dir, 'bare', 'SKILL.md'), 'hi\n');
    const audit = (...extra) => spawnSync('python3', ['-B', SCRIPT, '--skills-dir', dir, ...extra], { encoding: 'utf8' });

    const json = audit('--json');
    assert.equal(json.status, 0, json.stderr);
    const failing = Object.entries(JSON.parse(json.stdout).skills[0].checks)
      .filter(([, c]) => c.points < c.max)
      .map(([name]) => name);
    assert.ok(failing.length >= 3, `failing checks: ${failing}`);
    const third = failing[2];

    const plain = audit();
    const verbose = audit('--verbose');
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(verbose.status, 0, verbose.stderr);
    assert.doesNotMatch(plain.stdout, new RegExp(`${third}:`));
    for (const name of failing) assert.match(verbose.stdout, new RegExp(`${name}:`));
  });
});

describe('skill-batch-fix', { skip: !HAVE_PY && 'python3 not available' }, () => {
  const BATCH = join(ROOT, 'workspace-bin', 'skill-batch-fix');

  it('leaves a block-scalar (>-) description as written under --apply', () => {
    const home = mkdtempSync(join(tmpdir(), 'skill-batch-fix-'));
    const dir = join(home, '.openclaw', 'workspace', 'skills', 'humanizer');
    mkdirSync(dir, { recursive: true });
    const original = [
      '---',
      'name: humanizer',
      'description: >-',
      '  Rewrite stiff text so it reads naturally.',
      '  Keeps meaning intact.',
      '---',
      '# Humanizer',
      '',
    ].join('\n');
    writeFileSync(join(dir, 'SKILL.md'), original);
    const r = spawnSync('python3',
      ['-B', BATCH, '--apply', '--skill', 'humanizer', '--fix', 'description', '--json'],
      { encoding: 'utf8', env: { ...process.env, HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout)[0].fixes, []);
    assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), original);
  });
});
