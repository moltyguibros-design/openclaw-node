#!/usr/bin/env node
/**
 * mesh-agent-pre-check.test.js — audit install-infra-packaging#23, the worker
 * half. The real solo path of mesh-agent (executeTask) in a real git
 * workspace, with NATS faked.
 *
 * config/harness-rules.json's no-assume-running rule declares a pre_check of
 * nats, and nothing ran it. executeTask now probes the listed services before
 * any work: when one is down the task is released with the reason and never
 * started.
 *
 * Run: node --test test/mesh-agent-pre-check.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pre-check-'));
const WORKSPACE = path.join(TMP, 'workspace');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  MESH_LEASE_DIR: path.join(TMP, 'leases'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_MEMORY_RECALL: 'off',
  // The shipped rules: no-assume-running is what declares the nats pre_check.
  OPENCLAW_HARNESS_RULES: path.join(__dirname, '..', 'config', 'harness-rules.json'),
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

registerProvider('pre-check-stub', {
  binary: process.execPath,
  buildArgs() { return ['-e', "process.stdout.write('done')"]; },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

beforeEach(() => {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
});

/** A bus whose round trip (flush) fails or succeeds; records every request. */
function bus({ flush }) {
  const calls = [];
  agent.__test.setContext({
    nc: {
      isClosed: () => false,
      flush,
      async request(subject, data) {
        calls.push({ subject, payload: JSON.parse(sc.decode(data)) });
        const reply = subject === 'mesh.tasks.complete' ? { status: 'pending_review' } : {};
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
    },
  });
  return calls;
}

const task = { task_id: 'PC-1', title: 'work', description: 'w', budget_minutes: 5, llm_provider: 'pre-check-stub', scope: [], lease_token: 'lease-test' };

describe('harness pre_check before a task runs', () => {
  it('releases the task without starting it when the bus does not answer', async () => {
    const calls = bus({ flush: async () => { throw new Error('connection draining'); } });
    await agent.__test.executeTask(task);
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.tasks.release']);
    assert.match(calls[0].payload.reason, /pre-check failed on node-self: nats \(connection draining\)\. Task not started\./);
    assert.equal(calls[0].payload.lease_token, 'lease-test');
    assert.equal(fs.existsSync(path.join(process.env.MESH_WORKTREE_BASE, 'PC-1')), false, 'no worktree was created');
  });

  it('runs the task when the bus answers', async () => {
    const calls = bus({ flush: async () => {} });
    await agent.__test.executeTask(task);
    const subjects = calls.map((c) => c.subject);
    assert.equal(subjects[0], 'mesh.tasks.start');
    assert.ok(subjects.includes('mesh.tasks.complete'));
    assert.ok(!subjects.includes('mesh.tasks.release'));
  });
});
