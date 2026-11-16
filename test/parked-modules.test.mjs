// Modules kept as parked federation code carry a PARKED marker and have no
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

// generateWeeklyDigest was parked until the consolidation cycle wired it
// (consolidation: write the weekly digest on the first cycle of each ISO week).
test('the weekly digest carries no PARKED marker now that the consolidation cycle calls it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/obsidian-digest.mjs'), 'utf8');
  assert.doesNotMatch(src, /PARKED:/);
  assert.match(fs.readFileSync(path.join(ROOT, 'bin/consolidate.mjs'), 'utf8'), /\bgenerateWeeklyDigest\(/);
});
