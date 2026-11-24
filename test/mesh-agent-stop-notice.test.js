#!/usr/bin/env node
/**
 * mesh-agent-stop-notice.test.js — mesh.agent.<node>.stall / .budget_exceeded.
 *
 * Mission Control's remove_node and the daemon's stall sweep and budget enforcer
 * published these, and nothing subscribed: a removed node kept running its round,
 * and a worker whose task the daemon had already ended kept spending budget. The
 * agent now acts on a notice signed by an operator key, for its own node and its
 * current task, by stopping the worker and winding the task down.
 * Real agent code in a real git workspace; only NATS is faked.
 *
 * Run: node --test test/mesh-agent-stop-notice.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stop-'));
const WORKSPACE = path.join(TMP, 'workspace');
const PID_FILE = path.join(TMP, 'worker.pid');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  MESH_LEASE_DIR: path.join(TMP, 'leases'),
  MESH_HEARTBEAT_INTERVAL: '50',
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_MEMORY_RECALL: 'off',
  MESH_LLM_PROVIDER: 'stop-stub',
  MESH_FOREMAN: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});
delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { registerProvider } = require('../lib/llm-providers.js');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();

// A worker that leaves work in its worktree, then would run for 30s unless stopped.
registerProvider('stop-stub', {
  binary: process.execPath,
  buildArgs(prompt, model, task, targetDir) {
    return ['-e', `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(path.join(targetDir, 'progress.txt'))}, 'half done\\n'); fs.writeFileSync(${JSON.stringify(PID_FILE)}, String(process.pid)); setTimeout(() => process.stdout.write('done'), 30000)`];
  },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

beforeEach(() => {
  fs.rmSync(PID_FILE, { force: true });
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
});

async function signed(payload) {
  const { signOperatorRequest } = await import('../lib/operator-auth.mjs');
  return signOperatorRequest(payload);
}

// The worker writes its pid after its progress, so a pid on disk means the worktree has work in it.
async function workerUp() {
  while (!fs.existsSync(PID_FILE)) await new Promise((r) => setTimeout(r, 10));
}

const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/**
 * A bus that hands out `task` on claim, delivers one round on the session's round
 * subject, and keeps the round subscription open until it is unsubscribed.
 * `onHeartbeat` runs once, after the first heartbeat, once the worker has started.
 */
function bus(task, onHeartbeat) {
  const calls = [];
  let fired = false;
  agent.__test.setContext({
    nc: {
      isClosed: () => false,
      async flush() {},
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        calls.push({ subject, payload });
        let reply = {};
        if (subject === 'mesh.tasks.claim') reply = task;
        else if (subject === 'mesh.collab.join') reply = { session_id: payload.session_id, status: 'active', nodes: [{ node_id: payload.node_id }], member_token: 'mt' };
        else if (subject === 'mesh.collab.status') reply = { status: 'active' };
        else if (subject === 'mesh.tasks.heartbeat' && !fired) { fired = true; setImmediate(async () => { await workerUp(); await onHeartbeat(); }); }
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
      subscribe() {
        let release;
        const closed = new Promise((r) => { release = r; });
        return {
          unsubscribe() { release(); },
          async *[Symbol.asyncIterator]() {
            yield { data: sc.encode(JSON.stringify({ round_number: 1, mode: 'parallel', my_role: 'worker', my_scope: [], shared_intel: '' })) };
            await closed;
          },
        };
      },
    },
  });
  return calls;
}

describe('stop notices that must be ignored', () => {
  it('an unsigned notice, one signed for another node, and one for a task this node does not hold', async () => {
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'T', target_node_id: 'node-self' }), false);
    assert.equal(await agent.__test.onStopNotice('stall', await signed({ task_id: 'T', target_node_id: 'node-other' })), false);
    assert.equal(await agent.__test.onStopNotice('stall', await signed({ task_id: 'T', target_node_id: 'node-self' })), false);
  });
});

describe('a signed stop notice for the current task', () => {
  it('remove_node: stops the collab worker mid-round, submits no reflection and leaves the round loop', async () => {
    const task = {
      task_id: 'ST-C', title: 'collab work', description: 'd', collaboration: { mode: 'parallel' },
      collab_session_id: 'S-ST', llm_provider: 'stop-stub', owner: 'node-self', lease_token: 'lease-c', scope: [],
    };
    let stopped;
    const calls = bus(task, async () => {
      stopped = await agent.__test.onStopNotice('stall', await signed({ task_id: 'ST-C', target_node_id: 'node-self', reason: 'Removed by operator' }));
    });
    const started = Date.now();
    assert.equal(await agent.__test.claimAndRun(), 'ran');
    assert.equal(stopped, true);
    assert.ok(Date.now() - started < 15_000, 'the 30s worker did not run to the end');
    assert.equal(isAlive(Number(fs.readFileSync(PID_FILE, 'utf8'))), false, 'the worker process is gone');
    assert.ok(!calls.some((c) => c.subject === 'mesh.collab.reflect'), 'no reflection for an abandoned round');
  });

  it('budget_exceeded: stops the solo worker and winds the task down without another daemon call', async () => {
    const task = { task_id: 'ST-S', title: 'solo work', description: 'd', budget_minutes: 5, llm_provider: 'stop-stub', scope: [], lease_token: 'lease-s' };
    const calls = bus(task, async () => {
      await agent.__test.onStopNotice('budget_exceeded', await signed({ task_id: 'ST-S', target_node_id: 'node-self', reason: 'failed at 5.1m of a 5m budget' }));
    });
    const started = Date.now();
    assert.equal(await agent.__test.claimAndRun(), 'error');
    assert.ok(Date.now() - started < 15_000, 'the 30s worker did not run to the end');
    assert.equal(isAlive(Number(fs.readFileSync(PID_FILE, 'utf8'))), false, 'the worker process is gone');
    const after = calls.slice(calls.findIndex((c) => c.subject === 'mesh.tasks.start') + 1).map((c) => c.subject);
    assert.ok(after.every((s) => s === 'mesh.tasks.heartbeat'), `only heartbeats after start, got ${after.join(', ')}`);
    assert.match(git(WORKSPACE, 'log', '-1', '--format=%s', 'mesh/ST-S'), /partial: the daemon ended this task \(budget_exceeded\)/);
  });

  it('listens on both notice subjects for this node', () => {
    const subjects = [];
    agent.__test.setContext({ nc: { subscribe(subject) { subjects.push(subject); return { unsubscribe() {}, async *[Symbol.asyncIterator]() {} }; } } });
    agent.__test.listenForStops();
    assert.deepEqual(subjects, ['mesh.agent.node-self.stall', 'mesh.agent.node-self.budget_exceeded']);
  });
});

describe('the daemon signs the notices it sends', () => {
  it('enforceBudgets: the budget_exceeded notice to the owner verifies and names the owner as its target', async () => {
    const daemon = require('../bin/mesh-task-daemon.js');
    const { createTask, TaskStore } = require('../lib/mesh-tasks');
    const { verifyOperatorRequest } = await import('../lib/operator-auth.mjs');
    const kv = new Map();
    const store = new TaskStore({
      async put(k, value) { kv.set(k, { value }); },
      async update(k, value) { kv.set(k, { value }); },
      async get(k) { return kv.get(k) || null; },
      async delete(k) { kv.delete(k); },
      async keys() { return kv.keys(); },
    });
    const longAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    await store.put({ ...createTask({ task_id: 'ST-B', title: 'over budget', budget_minutes: 5 }), status: 'running', owner: 'node-w', claimed_at: longAgo, started_at: longAgo, budget_deadline: new Date(Date.now() - 60_000).toISOString() });
    const published = [];
    daemon.__test.setContext({ store, nc: { publish(subject, data) { published.push({ subject, notice: JSON.parse(sc.decode(data)) }); } } });

    await daemon.__test.enforceBudgets();

    const stop = published.find((p) => p.subject === 'mesh.agent.node-w.budget_exceeded');
    assert.ok(stop, `published ${published.map((p) => p.subject).join(', ')}`);
    assert.equal(verifyOperatorRequest(stop.notice, { seenIds: null }).ok, true);
    assert.equal(stop.notice.task_id, 'ST-B');
    assert.equal(stop.notice.target_node_id, 'node-w');
  });
});
