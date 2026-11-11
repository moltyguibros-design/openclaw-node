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
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  const tmp = mkdtempSync(join(tmpdir(), 'prepush-'));
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
    const plain = mkdtempSync(join(tmpdir(), 'prepush-plain-'));
    const r = run(plain);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /is not a git repository/);
  });
});

describe('discord-telegram-triage triage_snapshot.sh', () => {
  it('prints section headers on their own lines', () => {
    const bin = mkdtempSync(join(tmpdir(), 'triage-bin-'));
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
    const tmp = mkdtempSync(join(tmpdir(), 'compass-'));
    const r = spawnSync('python3', [
      join(SKILLS, 'agentic-compass', 'scripts', 'agentic-compass.py'),
      '--daily', join(tmp, 'd.md'), '--long', join(tmp, 'M.md'), '--write',
    ], { env: { ...process.env, TZ: 'XYZ+3' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = readFileSync(join(tmp, 'agentic-compass.md'), 'utf8');
    assert.match(out, /^## Agentic Compass Report — \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} XYZ$/m);
    assert.doesNotMatch(out, /UTC/);
  });
});

describe('growth-loop init-campaign.sh', () => {
  const SCRIPT = join(SKILLS, 'growth-loop', 'scripts', 'init-campaign.sh');
  const run = (cwd, name) => spawnSync('bash', [SCRIPT, name, 'blog'], { cwd, encoding: 'utf8' });

  it('refuses a name that escapes campaigns/', () => {
    const cwd = join(mkdtempSync(join(tmpdir(), 'campaign-')), 'x');
    mkdirSync(cwd);
    const r = run(cwd, '../escape');
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(cwd, 'escape')), false);
  });

  it('refuses a name that would break config.json', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'campaign-'));
    const r = run(cwd, 'a"b');
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(cwd, 'campaigns', 'a"b')), false);
  });

  it('scaffolds a plain name with valid JSON config', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'campaign-'));
    const r = run(cwd, 'spring-launch');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const config = JSON.parse(readFileSync(join(cwd, 'campaigns', 'spring-launch', 'config.json'), 'utf8'));
    assert.equal(config.name, 'spring-launch');
    assert.equal(config.platform, 'blog');
  });
});
