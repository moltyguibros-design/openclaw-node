#!/usr/bin/env node
/**
 * mesh-agent-collab-rounds.test.js — the real collab round loop of mesh-agent
 * (executeCollabTask) in a real git workspace, with NATS faked: the join reply,
 * a fixed list of round notifications, and a status that reports the session
 * done after a given number of reflections. The worker is a registered stub
 * provider that prints the task's `stub_output`.
 *
 * Run: node --test test/mesh-agent-collab-rounds.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// The agent reads its paths and identity at require time; keep all of them in a sandbox.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-collab-'));
const WORKSPACE = path.join(TMP, 'workspace');
const STATE_DB = path.join(TMP, 'state.db');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: STATE_DB,
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

registerProvider('collab-stub', {
  binary: process.execPath,
  buildArgs(prompt, model, task) { return ['-e', 'process.stdout.write(process.argv[1])', task.stub_output]; },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function freshWorkspace() {
  fs.rmSync(WORKSPACE, { recursive: true, force: true });
  fs.rmSync(process.env.MESH_WORKTREE_BASE, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  git(WORKSPACE, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
  git(WORKSPACE, 'add', '.');
  git(WORKSPACE, 'commit', '-q', '-m', 'base');
}

/** Delivers `rounds` in order; the session reads as completed once `completeAfter` reflections arrived. */
function fakeBus(rounds, completeAfter) {
  const reflections = [];
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        let reply = {};
        if (subject === 'mesh.collab.join') {
          // The daemon answers a join with the session as recruiting left it.
          reply = { session_id: payload.session_id, status: 'recruiting', current_round: 0, nodes: [{ node_id: payload.node_id }] };
        } else if (subject === 'mesh.collab.reflect') {
          reflections.push(payload);
        } else if (subject === 'mesh.collab.status') {
          reply = { status: reflections.length >= completeAfter ? 'completed' : 'active' };
        }
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
      subscribe() {
        return {
          unsubscribe() {},
          async *[Symbol.asyncIterator]() {
            for (const round of rounds) yield { data: sc.encode(JSON.stringify(round)) };
          },
        };
      },
    },
  });
  return reflections;
}

function collabTask(taskId, mode, stubOutput) {
  return {
    task_id: taskId, title: 'Harden the limiter', description: 'add the reset path',
    collaboration: { mode }, collab_session_id: `S-${taskId}`, llm_provider: 'collab-stub',
    stub_output: stubOutput, lease_token: 'lease-test', scope: [],
  };
}

async function telemetryFor(taskId) {
  const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
  const store = createHyperAgentStore({ dbPath: STATE_DB });
  try {
    return store.getTelemetry({ last: 1000 }).filter((row) => row.task_id === taskId);
  } finally {
    store.close();
  }
}

describe('collab telemetry', () => {
  beforeEach(freshWorkspace);

  it('records the number of rounds the session ran, not the join reply round', async () => {
    const round = (n) => ({ round_number: n, mode: 'parallel', my_role: 'worker', my_scope: [], shared_intel: '' });
    const reflections = fakeBus([round(1), round(2)], 2);

    await agent.__test.executeCollabTask(collabTask('C-1', 'parallel', 'implemented my part'));

    assert.deepEqual(reflections.map((r) => r.round), [1, 2]);
    const rows = await telemetryFor('C-1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'success');
    assert.equal(rows[0].iterations, 2);
  });
});
