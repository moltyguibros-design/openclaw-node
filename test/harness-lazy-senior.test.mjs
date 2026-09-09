/**
 * harness-lazy-senior.test.mjs — integrations plan step 1.3.
 *
 * The `lazy-senior-ladder` rule has three moving parts and each fails silently
 * if it drifts: the tier-2 activation gate decides whether workers ever see the
 * ladder, exec-safety decides whether the advisory command is allowed to run at
 * all, and the detector decides what counts as a new dependency. All three are
 * exercised here against the shipped config and a real git repository.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO = path.resolve(import.meta.dirname, '..');
const RULES = path.join(REPO, 'config', 'harness-rules.json');
const DETECTOR = path.join(REPO, 'bin', 'check-added-deps.sh');

const { loadHarnessRules, formatHarnessForPrompt, rulesByEnforcement } = require('../lib/mesh-harness.js');
const { validateExecCommand } = require('../lib/exec-safety.js');

const ladderOf = (scope) => loadHarnessRules(RULES, scope).find(r => r.id === 'lazy-senior-ladder');

describe('lazy-senior-ladder rule', () => {
  it('ships in both scopes as a tier-2 inject rule', () => {
    for (const scope of ['local', 'mesh']) {
      const rule = ladderOf(scope);
      assert.ok(rule, `missing in ${scope} scope`);
      assert.equal(rule.tier, 2);
      assert.equal(rule.type, 'inject');
      assert.ok(rule.content.includes('YAGNI'));
      assert.ok(rule.activateOn.length > 0);
    }
  });

  it('reaches a worker whose task reads like implementation work, and stays quiet otherwise', () => {
    const rules = loadHarnessRules(RULES, 'mesh');
    // The activation string mesh-agent builds: markers plus the task title and body.
    const forTask = (title) => formatHarnessForPrompt(rules, `task start\nstatus: running\n${title}`);
    for (const title of ['Implement the retry helper', 'Refactor the queue', 'Add a feature to the kanban']) {
      assert.match(forTask(title), /lazy-senior ladder/, `should activate on: ${title}`);
    }
    for (const title of ['Summarize yesterday notes', 'Update the changelog']) {
      assert.doesNotMatch(forTask(title), /lazy-senior ladder/, `should stay quiet on: ${title}`);
    }
  });

  it('carries an advisory post_validate command that exec-safety permits', () => {
    const rule = ladderOf('mesh');
    assert.equal(rule.mesh_enforcement, 'post_validate');
    assert.ok(rulesByEnforcement(loadHarnessRules(RULES, 'mesh'), 'post_validate').some(r => r.id === rule.id));
    assert.deepEqual(validateExecCommand(rule.mesh_validate_command), { allowed: true });
  });
});

describe('check-added-deps.sh', () => {
  let repo;
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  const commit = (msg) => { git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg); };
  const run = () => {
    try {
      return { code: 0, out: execFileSync('bash', [DETECTOR], { cwd: repo, encoding: 'utf8' }) };
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
  };

  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'ladder-'));
    git('init', '-q');
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', dependencies: { left: '^1.0.0' } }, null, 2));
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 1;\n');
    commit('initial');
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  it('passes a commit that only changes code', () => {
    writeFileSync(path.join(repo, 'src', 'a.js'), 'export const a = 2;\n');
    commit('tweak');
    assert.deepEqual(run(), { code: 0, out: '' });
  });

  it('flags a commit that adds an npm dependency, naming it', () => {
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'x', dependencies: { left: '^1.0.0', 'is-odd': '^3.0.1' } }, null, 2));
    commit('add is-odd');
    const { code, out } = run();
    assert.equal(code, 1);
    assert.match(out, /new dependency in this commit/);
    assert.match(out, /is-odd/);
  });

  it('flags a python requirement and a Cargo entry too', () => {
    writeFileSync(path.join(repo, 'requirements.txt'), 'requests==2.32.0\n');
    commit('add requests');
    assert.equal(run().code, 1);
    writeFileSync(path.join(repo, 'Cargo.toml'), '[dependencies]\nserde = { version = "1.0" }\n');
    commit('add serde');
    assert.equal(run().code, 1);
  });

  it('survives a repository whose only commit is its first', () => {
    const fresh = mkdtempSync(path.join(tmpdir(), 'ladder-first-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: fresh });
      writeFileSync(path.join(fresh, 'src.js'), 'const a = 1;\n');
      execFileSync('git', ['add', '-A'], { cwd: fresh });
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'first'], { cwd: fresh });
      const out = execFileSync('bash', [DETECTOR], { cwd: fresh, encoding: 'utf8' });
      assert.equal(out, '');
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});
