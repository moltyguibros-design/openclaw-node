#!/usr/bin/env node
/**
 * mesh-agent-metric-exhausted.test.js — audit mesh-core~2#7, the worker half.
 * The real solo path of mesh-agent (executeTask) in a real git workspace, with
 * NATS faked and a stub provider.
 *
 * The daemon escalates a release to the role's on_metric_failure target only
 * when the worker says every attempt ran and the metric kept failing
 * (metric_exhausted). A release for any other reason must not say so.
 *
 * Run: node --test test/mesh-agent-metric-exhausted.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-metric-exhausted-'));
const WORKSPACE = path.join(TMP, 'workspace');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  MESH_LEASE_DIR: path.join(TMP, 'leases'),
  MESH_MAX_ATTEMPTS: '2',
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
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

registerProvider('exhaust-ok-stub', {
  binary: process.execPath,
  buildArgs() { return ['-e', "process.stdout.write('did the work')"]; },
});
registerProvider('exhaust-crash-stub', {
  binary: process.execPath,
  buildArgs() { return ['-e', 'process.exit(3)']; },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function freshWorkspace() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'check.js'), 'process.exit(1)\n');
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
        seen[subject] = JSON.parse(sc.decode(data));
        return { data: sc.encode(JSON.stringify({ ok: true, data: {} })) };
      },
    },
  });
  return seen;
}

const task = (id, provider) => ({
  task_id: id, title: 'make check pass', description: 'fix it', budget_minutes: 5,
  llm_provider: provider, metric: 'node check.js', scope: [], lease_token: 'lease-test',
});

describe('the release says whether the metric was exhausted', () => {
  beforeEach(freshWorkspace);

  it('every attempt ran and the metric failed: metric_exhausted', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('M-1', 'exhaust-ok-stub'));
    assert.equal(seen['mesh.tasks.release']?.metric_exhausted, true);
  });

  it('the provider crashed on the last attempt: not a metric failure', async () => {
    const seen = fakeDaemon();
    await agent.__test.executeTask(task('M-2', 'exhaust-crash-stub'));
    assert.ok(seen['mesh.tasks.release'], 'the task was released');
    assert.equal(seen['mesh.tasks.release'].metric_exhausted, false);
  });
});
