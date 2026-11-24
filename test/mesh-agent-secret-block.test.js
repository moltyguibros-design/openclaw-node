#!/usr/bin/env node
/**
 * mesh-agent-secret-block.test.js — a secret the harness caught never reaches a commit.
 * The real solo path (executeTask) and worker-error path (onWorkerError) in a real git
 * workspace, NATS faked, a stub provider that writes files into its worktree.
 *
 * A secrets block used to `continue` with the secret still in the worktree; the release
 * and TASK_TERMINAL paths then committed it unscanned onto the kept mesh/<task> branch,
 * and the retry prompt claimed every failed attempt was "reverted".
 *
 * Run: node --test test/mesh-agent-secret-block.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-secret-block-'));
const WORKSPACE = path.join(TMP, 'workspace');
const RULES = path.join(TMP, 'harness-rules.json');
fs.writeFileSync(RULES, JSON.stringify([
  { id: 'no-hardcoded-secrets', scope: ['mesh'], active: true, mesh_enforcement: 'pre_commit_scan' },
]));
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  MESH_LEASE_DIR: path.join(TMP, 'leases'),
  MESH_MAX_ATTEMPTS: '2',
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  OPENCLAW_HARNESS_RULES: RULES,
  MESH_MEMORY_RECALL: 'off',
  MESH_FOREMAN: '0',
  // The regex fallback is the scan under test; a host gitleaks would answer first.
  PATH: process.env.PATH.split(path.delimiter).filter((dir) => !fs.existsSync(path.join(dir, 'gitleaks'))).join(path.delimiter),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { registerProvider } = require('../lib/llm-providers.js');
const agent = require('../bin/mesh-agent.js');
const { TASK_TERMINAL } = require('../lib/mesh-tasks');

const sc = StringCodec();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
// Assembled at run time so this file itself does not trip the repo's commit-time scan.
const SECRET = `${'pass'}${'word'} = "hunter2-correct-horse"\n`;
const LOG = path.join(TMP, 'provider.jsonl');
const PROMPTS = path.join(TMP, 'prompts.jsonl');

// The first attempt writes a secret (and, in `exit1` mode, fails). Every attempt first notes
// whether the secret is there; a retry in `once` mode then writes clean work instead.
registerProvider('secret-stub', {
  binary: process.execPath,
  buildArgs(prompt, model, task, targetDir) {
    const script = `
      const fs = require('fs'), p = require('path');
      const [dir, log, mode, retry] = process.argv.slice(1);
      fs.appendFileSync(log, JSON.stringify({ secretPresent: fs.existsSync(p.join(dir, 'config.js')) }) + '\\n');
      if (retry === '1' && mode === 'once') { fs.writeFileSync(p.join(dir, 'clean.txt'), 'clean work\\n'); process.stdout.write('done'); }
      else { fs.writeFileSync(p.join(dir, 'config.js'), ${JSON.stringify(SECRET)}); fs.writeFileSync(p.join(dir, 'notes.txt'), 'notes\\n'); process.stdout.write('wrote config'); if (mode === 'exit1') process.exitCode = 1; }`;
    fs.appendFileSync(PROMPTS, JSON.stringify(prompt) + '\n');
    return ['-e', script, targetDir, LOG, task.stub_mode, prompt.includes('## Previous Attempts') ? '1' : '0'];
  },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function freshWorkspace() {
  for (const f of [LOG, PROMPTS]) fs.rmSync(f, { force: true });
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
}

function fakeDaemon() {
  const seen = {};
  agent.__test.setContext({
    nc: {
      isClosed: () => false,
      async flush() {},
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        (seen[subject] ||= []).push(payload);
        const reply = subject === 'mesh.tasks.complete' ? { task_id: payload.task_id, status: 'pending_review' } : {};
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
    },
  });
  return seen;
}

const task = (id, mode) => ({
  task_id: id, title: 'wire the config', description: 'wire it', budget_minutes: 5,
  llm_provider: 'secret-stub', stub_mode: mode, scope: [], lease_token: 'lease-test',
});
const lines = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const branchExists = (id) => git(WORKSPACE, 'branch', '--list', `mesh/${id}`) !== '';

describe('a secrets block', () => {
  beforeEach(freshWorkspace);

  it('resets the worktree before the next attempt, and the retry prompt says so', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('S-1', 'once'));
    assert.deepEqual(lines(LOG).map((c) => c.secretPresent), [false, false], 'the second attempt starts without the secret');
    assert.match(lines(PROMPTS)[1], /Kept: no \(the worktree was reset to HEAD; its changes are gone\)/);
    assert.equal(seen['mesh.tasks.attempt'][0].reset, true);
    assert.equal(seen['mesh.tasks.complete'].length, 1);
    const files = git(WORKSPACE, 'ls-tree', '-r', '--name-only', 'mesh/S-1').split('\n');
    assert.deepEqual(files.sort(), ['README', 'clean.txt']);
  });

  it('a release after secret-only attempts keeps no secret on any branch', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('S-2', 'always-secret'));
    assert.equal(seen['mesh.tasks.release'].length, 1);
    assert.deepEqual(lines(LOG).map((c) => c.secretPresent), [false, false]);
    assert.equal(git(WORKSPACE, 'rev-parse', 'mesh/S-2'), git(WORKSPACE, 'rev-parse', 'main'), 'nothing was committed onto the branch');
    assert.equal(fs.existsSync(path.join(process.env.MESH_WORKTREE_BASE, 'S-2')), false);
  });
});

describe('a partial commit is scanned for secrets first', () => {
  beforeEach(freshWorkspace);

  it('the release path skips the commit and drops the branch when the leftovers hold a secret', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('S-3', 'exit1'));
    assert.equal(seen['mesh.tasks.release'].length, 1);
    assert.match(lines(PROMPTS)[1], /Kept: no \(its changes are still in the worktree\)/);
    assert.equal(branchExists('S-3'), false, 'no post-mortem branch carries the secret');
  });

  it('the TASK_TERMINAL path skips the commit when the leftovers hold a secret', async () => {
    const worktree = agent.__test.createWorktree('S-4');
    fs.writeFileSync(path.join(worktree, 'config.js'), SECRET);
    const err = Object.assign(new Error('Task S-4 is already failed'), { code: TASK_TERMINAL, taskStatus: 'failed' });
    await agent.__test.onWorkerError({ task_id: 'S-4', title: 'x' }, Date.now(), err);
    assert.equal(fs.existsSync(worktree), false);
    assert.equal(branchExists('S-4'), false);
  });

  it('clean leftovers are still committed and kept for post-mortem', async () => {
    const worktree = agent.__test.createWorktree('S-5');
    fs.writeFileSync(path.join(worktree, 'partial.txt'), 'half done\n');
    const err = Object.assign(new Error('Task S-5 is already failed'), { code: TASK_TERMINAL, taskStatus: 'failed' });
    await agent.__test.onWorkerError({ task_id: 'S-5', title: 'x' }, Date.now(), err);
    assert.equal(git(WORKSPACE, 'show', 'mesh/S-5:partial.txt'), 'half done');
  });
});
