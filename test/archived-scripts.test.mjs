/**
 * archived-scripts.test.mjs — follow-up#11 (operator choice B). Two one-off
 * scripts nothing calls sat in the repo root and scripts/; they now live in
 * scripts/archive/, and their relative imports still resolve from there.
 *
 * Run: node --test test/archived-scripts.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = join(ROOT, 'scripts', 'archive');

test('the one-off scripts sit in scripts/archive/, not where they were', () => {
  assert.deepEqual(readdirSync(ARCHIVE).sort(), ['migrate-companion-state.mjs', 'test-session-note-runtime.mjs']);
  assert.ok(!existsSync(join(ROOT, 'test-session-note-runtime.mjs')));
  assert.ok(!existsSync(join(ROOT, 'scripts', 'migrate-companion-state.mjs')));
});

test('every relative import of an archived script resolves', () => {
  for (const name of readdirSync(ARCHIVE)) {
    const src = readFileSync(join(ARCHIVE, name), 'utf8');
    const specs = [...src.matchAll(/^import [^'"]*['"](\.{1,2}\/[^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(specs.length > 0, `${name} imports nothing relative`);
    for (const spec of specs) assert.ok(existsSync(resolve(ARCHIVE, spec)), `${name}: ${spec} does not resolve`);
  }
});
