#!/usr/bin/env node
/**
 * mesh-agent-heartbeat.test.js — what runLLM's heartbeat sends while a worker
 * runs, driven through the real collab round loop (executeCollabTask) with a
 * slow stub worker and a 50 ms heartbeat interval. The daemon's handleHeartbeat
 * reads only task_id, node_id and lease_token.
 *
 * Run: node --test test/mesh-agent-heartbeat.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-heartbeat-'));
const WORKSPACE = path.join(TMP, 'workspace');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: WORKSPACE,
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  MESH_HEARTBEAT_INTERVAL: '50',
  OPENCLAW_NODE_ID: 'node-self',
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
  OPENCLAW_STATE_DB: path.join(TMP, 'state.db'),
  MESH_MEMORY_RECALL: 'off',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { registerProvider } = require('../lib/llm-providers.js');
const agent = require('../bin/mesh-agent.js');

const sc = StringCodec();

registerProvider('heartbeat-stub', {
  binary: process.execPath,
  buildArgs() { return ['-e', "setTimeout(() => process.stdout.write('done'), 400)"]; },
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('runLLM heartbeat', () => {
  it('carries only the fields the daemon reads', async () => {
    fs.mkdirSync(WORKSPACE, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: WORKSPACE });
    fs.writeFileSync(path.join(WORKSPACE, 'README'), 'base\n');
    execFileSync('git', ['add', '.'], { cwd: WORKSPACE });
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: WORKSPACE });

    const heartbeats = [];
    let reflected = 0;
    agent.__test.setContext({
      nc: {
        async request(subject, data) {
          const payload = JSON.parse(sc.decode(data));
          let reply = {};
          if (subject === 'mesh.tasks.heartbeat') heartbeats.push(payload);
          else if (subject === 'mesh.collab.join') reply = { session_id: payload.session_id, status: 'recruiting', current_round: 0, nodes: [{ node_id: payload.node_id }] };
          else if (subject === 'mesh.collab.reflect') reflected++;
          else if (subject === 'mesh.collab.status') reply = { status: reflected ? 'completed' : 'active' };
          return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
        },
        subscribe() {
          return {
            unsubscribe() {},
            async *[Symbol.asyncIterator]() {
              yield { data: sc.encode(JSON.stringify({ round_number: 1, mode: 'parallel', my_role: 'worker', my_scope: [], shared_intel: '' })) };
            },
          };
        },
      },
    });

    await agent.__test.executeCollabTask({
      task_id: 'HB-1', title: 'slow work', description: 'd', collaboration: { mode: 'parallel' },
      collab_session_id: 'S-HB-1', llm_provider: 'heartbeat-stub', lease_token: 'lease-hb', scope: [],
    });

    assert.ok(heartbeats.length > 0, 'a heartbeat went out while the worker ran');
    for (const hb of heartbeats) {
      assert.deepEqual(hb, { task_id: 'HB-1', node_id: 'node-self', lease_token: 'lease-hb' });
    }
  });
});
