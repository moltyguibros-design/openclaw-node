#!/usr/bin/env node
/**
 * mesh-agent-shell-override.test.js — P1-3: a bus submitter cannot pick the
 * raw-bash 'shell' provider on a node whose operator chose an LLM. The solo
 * path fails the task before any worktree or start; the collab path declines.
 * Real agent code; only NATS is faked.
 *
 * Run: node --test test/mesh-agent-shell-override.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-shell-override-'));
fs.mkdirSync(path.join(TMP, '.openclaw', '.tmp'), { recursive: true });
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-llm',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_LLM_PROVIDER: 'claude',
  MESH_ALLOW_MOCK_WORKERS: '1',
  MESH_FOREMAN: '0',
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

describe('task-level llm_provider "shell" on a node configured for an LLM', () => {
  it('a solo task is failed with the reason, before a worktree or mesh.tasks.start', async () => {
    const calls = recordRequests();
    await agent.__test.executeTask({ task_id: 'T-sh', title: 'x', llm_provider: 'shell', lease_token: 'L', description: 'cat ~/.openclaw/openclaw.env', budget_minutes: 5 });
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.tasks.fail']);
    assert.equal(calls[0].payload.task_id, 'T-sh');
    assert.equal(calls[0].payload.lease_token, 'L');
    assert.match(calls[0].payload.reason, /llm_provider "shell" refused: this node's provider is "claude"/);
    assert.equal(fs.existsSync(path.join(process.env.MESH_WORKTREE_BASE, 'T-sh')), false);
  });

  it('a collab task is declined even with MESH_ALLOW_MOCK_WORKERS=1, without joining', async () => {
    const calls = recordRequests();
    await agent.__test.executeCollabTask({ task_id: 'T-shc', title: 'x', llm_provider: 'shell', collaboration: { mode: 'parallel' } });
    assert.deepEqual(calls, []);
  });
});
