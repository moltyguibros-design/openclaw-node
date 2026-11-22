#!/usr/bin/env node
/**
 * mesh-agent-task-slot.test.js — the agent runs one task at a time. The claim
 * loop, the recruit broadcast and the recruiting poll each used to check
 * currentTaskId, await the bus, and only then take the task, so a recruit
 * arriving during another path's await started a second task. NATS is faked
 * with replies the test releases by hand.
 *
 * Run: node --test test/mesh-agent-task-slot.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-slot-'));
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-slot',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_MEMORY_RECALL: 'off',
  MESH_LLM_PROVIDER: 'claude',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const RECRUIT_TASK = { task_id: 'R-1', title: 'collab', collaboration: { mode: 'parallel' }, collab_session_id: 'S-R1', owner: 'node-other' };

/** `held` subjects wait until release(subject) is called; everything else answers at once. */
function fakeBus(held) {
  const calls = [];
  const gates = new Map();
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        calls.push({ subject, payload: JSON.parse(sc.decode(data)) });
        let reply = null;
        if (held.has(subject)) reply = await new Promise((resolve) => gates.set(subject, resolve));
        else if (subject === 'mesh.tasks.get') reply = RECRUIT_TASK;
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
      subscribe() { return { unsubscribe() {}, async *[Symbol.asyncIterator]() {} }; },
    },
  });
  const settle = () => new Promise((r) => setImmediate(r));
  return {
    calls,
    async release(subject, reply) {
      while (!gates.has(subject)) await settle();
      gates.get(subject)(reply);
      gates.delete(subject);
    },
    settle,
  };
}

const recruit = { session_id: 'S-R1', task_id: 'R-1' };

describe('one task slot', () => {
  it('a recruit arriving while the claim loop waits on mesh.tasks.claim is not joined', async () => {
    const bus = fakeBus(new Set(['mesh.tasks.claim']));
    const pass = agent.__test.claimAndRun();
    await bus.settle();
    await agent.__test.onRecruit(recruit);
    await bus.release('mesh.tasks.claim', null);
    assert.equal(await pass, 'none');

    assert.equal(bus.calls.filter((c) => c.subject === 'mesh.tasks.get').length, 0, 'the recruit never fetched its task');
    assert.equal(bus.calls.filter((c) => c.subject === 'mesh.collab.join').length, 0);
  });

  it('a recruit arriving while the recruiting poll waits is not joined', async () => {
    const bus = fakeBus(new Set(['mesh.collab.recruiting']));
    const poll = agent.__test.checkRecruitingSessions();
    await bus.settle();
    await agent.__test.onRecruit(recruit);
    await bus.release('mesh.collab.recruiting', []);
    await poll;

    assert.equal(bus.calls.filter((c) => c.subject === 'mesh.tasks.get').length, 0);
    assert.equal(bus.calls.filter((c) => c.subject === 'mesh.collab.join').length, 0);
  });

  it('the claim loop does not claim while a recruit is resolving its task', async () => {
    const bus = fakeBus(new Set(['mesh.tasks.get']));
    const joining = agent.__test.onRecruit(recruit);
    await bus.settle();
    assert.equal(await agent.__test.claimAndRun(), 'busy');
    await bus.release('mesh.tasks.get', null);
    await joining;

    assert.equal(bus.calls.filter((c) => c.subject === 'mesh.tasks.claim').length, 0);
  });

  it('the slot is free again once a path finishes', async () => {
    const bus = fakeBus(new Set());
    await agent.__test.onRecruit({ session_id: 'S-none', task_id: 'none' });
    assert.equal(await agent.__test.claimAndRun(), 'none');
    assert.equal(bus.calls.filter((c) => c.subject === 'mesh.tasks.claim').length, 1);
  });
});
