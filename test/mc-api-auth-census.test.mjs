/**
 * mc-api-auth-census.test.mjs — drift lock for review C-4.
 *
 * Mission Control denies every /api method without its session token. A
 * same-host caller that names a loopback :3000/api URL without reading the
 * token file gets a 401 it usually swallows: compile-boot's entity block,
 * test-multi-soul-workflow and the Souls page's curl guide all failed that way,
 * and so did the agent's own instructions in identity/ (heartbeat fact
 * extraction, the multi-soul curl recipes), which now go through bin/mc-api.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['bin', 'lib', 'workspace-bin', 'mission-control/src/app', 'identity'];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next']);
const SKIP_PATHS = new Set(['mission-control/src/app/api']);
const MC_API = /(localhost|127\.0\.0\.1):3000\/api/;
const SENDS_TOKEN = /mc-session-token|mcAuthHeaders/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (SKIP_DIRS.has(entry) || SKIP_PATHS.has(relative(ROOT, p))) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

test('every caller of a loopback MC /api URL sends the session token', () => {
  const offenders = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, 'utf8');
      if (MC_API.test(src) && !SENDS_TOKEN.test(src)) offenders.push(relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `MC /api callers without the session token:\n  ${offenders.join('\n  ')}`);
});

test('agent docs restart the managed Mission Control unit, never a dev server beside it', () => {
  const offenders = [...walk(join(ROOT, 'identity'))]
    .filter(f => /npm run dev\b/.test(readFileSync(f, 'utf8')))
    .map(f => relative(ROOT, f));
  assert.deepEqual(offenders, [], `docs that start a second MC on :3000:\n  ${offenders.join('\n  ')}`);
});
