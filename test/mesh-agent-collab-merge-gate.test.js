#!/usr/bin/env node
/**
 * mesh-agent-collab-merge-gate.test.js — a converged collab member's worktree
 * reaches main only through the solo path's mechanical gates: review-only
 * members and circling reviewers never merge, and a secret or out-of-scope edit
 * drops that member's contribution. Real git workspace, NATS faked, repo
 * harness rules (config/harness-rules.json).
 *
 * Run: node --test test/mesh-agent-collab-merge-gate.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-collab-gate-'));
const WORKSPACE = path.join(TMP, 'workspace');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  OPENCLAW_HARNESS_RULES: path.join(__dirname, '..', 'config', 'harness-rules.json'),
  MESH_MEMORY_RECALL: 'off',
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

const sc = StringCodec();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

// Appends task.stub_line to task.stub_file in the worktree it was given, then prints a converged reflection.
registerProvider('collab-write-stub', {
  binary: process.execPath,
  buildArgs(prompt, model, task, targetDir) {
    return ['-e', "const fs=require('fs'),p=require('path');const f=p.join(process.argv[1],process.argv[2]);fs.mkdirSync(p.dirname(f),{recursive:true});fs.appendFileSync(f,process.argv[3]+'\\n');process.stdout.write(process.argv[4])",
      targetDir, task.stub_file, task.stub_line, task.stub_output];
  },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function freshWorkspace() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORKSPACE, 'src'), { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  fs.writeFileSync(path.join(WORKSPACE, 'src', 'limiter.js'), '// base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
}

function fakeBus(rounds) {
  let reflected = 0;
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        let reply = {};
        if (subject === 'mesh.collab.join') {
          reply = { session_id: payload.session_id, status: 'recruiting', current_round: 0, nodes: [{ node_id: payload.node_id }] };
        } else if (subject === 'mesh.collab.reflect') {
          reflected += 1;
        } else if (subject === 'mesh.collab.status') {
          reply = { status: reflected >= rounds.length ? 'completed' : 'active' };
        }
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
      subscribe() {
        return {
          unsubscribe() {},
          async *[Symbol.asyncIterator]() { for (const r of rounds) yield { data: sc.encode(JSON.stringify(r)) }; },
        };
      },
    },
  });
}

const PARALLEL_OUT = 'done\n```json\n{"summary":"done","learnings":"","confidence":0.9,"vote":"converged"}\n```';
const WORK = 'The limiter keeps a sliding window per key and resets it on expiry. '.repeat(8);
const SIGNOFF = 'Signed off.\n===CIRCLING_REFLECTION===\ntype: reviewSignoff\nsummary: ok\nconfidence: 0.9\nvote: converged\n===END_REFLECTION===\n';

function task(id, extra = {}) {
  return {
    task_id: id, title: 'Harden the limiter', description: 'add the reset path',
    collaboration: { mode: 'parallel' }, collab_session_id: `S-${id}`, llm_provider: 'collab-write-stub',
    stub_file: 'src/limiter.js', stub_line: '// reset path', stub_output: PARALLEL_OUT,
    lease_token: 'lease-test', scope: ['src/**'], ...extra,
  };
}
const round = (fields) => ({ round_number: 1, mode: 'parallel', my_role: 'worker', my_scope: ['src/**'], shared_intel: '', ...fields });
const mainFile = (rel) => git(WORKSPACE, 'show', `main:${rel}`);
const branches = () => git(WORKSPACE, 'branch', '--list', 'mesh/*');

describe('collab merge gate', () => {
  beforeEach(freshWorkspace);

  it('a clean in-scope worker contribution merges into main', async () => {
    fakeBus([round({})]);
    await agent.__test.executeCollabTask(task('G-1'));
    assert.match(mainFile('src/limiter.js'), /reset path/);
  });

  it('a [REVIEW-ONLY] member is discarded, even for an edit inside the stripped scope', async () => {
    fakeBus([round({ my_role: 'reviewer', my_scope: ['[REVIEW-ONLY] src/**'] })]);
    await agent.__test.executeCollabTask(task('G-2'));
    assert.doesNotMatch(mainFile('src/limiter.js'), /reset path/);
    assert.equal(branches(), '', 'no branch is kept for a reviewer');
  });

  it('a circling reviewer is discarded', async () => {
    fakeBus([round({ mode: 'circling_strategy', my_role: 'reviewer', my_scope: [], circling_phase: 'finalization', circling_step: 0, circling_subround: 1, directed_input: WORK })]);
    await agent.__test.executeCollabTask(task('G-3', { collaboration: { mode: 'circling_strategy' }, stub_output: SIGNOFF }));
    assert.doesNotMatch(mainFile('src/limiter.js'), /reset path/);
  });

  it('an out-of-scope edit drops the member contribution', async () => {
    fakeBus([round({})]);
    await agent.__test.executeCollabTask(task('G-4', { stub_file: 'README' }));
    assert.equal(mainFile('README'), 'base');
    assert.equal(git(WORKSPACE, 'log', '--oneline', 'main').split('\n').length, 1, 'nothing merged');
  });

  it('a hardcoded secret drops the member contribution', async () => {
    fakeBus([round({})]);
    await agent.__test.executeCollabTask(task('G-5', { stub_line: ['const api', 'key = "live-0123456789abcdef";'].join('_') }));
    assert.doesNotMatch(mainFile('src/limiter.js'), /api_key/);
    assert.equal(branches(), '');
  });
});
