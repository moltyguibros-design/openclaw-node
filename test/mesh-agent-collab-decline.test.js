#!/usr/bin/env node
/**
 * mesh-agent-collab-decline.test.js — a node whose provider D11 declines as a
 * grappe worker: the recruit broadcast and the recruiting poll decline once
 * without telemetry, a claimed collab task is released instead of held, the
 * claim asks the daemon to skip collab tasks, and MESH_ALLOW_LOCAL_WORKERS lets
 * an operator admit a vetted local provider.
 *
 * Run: node --test test/mesh-agent-collab-decline.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-decline-'));
const STATE_DB = path.join(TMP, 'state.db');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-local',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: STATE_DB,
  MESH_MEMORY_RECALL: 'off',
});
delete process.env.MESH_ALLOW_LOCAL_WORKERS;
delete process.env.MESH_LLM_PROVIDER;

const { describe, it, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { isOpenClawWorkerProvider } = require('../lib/llm-providers.js');
const { TaskStore, createTask, TASK_STATUS } = require('../lib/mesh-tasks.js');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let sessionSeq = 0;
function recruitingTask(extra = {}) {
  sessionSeq += 1;
  return {
    task_id: `T-${sessionSeq}`, title: 'collab', collaboration: { mode: 'parallel' },
    collab_session_id: `S-${sessionSeq}`, llm_provider: 'ollama', owner: 'node-other', ...extra,
  };
}

function fakeBus(task, { join = null } = {}) {
  const calls = [];
  calls.unsubscribed = 0;
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        calls.push({ subject, payload });
        let reply = {};
        if (subject === 'mesh.collab.recruiting') {
          reply = [{ session_id: task.collab_session_id, task_id: task.task_id, node_ids: ['node-other'], current_nodes: 1, max_nodes: 3 }];
        } else if (subject === 'mesh.tasks.get') {
          reply = task;
        } else if (subject === 'mesh.collab.join') {
          // No session to hand out: the daemon refuses the join (full, closed, duplicate).
          if (!join) return { data: sc.encode(JSON.stringify({ ok: false, error: 'Cannot join: full, closed, or already joined' })) };
          reply = join;
        }
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
      subscribe() { return { unsubscribe() { calls.unsubscribed += 1; }, async *[Symbol.asyncIterator]() {} }; },
    },
  });
  return calls;
}

async function telemetryRows() {
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  const store = createHyperAgentStore({ dbPath: STATE_DB });
  try { return store.getTelemetry({ last: 1000 }); } finally { store.close(); }
}

describe('D11 decline on a local-model node', () => {
  beforeEach(() => {
    delete process.env.MESH_ALLOW_LOCAL_WORKERS;
    fs.rmSync(path.join(TMP, '.openclaw'), { recursive: true, force: true });
  });

  it('the recruiting poll declines a session once: no telemetry, no join, no re-fetch', async () => {
    const task = recruitingTask();
    const calls = fakeBus(task);
    for (let i = 0; i < 4; i++) await agent.__test.checkRecruitingSessions();

    assert.equal(calls.filter((c) => c.subject === 'mesh.tasks.get').length, 1);
    assert.equal(calls.filter((c) => c.subject === 'mesh.collab.join').length, 0);
    assert.equal((await telemetryRows()).filter((r) => r.task_id === task.task_id).length, 0);
  });

  it('a recruit broadcast for a declined provider is ignored without telemetry', async () => {
    const task = recruitingTask();
    const calls = fakeBus(task);
    await agent.__test.onRecruit({ session_id: task.collab_session_id, task_id: task.task_id });
    await agent.__test.onRecruit({ session_id: task.collab_session_id, task_id: task.task_id });

    assert.equal(calls.filter((c) => c.subject === 'mesh.collab.join').length, 0);
    assert.equal((await telemetryRows()).filter((r) => r.task_id === task.task_id).length, 0);
  });

  it('a collab task this node claimed is released, not held, and records no telemetry', async () => {
    const task = recruitingTask({ owner: 'node-local', lease_token: 'lease-1' });
    const calls = fakeBus(task);
    await agent.__test.executeCollabTask(task);

    const release = calls.find((c) => c.subject === 'mesh.tasks.release');
    assert.ok(release, 'the claim is handed back');
    assert.equal(release.payload.task_id, task.task_id);
    assert.equal(release.payload.lease_token, 'lease-1');
    assert.equal(calls.filter((c) => c.subject === 'mesh.tasks.fail').length, 0);
    assert.equal(calls.filter((c) => c.subject === 'mesh.collab.join').length, 0);
    assert.equal((await telemetryRows()).filter((r) => r.task_id === task.task_id).length, 0);
  });

  it('MESH_ALLOW_LOCAL_WORKERS in ~/.openclaw/openclaw.env admits the vetted local provider', async () => {
    fs.mkdirSync(path.join(TMP, '.openclaw'), { recursive: true });
    fs.writeFileSync(path.join(TMP, '.openclaw', 'openclaw.env'), 'MESH_ALLOW_LOCAL_WORKERS=ollama\n');
    const task = recruitingTask();
    const calls = fakeBus(task);
    await agent.__test.checkRecruitingSessions();

    assert.equal(calls.filter((c) => c.subject === 'mesh.collab.join').length, 1, 'the node joins');
  });
});

describe('recruit node filter (preferred_nodes / exclude_nodes)', () => {
  // Admit ollama so the D11 decline cannot mask the node filter.
  beforeEach(() => {
    fs.mkdirSync(path.join(TMP, '.openclaw'), { recursive: true });
    fs.writeFileSync(path.join(TMP, '.openclaw', 'openclaw.env'), 'MESH_ALLOW_LOCAL_WORKERS=ollama\n');
  });
  afterEach(() => fs.rmSync(path.join(TMP, '.openclaw'), { recursive: true, force: true }));

  async function recruit(extra) {
    const task = recruitingTask(extra);
    const calls = fakeBus(task);
    await agent.__test.onRecruit({ session_id: task.collab_session_id, task_id: task.task_id });
    return calls;
  }
  const joins = (calls) => calls.filter((c) => c.subject === 'mesh.collab.join').length;

  it('an excluded node does not join', async () => {
    const calls = await recruit({ exclude_nodes: ['node-local'] });
    assert.equal(calls.filter((c) => c.subject === 'mesh.tasks.get').length, 1);
    assert.equal(joins(calls), 0);
  });

  it('a node missing from preferred_nodes does not join', async () => {
    assert.equal(joins(await recruit({ preferred_nodes: ['node-other'] })), 0);
  });

  it('a preferred node joins', async () => {
    assert.equal(joins(await recruit({ preferred_nodes: ['node-local'] })), 1);
  });
});

describe('collab member without worktree isolation (mesh-core #9)', () => {
  it('leaves the session it joined and drops its round subscription', async () => {
    // MESH_WORKSPACE is not a git repository here, so createWorktree fails.
    const task = recruitingTask({ llm_provider: 'claude' });
    const calls = fakeBus(task, { join: { session_id: task.collab_session_id, status: 'active', nodes: [{ node_id: 'node-local' }], member_token: 'tok-local' } });
    await agent.__test.executeCollabTask(task);

    const leave = calls.find((c) => c.subject === 'mesh.collab.leave');
    assert.ok(leave, 'the member withdraws from the session');
    assert.equal(leave.payload.session_id, task.collab_session_id);
    assert.equal(leave.payload.node_id, 'node-local');
    assert.equal(leave.payload.member_token, 'tok-local', 'the daemon refuses a leave without the join token');
    assert.equal(calls.unsubscribed, 1);
    assert.equal(calls.filter((c) => c.subject === 'mesh.collab.reflect').length, 0);
  });
});

describe('isOpenClawWorkerProvider — MESH_ALLOW_LOCAL_WORKERS', () => {
  it('admits only the local providers the operator names', () => {
    assert.equal(isOpenClawWorkerProvider('ollama', {}), false);
    assert.equal(isOpenClawWorkerProvider('ollama', { MESH_ALLOW_LOCAL_WORKERS: 'ollama' }), true);
    assert.equal(isOpenClawWorkerProvider('vllm', { MESH_ALLOW_LOCAL_WORKERS: 'ollama' }), false);
    assert.equal(isOpenClawWorkerProvider('vllm', { MESH_ALLOW_LOCAL_WORKERS: ' ollama , vllm ' }), true);
    assert.equal(isOpenClawWorkerProvider('shell', { MESH_ALLOW_LOCAL_WORKERS: 'shell' }), false, 'the mock keeps its own flag');
  });
});

describe('TaskStore.claim — acceptsCollab', () => {
  function mockKv() {
    const rows = new Map();
    let rev = 0;
    return {
      async get(k) { const r = rows.get(k); return r ? { value: r.value, revision: r.revision } : null; },
      async put(k, v) { rows.set(k, { value: v, revision: ++rev }); },
      async update(k, v, expected) {
        const r = rows.get(k);
        if (!r || r.revision !== expected) { const e = new Error('wrong last sequence'); e.code = '10071'; throw e; }
        rows.set(k, { value: v, revision: ++rev });
      },
      async delete(k) { rows.delete(k); },
      async keys() { return (async function* () { for (const k of [...rows.keys()]) yield k; })(); },
    };
  }

  it('acceptsCollab: false leaves collab tasks queued and claims the solo one', async () => {
    const store = new TaskStore(mockKv());
    await store.put({ ...createTask({ task_id: 'C', title: 'c', priority: 9 }), collaboration: { mode: 'parallel' }, status: TASK_STATUS.QUEUED });
    await store.put({ ...createTask({ task_id: 'S', title: 's' }), status: TASK_STATUS.QUEUED });

    const claimed = await store.claim('node-local', { acceptsCollab: false });
    assert.equal(claimed.task_id, 'S');
    assert.equal((await store.get('C')).status, TASK_STATUS.QUEUED);
    assert.equal((await store.claim('node-other')).task_id, 'C', 'the default still claims collab tasks');
  });
});
