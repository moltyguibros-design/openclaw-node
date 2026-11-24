import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/migrate-skill-frontmatter', import.meta.url));
const skillAudit = fileURLToPath(new URL('../workspace-bin/skill-audit', import.meta.url));
const workspaceBin = fileURLToPath(new URL('../workspace-bin', import.meta.url));
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

function parseFrontmatter(text) {
  const r = spawnSync('python3', ['-B', '-c',
    'import json, sys\nsys.path.insert(0, sys.argv[1])\nfrom lib.frontmatter import parse_frontmatter\nprint(json.dumps(parse_frontmatter(sys.stdin.read())[0]))',
    workspaceBin], { input: text, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

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
    assert.match(fm, /^triggers:\n {2}- do the thing$/m);
    assert.match(fm, /^negative_triggers:\n {2}- not that$/m);
    assert.match(fm, /^metadata:\n {2}openclaw:\n {4}version: 1\.0\.0$/m);
  });

  it('writes frontmatter that skill-audit still reads: every trigger and the whole description', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-skill-fm-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const description = `Fetch a webpage and produce a short summary of it, keeping the key facts. ${'Use when the user pastes a link and wants the gist of the page quickly. '.repeat(2)}`.trim();
    assert.ok(description.length > 120);
    const skillMd = path.join(root, 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillMd));
    fs.writeFileSync(skillMd, [
      '---', 'name: demo', `description: ${description}`, 'version: 1.0.0', 'homepage: https://x',
      'triggers:', ...['summarize this url', 'tldr this page', 'gist of link', 'summarize webpage', 'page summary'].map(s => `  - "${s}"`),
      'negative_triggers:', ...['translate this', 'write an essay', 'search the web'].map(s => `  - "${s}"`),
      '---', '', '# Demo', '',
    ].join('\n'));
    const migrate = spawnSync('python3', ['-B', script, '--apply', '--skills-dir', root], { encoding: 'utf8' });
    assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);

    const audit = spawnSync('python3', ['-B', skillAudit, '--skills-dir', root, '--json'], { encoding: 'utf8' });
    assert.equal(audit.status, 0, audit.stderr);
    const { checks } = JSON.parse(audit.stdout).skills[0];
    assert.equal(checks.triggers_exist.message, 'OK (5 triggers)');
    assert.equal(checks.negative_triggers_exist.message, 'OK (3 negative triggers)');
    assert.equal(parseFrontmatter(fs.readFileSync(skillMd, 'utf8')).description, description);
  });
});

describe('lib/frontmatter.py', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('reads an indentless list as a list and still keeps a nested block raw', () => {
    const fm = parseFrontmatter('---\nname: x\ntriggers:\n- "do a"\n- do b\nmetadata:\n  openclaw:\n    v: 1\n---\nbody\n');
    assert.deepEqual(fm.triggers, ['do a', 'do b']);
    assert.equal(fm.metadata, 'openclaw:\n    v: 1');
  });
});
