#!/usr/bin/env node
/**
 * mesh-agent-cannot-start.test.js — a task this node cannot even start (an
 * unknown llm_provider, a shell command the filter blocks) is failed at once
 * with the real reason, before a worktree or mesh.tasks.start, and still gets
 * its telemetry row. Before, the throw surfaced only as a lease expiry.
 *
 * Run: node --test test/mesh-agent-cannot-start.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-cannot-start-'));
fs.mkdirSync(path.join(TMP, '.openclaw', '.tmp'), { recursive: true });
const STATE_DB = path.join(TMP, 'state.db');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-shell',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: STATE_DB,
  MESH_LLM_PROVIDER: 'shell',
  MESH_FOREMAN: '0',
  MESH_MEMORY_RECALL: 'off',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function recordRequests() {
  const calls = [];
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        calls.push({ subject, payload: JSON.parse(sc.decode(data)) });
        return { data: sc.encode(JSON.stringify({ ok: true, data: null })) };
      },
    },
  });
  return calls;
}

async function telemetryFor(taskId) {
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  const store = createHyperAgentStore({ dbPath: STATE_DB });
  try { return store.getTelemetry({ last: 1000 }).filter((r) => r.task_id === taskId); } finally { store.close(); }
}

describe('a task this node cannot start', () => {
  it('an unknown llm_provider fails the task with that reason, before a worktree or start, and is recorded', async () => {
    const calls = recordRequests();
    await agent.__test.executeTask({ task_id: 'T-nope', title: 'x', llm_provider: 'nope', lease_token: 'L1', description: 'echo hi', budget_minutes: 5 });
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.tasks.fail']);
    assert.equal(calls[0].payload.lease_token, 'L1');
    assert.match(calls[0].payload.reason, /Unknown LLM provider: "nope"/);
    assert.equal(fs.existsSync(path.join(process.env.MESH_WORKTREE_BASE, 'T-nope')), false);
    const rows = await telemetryFor('T-nope');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'failure');
    assert.equal(rows[0].provider, null);
    assert.match(rows[0].meta_notes, /Unknown LLM provider/);
  });

  it('a shell command the filter blocks is failed the same way', async () => {
    const calls = recordRequests();
    await agent.__test.executeTask({ task_id: 'T-blocked', title: 'x', lease_token: 'L2', description: 'uname -a', budget_minutes: 5 });
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.tasks.fail']);
    assert.match(calls[0].payload.reason, /command blocked by security filter: uname -a/);
    assert.equal(fs.existsSync(path.join(process.env.MESH_WORKTREE_BASE, 'T-blocked')), false);
    const rows = await telemetryFor('T-blocked');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].provider, 'shell');
  });

  it('the start check passes every built-in provider a task may name, and refuses only what cannot run', () => {
    for (const name of ['claude', 'openai', 'gemini', 'deepseek', 'kimi', 'minimax', 'ollama', 'aider']) {
      assert.equal(agent.__test.taskStartError({ task_id: `T-${name}`, llm_provider: name, description: 'prose' }), null, name);
    }
    assert.equal(agent.__test.taskStartError({ task_id: 'T-ok', description: 'npm test' }), null, 'an allowed shell command');
    assert.match(agent.__test.taskStartError({ task_id: 'T-x', llm_provider: 'nope' }), /Unknown LLM provider/);
  });
});
