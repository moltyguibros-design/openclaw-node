/**
 * ui-ux-pro-max.test.mjs — the vendored scripts looked for their CSVs in
 * skills/ui-ux-pro-max/data, but the data ships in assets/data, so every
 * search returned "File not found" and the design-system generator ran with
 * no reasoning rules. -B keeps python from writing __pycache__ into the repo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
