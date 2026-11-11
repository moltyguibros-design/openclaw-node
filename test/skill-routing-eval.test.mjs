/**
 * skill-routing-eval.test.mjs — workspace-bin/skill-routing-eval scores every
 * query against every skill's triggers. Each distinct string must be
 * tokenized once, not once per (query, skill) pair, and the scores must not
 * change.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'workspace-bin', 'skill-routing-eval');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

const PROBE = `
import importlib.machinery, importlib.util, json, sys
from pathlib import Path
loader = importlib.machinery.SourceFileLoader('probe', sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader('probe', loader))
loader.exec_module(m)
skills = m.load_all_skills(Path(sys.argv[2]))
r = m.evaluate(skills, m.generate_auto_tests(skills), 0.35)
print(json.dumps({'results': r, 'misses': m.tokenize.cache_info().misses}))
`;

function skill(dir, name, triggers, negatives) {
  mkdirSync(join(dir, name));
  writeFileSync(join(dir, name, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'triggers:',
    ...triggers.map(t => `  - "${t}"`),
    'negative_triggers:',
    ...negatives.map(t => `  - "${t}"`),
    '---',
    `# ${name}`,
    '',
  ].join('\n'));
}

describe('skill-routing-eval', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('tokenizes each distinct string once and keeps the scores', () => {
    const dir = mkdtempSync(join(tmpdir(), 'routing-eval-'));
    skill(dir, 'weather', ['check the weather forecast', 'will it rain tomorrow'], ['weather station hardware repair']);
    skill(dir, 'calendar', ['schedule a meeting tomorrow', 'check the calendar forecast'], ['calendar app development']);
    const r = spawnSync('python3', ['-B', '-c', PROBE, SCRIPT, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const { results, misses } = JSON.parse(r.stdout);
    assert.equal(misses, 6);
    assert.equal(results.total_tests, 6);
    assert.equal(results.overall_accuracy, 1);
    assert.deepEqual(
      results.skills.map(s => [s.name, s.tp, s.fp, s.fn, s.precision]),
      [['calendar', 2, 1, 0, 0.67], ['weather', 2, 1, 0, 0.67]],
    );
    assert.deepEqual(results.conflict_pairs.map(c => [c.skill_a, c.skill_b, c.count]), [['calendar', 'weather', 2]]);
  });
});
