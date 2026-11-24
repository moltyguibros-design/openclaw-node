#!/usr/bin/env node
/**
 * mesh-agent-withdrawn-task.test.js — audit mesh-core~2#22.
 *
 * The daemon's stall detector and budget enforcer end a task and then publish
 * mesh.agent.<owner>.stall / .budget_exceeded; Mission Control's remove_node
 * publishes .stall to the removed member. Nothing listened, so the provider CLI
 * kept running on a dead task. The agent now stops its running child, but only
 * once the daemon confirms the task is no longer this node's: the notices are
 * plain core publishes any bus peer can send.
 *
 * Run: node --test test/mesh-agent-withdrawn-task.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-withdrawn-'));
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: ':memory:',
  MESH_MEMORY_RECALL: 'off',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { registerProvider } = require('../lib/llm-providers.js');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

registerProvider('withdrawn-stub', {
  binary: process.execPath,
  buildArgs() { return ['-e', 'setInterval(() => {}, 1000)']; },
});

function fakeDaemon(replies) {
  const asked = [];
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        asked.push(subject);
        const reply = typeof replies[subject] === 'function' ? replies[subject](JSON.parse(sc.decode(data))) : replies[subject];
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply ?? null })) };
      },
    },
  });
  return asked;
}

function startWorker(taskId) {
  const run = agent.__test.runLLM('prompt', { task_id: taskId, llm_provider: 'withdrawn-stub', budget_minutes: 1 }, TMP);
  let settled = false;
  run.then(() => { settled = true; });
  return { run, settled: () => settled };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

describe('stall / budget_exceeded notices', () => {
  it('stop the running worker once the daemon reports the task ended', async () => {
    const asked = fakeDaemon({ 'mesh.tasks.get': { task_id: 'T-1', status: 'released', owner: 'node-self' } });
    const worker = startWorker('T-1');
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'T-1' }), true);
    const result = await worker.run;
    assert.notEqual(result.exitCode, 0);
    assert.ok(asked.includes('mesh.tasks.get'));
  });

  it('a budget notice for a failed task stops it too', async () => {
    fakeDaemon({ 'mesh.tasks.get': { task_id: 'T-2', status: 'failed', owner: 'node-self' } });
    const worker = startWorker('T-2');
    assert.equal(await agent.__test.onStopNotice('budget_exceeded', { task_id: 'T-2' }), true);
    await worker.run;
  });

  it('a forged notice for a task the daemon still has running here is ignored', async () => {
    let status = 'running';
    fakeDaemon({ 'mesh.tasks.get': () => ({ task_id: 'T-3', status, owner: 'node-self' }) });
    const worker = startWorker('T-3');
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'T-3' }), false);
    await tick(300);
    assert.equal(worker.settled(), false, 'the worker kept running');
    status = 'released';
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'T-3' }), true);
    await worker.run;
  });

  it('a notice for another task leaves the running worker alone', async () => {
    const asked = fakeDaemon({ 'mesh.tasks.get': { task_id: 'OTHER', status: 'released', owner: 'node-self' } });
    const worker = startWorker('T-4');
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'OTHER' }), false);
    assert.equal(asked.length, 0);
    await tick(300);
    assert.equal(worker.settled(), false);
    fakeDaemon({ 'mesh.tasks.get': { task_id: 'T-4', status: 'cancelled' } });
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'T-4' }), true);
    await worker.run;
  });

  it('a collab member stops only when its session seat is gone', async () => {
    const parent = { task_id: 'C-1', status: 'running', owner: 'node-claimer', collab_session_id: 'S-1', collaboration: { mode: 'parallel' } };
    let nodes = [{ id: 'node-claimer', status: 'active' }, { id: 'node-self', status: 'active' }];
    fakeDaemon({
      'mesh.tasks.get': parent,
      'mesh.collab.status': () => ({ session_id: 'S-1', status: 'active', nodes }),
    });
    const worker = startWorker('C-1');
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'C-1' }), false, 'still seated: the notice is forged');
    await tick(300);
    assert.equal(worker.settled(), false);
    nodes = nodes.filter((n) => n.id !== 'node-self');
    assert.equal(await agent.__test.onStopNotice('stall', { task_id: 'C-1' }), true, 'removed by the operator');
    await worker.run;
  });
});
