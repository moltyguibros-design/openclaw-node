#!/usr/bin/env node
/**
 * mesh-agent-collab-join-refused.test.js — the daemon refuses a join when the
 * session is full, closed or already has this node. That is a decline: the
 * session proceeds without this node. The agent used to send mesh.tasks.fail as
 * owner, which aborted the live session; a claim it holds is left for the
 * session, which takes the parent over at recruit close.
 *
 * Run: node --test test/mesh-agent-collab-join-refused.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-join-refused-'));
fs.mkdirSync(path.join(TMP, '.openclaw', '.tmp'), { recursive: true });
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-late',
  OPENCLAW_OBS_DB: ':memory:',
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_LLM_PROVIDER: 'claude',
  MESH_MEMORY_RECALL: 'off',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function refusingBus({ joinError = null } = {}) {
  const calls = [];
  calls.unsubscribed = 0;
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        calls.push({ subject, payload: JSON.parse(sc.decode(data)) });
        if (subject === 'mesh.collab.join') {
          if (joinError) throw joinError;
          return { data: sc.encode(JSON.stringify({ ok: false, error: `Cannot join S-1: full, closed, or already joined` })) };
        }
        return { data: sc.encode(JSON.stringify({ ok: true, data: null })) };
      },
      subscribe() { return { unsubscribe() { calls.unsubscribed += 1; }, async *[Symbol.asyncIterator]() {} }; },
    },
  });
  return calls;
}

const collabTask = (extra = {}) => ({
  task_id: 'T-full', title: 'collab', collaboration: { mode: 'parallel' }, collab_session_id: 'S-1', ...extra,
});

function agentState() {
  try { return JSON.parse(fs.readFileSync(path.join(TMP, '.openclaw', '.tmp', 'agent-state.json'), 'utf8')); } catch { return null; }
}

describe('a refused collab join', () => {
  it('declines without failing the task when this node holds the claim', async () => {
    const calls = refusingBus();
    await agent.__test.executeCollabTask(collabTask({ owner: 'node-late', lease_token: 'L-late' }));
    const subjects = calls.map((c) => c.subject);
    assert.deepEqual(subjects, ['mesh.collab.join']);
    assert.equal(calls.unsubscribed, 1, 'the round subscription is dropped');
    assert.equal(agentState()?.status ?? 'idle', 'idle');
  });

  it('declines the same way for a recruit that holds no claim', async () => {
    const calls = refusingBus();
    await agent.__test.executeCollabTask(collabTask({ owner: null }));
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.collab.join']);
  });

  it('a join the bus never answered is still a failure the owner reports', async () => {
    const calls = refusingBus({ joinError: Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' }) });
    await agent.__test.executeCollabTask(collabTask({ owner: 'node-late', lease_token: 'L-late' }));
    const fail = calls.find((c) => c.subject === 'mesh.tasks.fail');
    assert.ok(fail, calls.map((c) => c.subject).join(','));
    assert.match(fail.payload.reason, /Failed to join collab session S-1: TIMEOUT/);
  });
});
