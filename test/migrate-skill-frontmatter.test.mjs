import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/migrate-skill-frontmatter', import.meta.url));
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

const SKILL = '---\nname: demo\ndescription: >-\n  Folded text.\ntriggers:\n  - "do the thing"\n---\n\nBody\n';

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
