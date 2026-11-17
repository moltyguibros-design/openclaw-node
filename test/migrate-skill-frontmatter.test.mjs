import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/migrate-skill-frontmatter', import.meta.url));
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

const SKILL = '---\nname: demo\ndescription: >-\n  Folded text.\nversion: 1.0.0\ntriggers:\n  - "do the thing"\n---\n\nBody\n';
const HAVE_PY_YAML = HAVE_PY && spawnSync('python3', ['-c', 'import yaml']).status === 0;

// A yaml.py that raises ImportError on PYTHONPATH reproduces a python3 without PyYAML.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-skill-fm-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shim = path.join(root, 'shim');
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, 'yaml.py'), 'raise ImportError("hidden")\n');
  const skillsDir = path.join(root, 'skills');
  fs.mkdirSync(path.join(skillsDir, 'demo'), { recursive: true });
  const skillMd = path.join(skillsDir, 'demo', 'SKILL.md');
  fs.writeFileSync(skillMd, SKILL);
  const run = (...args) => spawnSync('python3', ['-B', script, ...args, '--skills-dir', skillsDir],
    { encoding: 'utf8', env: { ...process.env, PYTHONPATH: shim } });
  return { skillMd, run };
}

describe('migrate-skill-frontmatter without PyYAML', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('refuses --apply and leaves the skill untouched', (t) => {
    const { skillMd, run } = fixture(t);
    const r = run('--apply');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /PyYAML/);
    assert.equal(fs.readFileSync(skillMd, 'utf8'), SKILL);
  });

  it('still reports a dry run with the basic parser', (t) => {
    const { skillMd, run } = fixture(t);
    const r = run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /would migrate/);
    assert.equal(fs.readFileSync(skillMd, 'utf8'), SKILL);
  });
});

describe('migrate-skill-frontmatter keeps triggers top-level', { skip: !HAVE_PY_YAML && 'python3 with PyYAML not available' }, () => {
  it('moves version under metadata.openclaw but leaves triggers where skill-audit reads them', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-skill-fm-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const skillMd = path.join(root, 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillMd));
    fs.writeFileSync(skillMd, SKILL.replace('  - "do the thing"\n', '  - "do the thing"\nnegative_triggers:\n  - "not that"\n'));
    const r = spawnSync('python3', ['-B', script, '--apply', '--skills-dir', root], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[version\]/);
    const fm = fs.readFileSync(skillMd, 'utf8').split('\n---')[0];
    assert.match(fm, /^triggers:\n- do the thing$/m);
    assert.match(fm, /^negative_triggers:\n- not that$/m);
    assert.match(fm, /^metadata:\n {2}openclaw:\n {4}version: 1\.0\.0$/m);
  });
});
