/**
 * skill-quality-check.test.mjs — workspace-bin/skill-quality-check compares a
 * fresh skill-audit against the cached one, reports grade changes and
 * refreshes the cache.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'workspace-bin', 'skill-quality-check');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

const audit = grade => ({ average_score: 80, grade_distribution: { [grade]: 1 }, skills: [{ name: 'x', grade }] });

function workspace(t, { prevGrade, currGrade }) {
  const ws = mkdtempSync(join(tmpdir(), 'skill-quality-check-'));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const bin = join(ws, 'bin');
  mkdirSync(bin);
  mkdirSync(join(ws, '.tmp'));
  copyFileSync(SCRIPT, join(bin, 'skill-quality-check'));
  writeFileSync(join(bin, 'skill-audit'), `import json\nprint(json.dumps(${JSON.stringify(audit(currGrade))}))\n`);
  writeFileSync(join(ws, '.tmp', 'last-skill-audit.json'), JSON.stringify(audit(prevGrade)));
  return { ws, cache: join(ws, '.tmp', 'last-skill-audit.json') };
}

function run(ws) {
  const r = spawnSync('bash', [join(ws, 'bin', 'skill-quality-check')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

describe('skill-quality-check', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('reports a regression and leaves a stale capability-evolver events log alone', t => {
    const w = workspace(t, { prevGrade: 'A', currGrade: 'B' });
    const gep = join(w.ws, 'skills', 'capability-evolver', 'assets', 'gep');
    mkdirSync(gep, { recursive: true });
    const events = join(gep, 'events.jsonl');
    const before = '{"type":"EvolutionEvent","id":"evt_1","parent":null}\n';
    writeFileSync(events, before);
    const r = run(w.ws);
    assert.match(r.stdout, /^REGRESSIONS: x: A->B$/m);
    assert.equal(readFileSync(events, 'utf8'), before);
  });

  it('is silent when nothing changed and rewrites the cache with the current audit', t => {
    const w = workspace(t, { prevGrade: 'A', currGrade: 'A' });
    writeFileSync(w.cache, JSON.stringify({ ...audit('A'), stale: true }));
    const r = run(w.ws);
    assert.equal(r.stdout, '');
    assert.deepEqual(JSON.parse(readFileSync(w.cache, 'utf8')), audit('A'));
  });

  it('has no unread PREV_AVG and no capability-evolver reference', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(src, /PREV_AVG/);
    assert.doesNotMatch(src, /capability-evolver/);
  });
});
