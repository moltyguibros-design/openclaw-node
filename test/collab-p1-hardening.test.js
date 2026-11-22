#!/usr/bin/env node
/**
 * collab-p1-hardening.test.js — deep-review P1s #3–#9 driven against the REAL
 * daemon/store functions (mesh-task-daemon __test surface + lib/mesh-collab),
 * never replicas. Each case is the failure the review named.
 *
 * Run: node --test test/collab-p1-hardening.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const daemon = require('../bin/mesh-task-daemon.js');
const { createSession, issueMemberToken, CollabStore, COLLAB_STATUS } = require('../lib/mesh-collab');
const { isOpenClawWorkerProvider } = require('../lib/llm-providers');

class MockKV {
  constructor() { this.store = new Map(); this.rev = 0; }
  async put(key, value) { this.store.set(key, { value, revision: ++this.rev }); }
  async update(key, value, expectedRev) {
    const cur = this.store.get(key);
    if (cur && expectedRev !== undefined && cur.revision !== expectedRev) {
      const err = new Error('wrong last sequence'); err.code = '10071'; throw err;
    }
    this.store.set(key, { value, revision: ++this.rev });
  }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function makeContext({ alive = new Set() } = {}) {
  const collabStore = new CollabStore(new MockKV());
  const failed = [], completed = [], released = [];
  const tasks = new Map();
  const store = {
    async get(id) { return tasks.get(id) || { task_id: id, title: 't', description: 'd', scope: [] }; },
    async markFailed(id, reason, attempts) {
      const t = tasks.get(id); if (t) { t.status = 'failed'; t.fail_reason = reason; }
      failed.push({ id, reason }); return t || { task_id: id };
    },
    async markCompleted(id, result) { completed.push({ id, result }); return { task_id: id }; },
    async markReleased(id, reason) { released.push({ id, reason }); return { task_id: id }; },
    _tasks: tasks,
  };
  const published = [];
  const payloads = [];
  // An agent answers the alive check only when it is still working on that task.
  const nc = {
    publish(subject, data) { published.push(subject); payloads.push({ subject, data }); },
    request: async (subject) => {
      const node = /^mesh\.agent\.(.+)\.alive$/.exec(subject)?.[1];
      if (node && alive.has(node)) return { data: new TextEncoder().encode(JSON.stringify({ alive: true })) };
      return {};
    },
  };
  daemon.__test.setContext({ collabStore, store, nc, planStore: { list: async () => [] } });
  return { collabStore, store, failed, completed, released, published, payloads };
}

async function activeSession(collabStore, spec, nodeIds, { setup } = {}) {
  const session = createSession('task-' + spec.mode + '-' + Math.random().toString(36).slice(2, 7), {
    min_nodes: 3, max_nodes: 3, automation_tier: 1, ...spec,
  });
  await collabStore.put(session);
  for (const id of nodeIds) await collabStore.addNode(session.session_id, id, 'worker');
  await collabStore._updateWithCAS(session.session_id, (s) => {
    s.status = COLLAB_STATUS.ACTIVE;
    s.current_round = 1;
    s.rounds.push({ round_number: 1, started_at: new Date().toISOString(), completed_at: null, shared_intel: '', reflections: [] });
    if (setup) setup(s);
    return s;
  });
  return collabStore.get(session.session_id);
}

const reflect = (node_id, vote = 'continue', extra = {}) =>
  ({ node_id, summary: `${node_id} work`, artifacts: [], confidence: 0.9, vote, ...extra });

describe('P1 #7 — zombie reflections cannot trip barriers', () => {
  let ctx;
  beforeEach(() => { ctx = makeContext(); });

  it('submitReflection rejects a non-member', async () => {
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c']);
    const out = await ctx.collabStore.submitReflection(s.session_id, reflect('zombie'));
    assert.equal(out, null, 'non-member reflection must be refused');
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.rounds[0].reflections.length, 0);
  });

  it('isRoundComplete requires EVERY active member — a stale entry cannot stand in', async () => {
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c']);
    // simulate the pre-fix corruption: a removed node's reflection already recorded
    await ctx.collabStore._updateWithCAS(s.session_id, (sess) => {
      sess.rounds[0].reflections.push({ node_id: 'ghost', vote: 'continue', artifacts: [] });
      sess.rounds[0].reflections.push({ node_id: 'a', vote: 'continue', artifacts: [] });
      sess.rounds[0].reflections.push({ node_id: 'b', vote: 'continue', artifacts: [] });
      return sess;
    });
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(ctx.collabStore.isRoundComplete(after), false, '3 entries but c never reflected — NOT complete');
  });
});

describe('P1 #6 — evaluateRound fires exactly once per round', () => {
  it('claimRoundEvaluation: one winner, losers get null', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.cooperative.integrator_order = ['a', 'b', 'c']; sess.cooperative.current_integrator = 'a'; },
    });
    const first = await ctx.collabStore.claimRoundEvaluation(s.session_id);
    const second = await ctx.collabStore.claimRoundEvaluation(s.session_id);
    assert.ok(first, 'first claim wins');
    assert.equal(second, null, 'second claim must lose');
  });

  it('two concurrent evaluateRound calls record ONE integration', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative', rounds: 3 }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.cooperative.integrator_order = ['a', 'b', 'c']; sess.cooperative.current_integrator = 'a'; sess.cooperative.rounds_target = 3; },
    });
    for (const n of ['a', 'b', 'c']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await Promise.all([daemon.__test.evaluateRound(s.session_id), daemon.__test.evaluateRound(s.session_id)]);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.cooperative.integrations.length, 1, 'double-fire must not double-integrate');
  });
});

describe('P1 #3 — collaborative merge-review votes are BINDING', () => {
  async function mergePhaseSession(ctx, votes, { mergerReflects = true } = {}) {
    const s = await activeSession(ctx.collabStore, { mode: 'collaborative' }, ['m', 'r1', 'r2'], {
      setup: (sess) => {
        sess.collaborative.merger_node_id = 'm';
        sess.collaborative.phase = 'merge';
        sess.collaborative.subtasks = { m: { summary: 'x' }, r1: { summary: 'y' }, r2: { summary: 'z' } };
      },
    });
    ctx.store._tasks.set(s.task_id, { task_id: s.task_id, status: 'in_progress' });
    if (mergerReflects) await ctx.collabStore.submitReflection(s.session_id, reflect('m', 'converged', { summary: 'merged result' }));
    await ctx.collabStore.submitReflection(s.session_id, reflect('r1', votes[0]));
    await ctx.collabStore.submitReflection(s.session_id, reflect('r2', votes[1]));
    await daemon.__test.evaluateRound(s.session_id);
    return ctx.collabStore.get(s.session_id);
  }

  it('REGRESSION: two blocked votes ABORT the session and fail the task (used to complete)', async () => {
    const ctx = makeContext();
    const after = await mergePhaseSession(ctx, ['blocked', 'blocked']);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.equal(ctx.failed.length, 1, 'parent task failed');
    assert.match(ctx.failed[0].reason, /merge gate/i);
    assert.equal(ctx.completed.length, 0);
  });

  it('two converged votes complete the session', async () => {
    const ctx = makeContext();
    const after = await mergePhaseSession(ctx, ['converged', 'converged']);
    assert.equal(after.status, COLLAB_STATUS.COMPLETED);
    assert.equal(ctx.failed.length, 0);
  });

  it('split vote (1-1) does NOT complete — approvals must exceed rejections', async () => {
    const ctx = makeContext();
    const after = await mergePhaseSession(ctx, ['converged', 'blocked']);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
  });

  it('P1 #5: merger absent → abort, never a placeholder completion', async () => {
    const ctx = makeContext();
    // merger dead: only reviewers reflect; mark m dead so the barrier can pass
    const s = await activeSession(ctx.collabStore, { mode: 'collaborative' }, ['m', 'r1', 'r2'], {
      setup: (sess) => {
        sess.collaborative.merger_node_id = 'm';
        sess.collaborative.phase = 'merge';
        sess.nodes.find(n => n.node_id === 'm').status = 'dead';
      },
    });
    ctx.store._tasks.set(s.task_id, { task_id: s.task_id });
    await ctx.collabStore.submitReflection(s.session_id, reflect('r1', 'converged'));
    await ctx.collabStore.submitReflection(s.session_id, reflect('r2', 'converged'));
    await daemon.__test.evaluateRound(s.session_id);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.match(after.result?.summary || JSON.stringify(after.audit_log.slice(-3)), /merge/i);
  });
});

describe('P1 #5 — cooperative rotation skips the dead; degraded is loud', () => {
  it('next integrator in order is dead → rotation lands on the next ALIVE node', async (t) => {
    const logs = t.mock.method(console, 'log', () => {});
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.cooperative.integrator_order = ['a', 'b', 'c'];
        sess.cooperative.current_integrator = 'a';
        sess.cooperative.rounds_target = 3;
        sess.nodes.find(n => n.node_id === 'b').status = 'dead';
      },
    });
    for (const n of ['a', 'c']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await daemon.__test.evaluateRound(s.session_id);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.cooperative.current_integrator, 'c', 'skipped dead b → c');
    // The log line used the pre-rotation snapshot and named the previous integrator.
    assert.ok(logs.mock.calls.some(c => /COOPERATIVE .*: next integrator=c,/.test(String(c.arguments[0]))));
  });

  it('missing integrator reflection → integration marked degraded (never silent)', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.cooperative.integrator_order = ['a', 'b', 'c'];
        sess.cooperative.current_integrator = 'a';
        sess.cooperative.rounds_target = 3;
        sess.nodes.find(n => n.node_id === 'a').status = 'dead';
      },
    });
    for (const n of ['b', 'c']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await daemon.__test.evaluateRound(s.session_id);
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.cooperative.integrations[0].degraded, true);
    assert.ok(after.audit_log.some(a => a.event === 'cooperative_integration_degraded'));
  });
});

describe('P1 #4 — round timeout: sessions can no longer hang forever', () => {
  it('stale round, too few survivors → session ABORTED + task failed', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.cooperative.integrator_order = ['a', 'b', 'c'];
        sess.cooperative.current_integrator = 'a';
        sess.rounds[0].started_at = new Date(Date.now() - 20 * 60_000).toISOString();
      },
    });
    ctx.store._tasks.set(s.task_id, { task_id: s.task_id });
    await ctx.collabStore.submitReflection(s.session_id, reflect('a'));
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ABORTED, 'b+c marked dead, 1/3 < min_nodes → abort');
    assert.equal(ctx.failed.length, 1);
  });

  it('fresh rounds are untouched by the sweep', async () => {
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'cooperative' }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.cooperative.integrator_order = ['a', 'b', 'c']; sess.cooperative.current_integrator = 'a'; },
    });
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.status, COLLAB_STATUS.ACTIVE);
  });
});

describe('round timeout for parallel / review / sequential (mesh-core #9)', () => {
  const stale = () => new Date(Date.now() - 20 * 60_000).toISOString();
  const quiet = (t) => t.mock.method(console, 'log', () => {});
  const msg = (payload) => ({ data: new TextEncoder().encode(JSON.stringify(payload)), respond() {} });

  for (const mode of ['parallel', 'review']) {
    it(`${mode}: a silent member is marked dead at the limit and the round evaluates with the quorum`, async (t) => {
      quiet(t);
      const ctx = makeContext();
      const s = await activeSession(ctx.collabStore, { mode, min_nodes: 2, max_rounds: 5 }, ['a', 'b', 'c'], {
        setup: (sess) => { sess.rounds[0].started_at = stale(); },
      });
      for (const n of ['a', 'b']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
      await daemon.__test.sweepCollabRoundTimeouts();
      const after = await ctx.collabStore.get(s.session_id);
      const timeout = after.audit_log.find(a => a.event === 'round_timeout');
      assert.deepEqual(timeout?.marked_dead, ['c']);
      assert.equal(after.rounds[0].evaluated, true, 'the round no longer hangs on c');
      assert.ok(!after.nodes.some(n => n.node_id === 'c' && n.status !== 'dead'), 'c is dead or pruned by the next round');
    });
  }

  it('a member still working past the limit is kept: the limit does not cap a long work round', async (t) => {
    quiet(t);
    const ctx = makeContext({ alive: new Set(['c']) });
    const s = await activeSession(ctx.collabStore, { mode: 'parallel', min_nodes: 2 }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.rounds[0].started_at = stale(); },
    });
    for (const n of ['a', 'b']) await ctx.collabStore.submitReflection(s.session_id, reflect(n));
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.nodes.find(n => n.node_id === 'c').status, 'active');
    assert.ok(!after.rounds[0].evaluated, 'the round waits for c');
  });

  it('a dead member beside a working one is dropped, and the round still waits for the worker', async (t) => {
    quiet(t);
    const ctx = makeContext({ alive: new Set(['c']) });
    const s = await activeSession(ctx.collabStore, { mode: 'parallel', min_nodes: 2 }, ['a', 'b', 'c'], {
      setup: (sess) => { sess.rounds[0].started_at = stale(); },
    });
    await ctx.collabStore.submitReflection(s.session_id, reflect('a'));
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.nodes.find(n => n.node_id === 'b').status, 'dead');
    assert.equal(after.nodes.find(n => n.node_id === 'c').status, 'active');
    assert.ok(!after.rounds[0].evaluated);
  });

  async function sequentialSession(ctx, turnStartedAt) {
    return activeSession(ctx.collabStore, { mode: 'sequential', min_nodes: 2, max_rounds: 5 }, ['a', 'b', 'c'], {
      setup: (sess) => {
        sess.current_turn = 'b';
        sess.turn_started_at = turnStartedAt;
        sess.rounds[0].reflections.push({ node_id: 'a', summary: 'a', artifacts: [], confidence: 0.9, vote: 'continue' });
      },
    });
  }

  it('sequential: a silent turn holder past the per-turn limit is marked dead and the turn moves on', async (t) => {
    quiet(t);
    const ctx = makeContext();
    const s = await sequentialSession(ctx, stale());
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.nodes.find(n => n.node_id === 'b').status, 'dead');
    assert.equal(after.current_turn, 'c');
    assert.ok(Date.now() - Date.parse(after.turn_started_at) < 60_000, 'c gets a fresh turn clock');
    assert.ok(ctx.published.includes(`mesh.collab.${s.session_id}.node.c.round`), 'c is notified');
    assert.ok(after.audit_log.some(a => a.event === 'turn_timeout'));
  });

  it('sequential: members waiting for their turn are not timed by the round clock', async (t) => {
    quiet(t);
    const ctx = makeContext();
    const s = await sequentialSession(ctx, new Date().toISOString());
    await ctx.collabStore._updateWithCAS(s.session_id, (sess) => { sess.rounds[0].started_at = stale(); return sess; });
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.current_turn, 'b');
    assert.ok(after.nodes.every(n => n.status === 'active'), 'c, still waiting its turn, is not marked dead');
  });

  it('sequential: a turn holder still working past the limit keeps its turn', async (t) => {
    quiet(t);
    const ctx = makeContext({ alive: new Set(['b']) });
    const s = await sequentialSession(ctx, stale());
    await daemon.__test.sweepCollabRoundTimeouts();
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.current_turn, 'b');
    assert.equal(after.nodes.find(n => n.node_id === 'b').status, 'active');
  });

  it('sequential: the turn holder leaving hands the turn to the next member', async (t) => {
    quiet(t);
    const ctx = makeContext();
    const s = await sequentialSession(ctx, new Date().toISOString());
    const { token, hash } = issueMemberToken();
    await ctx.collabStore._updateWithCAS(s.session_id, (sess) => { sess.nodes.find(n => n.node_id === 'b').token_hash = hash; return sess; });
    await daemon.__test.handleCollabLeave(msg({ session_id: s.session_id, node_id: 'b', member_token: token, reason: 'worktree isolation failed' }));
    const after = await ctx.collabStore.get(s.session_id);
    assert.equal(after.current_turn, 'c');
    assert.deepEqual(after.turn_order, ['a', 'c']);
    assert.ok(ctx.published.includes(`mesh.collab.${s.session_id}.node.c.round`));
  });

  it('a leave that drops an active session below min_nodes fails the parent task and announces it', async (t) => {
    quiet(t);
    const ctx = makeContext();
    const s = await activeSession(ctx.collabStore, { mode: 'parallel' }, ['a', 'b', 'c']);
    const { token, hash } = issueMemberToken();
    await ctx.collabStore._updateWithCAS(s.session_id, (sess) => { sess.nodes.find(n => n.node_id === 'b').token_hash = hash; return sess; });
    await daemon.__test.handleCollabLeave(msg({ session_id: s.session_id, node_id: 'b', member_token: token, reason: 'gone' }));
    assert.equal((await ctx.collabStore.get(s.session_id)).status, COLLAB_STATUS.ABORTED);
    assert.deepEqual(ctx.failed.map(f => f.id), [s.task_id]);
    assert.ok(ctx.published.includes('mesh.events.failed'), 'the bridge hears the failure');
    const aborted = ctx.payloads.find(p => p.subject === 'mesh.events.collab.aborted');
    assert.equal(JSON.parse(new TextDecoder().decode(aborted.data)).session.status, COLLAB_STATUS.ABORTED);
  });
});

describe('P1 #8 — D11 guard: mock providers are gated, local providers enumerated', () => {
  it('shell is refused by default and allowed ONLY with MESH_ALLOW_MOCK_WORKERS=1', () => {
    assert.equal(isOpenClawWorkerProvider('shell', {}), false);
    assert.equal(isOpenClawWorkerProvider('shell', { MESH_ALLOW_MOCK_WORKERS: '1' }), true);
  });
  it('other local-model providers are refused too (was: only the literal string ollama)', () => {
    for (const p of ['ollama', 'llamacpp', 'lmstudio', 'vllm', 'mlx']) {
      assert.equal(isOpenClawWorkerProvider(p, {}), false, `${p} must be refused`);
    }
    assert.equal(isOpenClawWorkerProvider('claude', {}), true);
  });
});

describe('P1 #9 — one node cannot poison the mesh', () => {
  function fakeMsg(payload) {
    const responses = [];
    return {
      data: new TextEncoder().encode(JSON.stringify(payload)),
      respond(data) { responses.push(new TextDecoder().decode(data)); },
      _responses: responses,
    };
  }

  it('handleFail rejects a non-owner (task and session untouched)', async () => {
    const ctx = makeContext();
    ctx.store._tasks.set('t1', { task_id: 't1', owner: 'alpha', status: 'in_progress' });
    await daemon.__test.handleFail(fakeMsg({ task_id: 't1', node_id: 'mallory', reason: 'nope' }));
    assert.equal(ctx.failed.length, 0, 'markFailed must not run');
    assert.equal(ctx.store._tasks.get('t1').status, 'in_progress');
  });

  it('handleFail rejects when the task is unclaimed (no external fail at all)', async () => {
    const ctx = makeContext();
    ctx.store._tasks.set('t2', { task_id: 't2', owner: null, status: 'pending' });
    await daemon.__test.handleFail(fakeMsg({ task_id: 't2', node_id: 'alpha', reason: 'x' }));
    assert.equal(ctx.failed.length, 0);
  });

  it('handleFail accepts the owner', async () => {
    const ctx = makeContext();
    ctx.store._tasks.set('t3', { task_id: 't3', owner: 'alpha', status: 'in_progress' });
    await daemon.__test.handleFail(fakeMsg({ task_id: 't3', node_id: 'alpha', reason: 'legit failure' }));
    assert.equal(ctx.failed.length, 1);
    assert.equal(ctx.failed[0].id, 't3');
  });
});
