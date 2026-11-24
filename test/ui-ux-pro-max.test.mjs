/**
 * ui-ux-pro-max.test.mjs — the vendored scripts looked for their CSVs in
 * skills/ui-ux-pro-max/data, but the data ships in assets/data, so every
 * search returned "File not found" and the design-system generator ran with
 * no reasoning rules. -B keeps python from writing __pycache__ into the repo.
 */
import { describe, it } from 'node:test';
import { tmpDir } from './helpers/tmp-dir.cjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'skills', 'ui-ux-pro-max', 'scripts');
const HAVE_PY = spawnSync('python3', ['--version']).status === 0;

function search(args) {
  const r = spawnSync('python3', ['-B', join(SCRIPTS, 'search.py'), ...args, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('ui-ux-pro-max scripts load their bundled data', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('domain search finds products', () => {
    const r = search(['saas dashboard', '--domain', 'product']);
    assert.equal(r.error, undefined, r.error);
    assert.ok(r.count > 0, `count ${r.count}`);
  });

  it('stack search finds react guidance', () => {
    const r = search(['form validation', '--stack', 'react']);
    assert.equal(r.error, undefined, r.error);
    assert.ok(r.count > 0, `count ${r.count}`);
  });

  it('design-system generator loads its reasoning rules', () => {
    const r = spawnSync('python3', [
      '-B', '-c',
      'import sys; sys.path.insert(0, sys.argv[1]); import design_system; '
        + 'n = len(design_system.DesignSystemGenerator().reasoning_data); assert n > 0, n',
      SCRIPTS,
    ], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
});

describe('ui-ux-pro-max --persist reports where it wrote', { skip: !HAVE_PY && 'python3 not available' }, () => {
  function persist(extra) {
    const out = tmpDir('uipro-');
    const r = spawnSync('python3', ['-B', join(SCRIPTS, 'search.py'), 'saas dashboard', '--design-system', '--persist', '-o', out, ...extra], { encoding: 'utf8', cwd: out });
    assert.equal(r.status, 0, r.stderr);
    return { out, stdout: r.stdout };
  }

  it('prints the MASTER.md it wrote, and MASTER.md names its own pages dir', () => {
    const { out, stdout } = persist([]);
    const master = join(out, 'design-system', 'saas-dashboard', 'MASTER.md');
    assert.ok(stdout.includes(master), stdout.slice(-600));
    assert.ok(existsSync(master));
    assert.match(readFileSync(master, 'utf8'), /`design-system\/saas-dashboard\/pages\/\[page-name\]\.md`/);
  });

  it('a page override names the project MASTER.md', () => {
    const { out, stdout } = persist(['--page', 'dashboard']);
    const page = join(out, 'design-system', 'saas-dashboard', 'pages', 'dashboard.md');
    assert.ok(stdout.includes(page), stdout.slice(-600));
    assert.match(readFileSync(page, 'utf8'), /`design-system\/saas-dashboard\/MASTER\.md`/);
  });
});
