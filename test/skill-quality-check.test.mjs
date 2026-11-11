/**
 * skill-quality-check.test.mjs — workspace-bin/skill-quality-check compares a
 * fresh skill-audit against the cached one and, on a change, appends an
 * EvolutionEvent to the capability-evolver's events.jsonl.
 *
 * That event carried no id or parent, so getLastEventId() returned null after
 * every quality check and the evolution chain lost its parent link.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'workspace-bin', 'skill-quality-check');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const require = createRequire(import.meta.url);

function workspace(t, { prevGrade, currGrade, events }) {
  const ws = mkdtempSync(join(tmpdir(), 'skill-quality-check-'));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  const bin = join(ws, 'bin');
  const gep = join(ws, 'skills', 'capability-evolver', 'assets', 'gep');
  mkdirSync(bin);
  mkdirSync(join(ws, '.tmp'));
  mkdirSync(gep, { recursive: true });
  copyFileSync(SCRIPT, join(bin, 'skill-quality-check'));
  const audit = grade => ({ average_score: 80, grade_distribution: { [grade]: 1 }, skills: [{ name: 'x', grade }] });
  writeFileSync(join(bin, 'skill-audit'), `import json\nprint(json.dumps(${JSON.stringify(audit(currGrade))}))\n`);
  writeFileSync(join(ws, '.tmp', 'last-skill-audit.json'), JSON.stringify(audit(prevGrade)));
  if (events !== undefined) writeFileSync(join(gep, 'events.jsonl'), events);
  return { ws, gep, events: join(gep, 'events.jsonl') };
}

function run(ws) {
  const r = spawnSync('bash', [join(ws, 'bin', 'skill-quality-check')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

function lastEvent(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  return JSON.parse(lines.at(-1));
}

describe('skill-quality-check', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('chains its EvolutionEvent to the previous event id', t => {
    const w = workspace(t, {
      prevGrade: 'A',
      currGrade: 'B',
      events: '{"type":"EvolutionEvent","id":"evt_1","parent":null}\n',
    });
    run(w.ws);
    const ev = lastEvent(w.events);
    assert.equal(ev.type, 'EvolutionEvent');
    assert.equal(typeof ev.id, 'string');
    assert.match(ev.id, /^evt_\d+$/);
    assert.equal(ev.parent, 'evt_1');

    const prev = process.env.GEP_ASSETS_DIR;
    process.env.GEP_ASSETS_DIR = w.gep;
    t.after(() => {
      if (prev === undefined) delete process.env.GEP_ASSETS_DIR;
      else process.env.GEP_ASSETS_DIR = prev;
    });
    const { getLastEventId } = require('../skills/capability-evolver/src/gep/assetStore.js');
    assert.equal(getLastEventId(), ev.id);
  });

  it('records regressions without the REGRESSIONS: report prefix', t => {
    const w = workspace(t, { prevGrade: 'A', currGrade: 'B' });
    const r = run(w.ws);
    assert.match(r.stdout, /^REGRESSIONS: x: A->B$/m);
    assert.deepEqual(lastEvent(w.events).changes.regressions, ['x: A->B']);
  });

  it('has no unread PREV_AVG', () => {
    assert.doesNotMatch(readFileSync(SCRIPT, 'utf8'), /PREV_AVG/);
  });

  it('starts a chain with a null parent when events.jsonl is new', t => {
    const w = workspace(t, { prevGrade: 'B', currGrade: 'A' });
    run(w.ws);
    const ev = lastEvent(w.events);
    assert.match(ev.id, /^evt_\d+$/);
    assert.equal(ev.parent, null);
  });
});
