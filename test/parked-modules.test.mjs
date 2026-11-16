// Modules kept as parked federation/digest code carry a PARKED marker and have no
// production caller. If one gets wired, drop its marker (and its row here) so the
// label never claims a live module is idle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PARKED = [
  { file: 'lib/kanban-store.mjs', symbol: 'createKanbanStore' },
  { file: 'lib/artifacts.mjs', symbol: 'putArtifact' },
  { file: 'lib/artifacts.mjs', symbol: 'getArtifact' },
  { file: 'lib/obsidian-digest.mjs', symbol: 'generateWeeklyDigest' },
];
const PRODUCTION_DIRS = ['bin', 'lib', 'workspace-bin', 'scripts', 'skills', 'services', 'mission-control/src', 'packages'];
const SKIP = new Set(['node_modules', 'dist', '.next', 'test', 'tests', '__tests__']);

function* sources(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(c?js|mjs|ts|tsx|sh|py)$/.test(e.name) || !path.extname(e.name)) yield p;
  }
}

test('parked modules are marked PARKED and have no production caller', () => {
  const files = PRODUCTION_DIRS.flatMap(d => [...sources(path.join(ROOT, d))]);
  for (const { file, symbol } of PARKED) {
    assert.match(fs.readFileSync(path.join(ROOT, file), 'utf8'), /PARKED:/, file);
    const callers = files.filter(f => path.relative(ROOT, f) !== file && !/\.test\./.test(f)
      && new RegExp(`\\b${symbol}\\b`).test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(callers.map(f => path.relative(ROOT, f)), [], `${symbol} has a production caller; drop its PARKED marker`);
  }
});

test('the weekly digest is the parked export, not the wired daily one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/obsidian-digest.mjs'), 'utf8');
  const weekly = src.indexOf('export async function generateWeeklyDigest');
  const marker = src.lastIndexOf('PARKED:', weekly);
  assert.ok(marker > src.lastIndexOf('export async function generateDailyDigest', weekly), 'PARKED marker must sit on generateWeeklyDigest');
});
