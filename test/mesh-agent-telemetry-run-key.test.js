#!/usr/bin/env node
/**
 * mesh-agent-telemetry-run-key.test.js — the agent keys each HyperAgent row on
 * its run (the claim's lease, else a recruit's collab session), so a task that
 * review rejected and this node redid gets its second run recorded.
 *
 * Run: node --test test/mesh-agent-telemetry-run-key.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-run-key-'));
const STATE_DB = path.join(TMP, 'state.db');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  OPENCLAW_NODE_ID: 'node-runs',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: STATE_DB,
  MESH_LLM_PROVIDER: 'openai',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../bin/mesh-agent.js');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

async function rows(taskId) {
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  const store = createHyperAgentStore({ dbPath: STATE_DB });
  try { return store.getTelemetry({ last: 1000 }).filter((r) => r.task_id === taskId); } finally { store.close(); }
}

describe('HyperAgent rows per run', () => {
  it('a re-run under a new lease is a second row; the same run written twice is one', async () => {
    const task = { task_id: 'T-redo', title: 'redo me', lease_token: 'lease-a' };
    const notes = 'First run, rejected in review and queued again under the same task id.';
    await agent.recordHyperagentTask(task, { outcome: 'failure', iterations: 2, startedAt: Date.now(), notes });
    await agent.recordHyperagentTask(task, { outcome: 'failure', iterations: 2, startedAt: Date.now(), notes });
    await agent.recordHyperagentTask({ ...task, lease_token: 'lease-b' }, { outcome: 'success', iterations: 1, startedAt: Date.now(), notes: 'Second run after the rejection, approved this time.' });
    const got = await rows('T-redo');
    assert.deepEqual(got.map((r) => [r.run_key, r.outcome]).sort(), [['lease-a', 'failure'], ['lease-b', 'success']]);
  });

  it('a recruit, which holds no lease, keys its row on the collab session', async () => {
    const task = { task_id: 'T-collab', title: 'collab', collaboration: { mode: 'parallel' } };
    await agent.recordHyperagentTask(task, { outcome: 'success', iterations: 1, startedAt: Date.now(), notes: 'Recruited member of a parallel session.', sessionId: 'S-1' });
    await agent.recordHyperagentTask(task, { outcome: 'success', iterations: 1, startedAt: Date.now(), notes: 'Recruited member of a later session.', sessionId: 'S-2' });
    assert.deepEqual((await rows('T-collab')).map((r) => r.run_key).sort(), ['S-1', 'S-2']);
  });
});
