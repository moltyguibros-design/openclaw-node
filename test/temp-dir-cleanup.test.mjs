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
