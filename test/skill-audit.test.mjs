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
});
