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

// Like collab-stub, but first edits README in the worktree it was given (left unstaged, as a real worker leaves it).
registerProvider('collab-edit-stub', {
  binary: process.execPath,
  buildArgs(prompt, model, task, targetDir) {
    return ['-e', "require('fs').appendFileSync(require('path').join(process.argv[1], 'README'), 'x\\n'); process.stdout.write(process.argv[2])", targetDir, task.stub_output];
  },
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

describe('collab reflection artifacts', () => {
  beforeEach(freshWorkspace);

  it('name an unstaged edit by its full path', async () => {
    const reflections = fakeBus([{ round_number: 1, mode: 'parallel', my_role: 'worker', my_scope: [], shared_intel: '' }], 1);
    await agent.__test.executeCollabTask({ ...collabTask('C-art', 'parallel', 'edited'), llm_provider: 'collab-edit-stub' });
    assert.equal(reflections.length, 1);
    assert.deepEqual(reflections[0].artifacts, ['README']);
  });
});

const WORK = 'The limiter keeps a sliding window per key and resets it on expiry. '.repeat(8);
const REFLECTION = '===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: done\nconfidence: 0.9\nvote: converged\n===END_REFLECTION===\n';
const single = (type, body) => `${body}\n${REFLECTION.replace('type: workArtifact', `type: ${type}`)}`;
const pair = (secondType) => `${WORK}\n===CIRCLING_ARTIFACT===\ntype: workArtifact\n===END_ARTIFACT===\n`
  + `the second artifact\n===CIRCLING_ARTIFACT===\ntype: ${secondType}\n===END_ARTIFACT===\n${REFLECTION}`;

describe('circling submission guard (D14 smoke #4)', () => {
  beforeEach(freshWorkspace);

  // The daemon's circling round notifications carry my_role and no round_role.
  async function submit(taskId, roundFields, output) {
    const round = { round_number: 1, mode: 'circling_strategy', my_scope: [], shared_intel: '', directed_input: 'prior artifacts', circling_subround: 1, ...roundFields };
    const reflections = fakeBus([round], 1);
    await agent.__test.executeCollabTask(collabTask(taskId, 'circling_strategy', output));
    assert.equal(reflections.length, 1);
    return reflections[0];
  }

  it('a finalization worker without its completionDiff is a parse failure', async () => {
    const r = await submit('CF-1', { my_role: 'worker', circling_phase: 'finalization', circling_step: 0 }, single('workArtifact', WORK));
    assert.equal(r.parse_failed, true);
    assert.equal(r.vote, 'parse_error');
    assert.equal(r.summary, 'multi-artifact round missing completionDiff');
  });

  it('a step-2 worker without its reconciliationDoc is a parse failure', async () => {
    const r = await submit('CF-2', { my_role: 'worker', circling_phase: 'circling', circling_step: 2 }, single('workArtifact', WORK));
    assert.equal(r.parse_failed, true);
    assert.equal(r.summary, 'multi-artifact round missing reconciliationDoc');
  });

  it('a finalization worker with both artifacts submits normally', async () => {
    const r = await submit('CF-3', { my_role: 'worker', circling_phase: 'finalization', circling_step: 0 }, pair('completionDiff'));
    assert.equal(r.parse_failed, false);
    assert.deepEqual(r.circling_artifacts.map((a) => a.type), ['workArtifact', 'completionDiff']);
  });

  it('a finalization reviewer owes only its sign-off', async () => {
    const r = await submit('CF-4', { my_role: 'reviewer', circling_phase: 'finalization', circling_step: 0 }, single('reviewSignoff', 'Signed off: the reset path is covered.'));
    assert.equal(r.parse_failed, false);
    assert.equal(r.vote, 'converged');
  });
});
