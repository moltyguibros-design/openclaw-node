/**
 * temp-dir-cleanup.test.mjs — drift lock: a test file that makes a dir under
 * the system temp dir removes it. Twenty-seven files leaked SQLite DBs, vaults and
 * git repos into /tmp on every run; they now go through helpers/tmp-dir.cjs,
 * which removes them on exit even when an assertion throws first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './helpers/tmp-dir.cjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MKDTEMP_UNDER_TMP = /mkdtemp(?:Sync)?\((?:path\.)?join\((?:os\.)?tmpdir\(\)/;
const REMOVES = /rmSync|\brm\(|rmdirSync|rm -rf|\.rm\(/;

test('every test file that mkdtemps under the temp dir also removes it', () => {
  const offenders = readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs|cjs)$/.test(f))
    .filter((f) => {
      const code = readFileSync(join(TEST_DIR, f), 'utf8')
        .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return MKDTEMP_UNDER_TMP.test(code) && !REMOVES.test(code);
    });
  assert.deepEqual(offenders, [], 'use tmpDir() from ./helpers/tmp-dir.cjs, or remove the dir in an after hook');
});

// The check above passes any file that removes something; a file on tmpDir()
// gets its dirs removed only if every one of them goes through it.
test('a test file on tmpDir() makes no raw mkdtemp under the temp dir', () => {
  const offenders = readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs|cjs)$/.test(f))
    .filter((f) => {
      const src = readFileSync(join(TEST_DIR, f), 'utf8');
      return src.includes('helpers/tmp-dir.cjs') && MKDTEMP_UNDER_TMP.test(src);
    });
  assert.deepEqual(offenders, [], 'route every temp dir through tmpDir()');
});

test('tmpDir() removes its dirs on exit, even after a failure', () => {
  const helper = join(TEST_DIR, 'helpers', 'tmp-dir.cjs');
  const r = spawnSync(process.execPath, ['-e', `
    const { tmpDir } = require(${JSON.stringify(helper)});
    const a = tmpDir('tmp-dir-probe-');
    require('fs').writeFileSync(a + '/state.db', 'x');
    console.log(a);
    console.log(tmpDir('tmp-dir-probe-'));
    throw new Error('assertion failed');
  `], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  const dirs = r.stdout.trim().split('\n');
  assert.equal(dirs.length, 2);
  for (const d of dirs) assert.equal(existsSync(d), false, `${d} left behind`);
});

// mesh-agent's per-node work dir is a fixed path reused across runs, not a
// per-run leak.
const FIXED_WORK_DIR = /^mesh-agent-work-/;

// obs-db flushes on exit after tmp-dir's remover has run, so an obs DB inside
// a tmpDir() dir re-creates that dir.
test('a test file on tmpDir() keeps the obs DB in memory', () => {
  const offenders = readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs|cjs)$/.test(f))
    .filter((f) => {
      const src = readFileSync(join(TEST_DIR, f), 'utf8');
      return src.includes('helpers/tmp-dir.cjs') && /OPENCLAW_OBS_DB['"]?\s*[:=](?!\s*['"]:memory:['"])/.test(src);
    });
  assert.deepEqual(offenders, [], "set OPENCLAW_OBS_DB to ':memory:'");
});

for (const suite of [
  'collab-max-rounds-review.test.js',
  'collab-member-token.test.js',
  'daemon-role-validation.test.js',
  'daemon-terminal-task.test.js',
  'mesh-agent-metric-sink.test.js',
  'plan-cas.test.js',
  'mesh-agent-cli-cost.test.js',
  'mesh-agent-memory-recall.test.mjs',
  'mesh-agent-review-gate.test.js',
  'mesh-agent-terminal-task.test.js',
  'obsidian-decision-theme-notes.test.mjs',
  'publishers.test.mjs',
]) {
  test(`${suite} leaves its temp dir empty after it exits`, () => {
    const tmp = tmpDir('tmp-dir-run-');
    const env = { ...process.env, TMPDIR: tmp };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', join(TEST_DIR, suite)], { encoding: 'utf8', env, timeout: 120_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(readdirSync(tmp).filter((f) => !FIXED_WORK_DIR.test(f)), []);
  });
}
