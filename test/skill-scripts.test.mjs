/**
 * skill-scripts.test.mjs — small defects in bundled skill helper scripts.
 *
 * prepush_check.sh and triage_snapshot.sh printed every section header as a
 * literal "\n[1/6] ..." (bash echo does not expand \n), and prepush_check.sh
 * refused a git worktree because it tested for a .git directory.
 * agentic-compass.py labelled local time "UTC". init-campaign.sh joined an
 * unvalidated name into a path ("../x" escaped campaigns/) and into JSON.
 */
import { describe, it } from 'node:test';
import { tmpDir } from './helpers/tmp-dir.cjs';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const LITERAL_NEWLINE_HEADER = /\\n\[/;

// git in a sandbox: no user/system config (hooks, signing), fixed identity.
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' });

describe('arcane-dev-ops prepush_check.sh', () => {
  const SCRIPT = join(SKILLS, 'arcane-dev-ops', 'scripts', 'prepush_check.sh');
  const tmp = tmpDir('prepush-');
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'init');
  const wt = join(tmp, 'wt');
  git(repo, 'worktree', 'add', '-q', wt);

  const run = (path) => spawnSync('bash', [SCRIPT, path, 'true'], { env: GIT_ENV, encoding: 'utf8' });

  it('prints section headers on their own lines', () => {
    const r = run(repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, LITERAL_NEWLINE_HEADER);
    assert.match(r.stdout, /^\[1\/6\] Branch$/m);
  });

  it('accepts a git worktree, whose .git is a file', () => {
    const r = run(wt);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /not a git repository/);
  });

  it('still refuses a directory outside any repository', () => {
    const plain = tmpDir('prepush-plain-');
    const r = run(plain);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /is not a git repository/);
  });
});

describe('discord-telegram-triage triage_snapshot.sh', () => {
  it('prints section headers on their own lines', () => {
    const bin = tmpDir('triage-bin-');
    writeFileSync(join(bin, 'openclaw'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'openclaw'), 0o755);
    const r = spawnSync('bash', [join(SKILLS, 'discord-telegram-triage', 'scripts', 'triage_snapshot.sh')], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, LITERAL_NEWLINE_HEADER);
    assert.match(r.stdout, /^\[1\/3\] Deep status$/m);
  });
});

describe('agentic-compass.py --write', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('labels the report timestamp with the local zone, not UTC', () => {
    const tmp = tmpDir('compass-');
    const r = spawnSync('python3', [
      join(SKILLS, 'agentic-compass', 'scripts', 'agentic-compass.py'),
      '--daily', join(tmp, 'd.md'), '--long', join(tmp, 'M.md'), '--write',
    ], { env: { ...process.env, TZ: 'XYZ+3' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = readFileSync(join(tmp, 'agentic-compass.md'), 'utf8');
    assert.match(out, /^## Agentic Compass Report — \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} XYZ$/m);
    assert.doesNotMatch(out, /UTC/);
  });

  // 'incorrect' and 'corrections' matched the unbounded 'correct' confirmation pattern.
  it('counts whole-word confirmations and corrections only', () => {
    const probe = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("compass", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(m.score_response_relevance("That was incorrect. Wrong again. Two corrections needed."))
print(m.score_response_relevance("That is correct, thanks that helped")[1])
`;
    const r = spawnSync('python3', ['-I', '-B', '-c', probe,
      join(SKILLS, 'agentic-compass', 'scripts', 'agentic-compass.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'),
      ["(0.0, '0 confirmations, 2 corrections')", '2 confirmations, 0 corrections']);
  });

  it('documents that only the proactive plan line is derived from the scores', () => {
    const doc = readFileSync(join(SKILLS, 'agentic-compass', 'SKILL.md'), 'utf8');
    assert.match(doc, /deferred, avoidance and ship lines are fixed\s+prompts/i);
    assert.match(doc, /^- Deferred: retry any blocked items after diagnostic$/m);
  });
});

describe('growth-loop init-campaign.sh', () => {
  const SCRIPT = join(SKILLS, 'growth-loop', 'scripts', 'init-campaign.sh');
  const run = (cwd, name) => spawnSync('bash', [SCRIPT, name, 'blog'], { cwd, encoding: 'utf8' });

  it('refuses a name that escapes campaigns/', () => {
    const cwd = join(tmpDir('campaign-'), 'x');
    mkdirSync(cwd);
    const r = run(cwd, '../escape');
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(cwd, 'escape')), false);
  });

  it('refuses a name that would break config.json', () => {
    const cwd = tmpDir('campaign-');
    const r = run(cwd, 'a"b');
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(cwd, 'campaigns', 'a"b')), false);
  });

  it('scaffolds a plain name with valid JSON config', () => {
    const cwd = tmpDir('campaign-');
    const r = run(cwd, 'spring-launch');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const config = JSON.parse(readFileSync(join(cwd, 'campaigns', 'spring-launch', 'config.json'), 'utf8'));
    assert.equal(config.name, 'spring-launch');
    assert.equal(config.platform, 'blog');
  });
});

// clawddocs shipped seven echo-only stubs (fetch-doc printed the URL, cache always
// said "OK"), so an agent following SKILL.md believed it had read docs it never saw.
describe('clawddocs', () => {
  const DIR = join(SKILLS, 'clawddocs');
  const skill = readFileSync(join(DIR, 'SKILL.md'), 'utf8');

  it('ships no helper scripts', () => {
    assert.equal(existsSync(join(DIR, 'scripts')), false);
    assert.doesNotMatch(skill, /scripts\//);
  });

  it('fetches the current docs site with the web-fetch tool', () => {
    assert.match(skill, /https:\/\/docs\.openclaw\.ai\/<path>/);
    assert.match(skill, /web-fetch tool/);
    assert.doesNotMatch(skill, /docs\.clawd\.bot/);
  });

  // Routing excluded "openclaw documentation", and the bundled snippets moved the
  // gateway off loopback to 0.0.0.0:8080 with channel keys the node does not use.
  it('routes on OpenClaw and ships no config snippets', () => {
    const front = skill.split(/^---$/m)[1];
    const list = (key) => (front.match(new RegExp(`^${key}:\\n((?:  - .*\\n)+)`, 'm'))?.[1] ?? '')
      .split('\n').filter(Boolean).map((l) => l.replace(/^  - "?|"$/g, ''));
    const triggers = list('triggers');
    assert.ok(triggers.includes('openclaw documentation'), triggers.join(', '));
    assert.deepEqual(triggers.filter((t) => /clawdbot/i.test(t)), []);
    assert.ok(!list('negative_triggers').includes('openclaw documentation'));
    assert.doesNotMatch(skill, /Clawdbot/);
    assert.equal(existsSync(join(DIR, 'snippets')), false);
    assert.doesNotMatch(skill, /snippets\/|0\.0\.0\.0/);
  });
});

// The installer installs a skill's Python deps only from its requirements.txt, so
// web-search, without one, exited "Missing required dependency" on every node.
describe('skill Python dependencies', () => {
  const PIP = { duckduckgo_search: 'duckduckgo-search', requests: 'requests', yaml: 'pyyaml', matplotlib: 'matplotlib' };
  const IMPORT = new RegExp(`^\\s*(?:import|from)\\s+(${Object.keys(PIP).join('|')})\\b`, 'gm');
  const py = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : py(join(dir, e.name));
    return e.name.endsWith('.py') ? [join(dir, e.name)] : [];
  });

  it('every shipped skill that imports a pip package lists it in requirements.txt', () => {
    const missing = [];
    for (const e of readdirSync(SKILLS, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === '_quarantine') continue;
      const dir = join(SKILLS, e.name);
      const needs = new Set(py(dir).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(IMPORT)].map((m) => PIP[m[1]])));
      const req = existsSync(join(dir, 'requirements.txt')) ? readFileSync(join(dir, 'requirements.txt'), 'utf8').toLowerCase() : '';
      for (const pkg of needs) if (!new RegExp(`^${pkg}\\b`, 'm').test(req)) missing.push(`${e.name}: ${pkg}`);
    }
    assert.deepEqual(missing, []);
  });
});
