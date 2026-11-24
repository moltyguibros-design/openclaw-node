/**
 * mesh-agent-foreman-off-census.test.mjs — a suite that drives the real
 * executeTask turns Foreman off unless it is testing Foreman. Supervision is on
 * by default and builds a real LLM assessor, so each task in such a suite
 * waited ~7 s on retries here and sent assessment prompts to the live model on
 * a node.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FOREMAN_TITLE = /\b(?:it|test|describe)\(\s*['"`][^'"`]*foreman/i;
const FOREMAN_OFF = /MESH_FOREMAN\s*[:=]\s*['"]0['"]/;

test('every executeTask suite sets MESH_FOREMAN=0 unless it tests Foreman', () => {
  const suites = readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs|cjs)$/.test(f))
    .filter((f) => readFileSync(join(TEST_DIR, f), 'utf8').includes('__test.executeTask('));
  assert.ok(suites.length > 0);
  const offenders = suites.filter((f) => {
    const src = readFileSync(join(TEST_DIR, f), 'utf8');
    return !FOREMAN_TITLE.test(src) && !FOREMAN_OFF.test(src);
  });
  assert.deepEqual(offenders, [], "add MESH_FOREMAN: '0' to the env set before bin/mesh-agent.js loads");
});
