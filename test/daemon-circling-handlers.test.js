#!/usr/bin/env node

/**
 * daemon-circling-handlers.test.js — the daemon's circling orchestration, driven
 * through its REAL handlers (bin/mesh-task-daemon.js __test surface) over an
 * in-memory CollabStore and a bus stub that records every publish.
 *
 * This file used to test a hand-written copy of handleCollabReflect, on the
 * false premise that the daemon could not be imported. The copy had already
 * drifted (no usage accumulation, no retry publish, no artifacts for a degraded
 * reflection), so the suite stayed green whatever the daemon did.
 *
 * Covers:
 *   1. reflect → artifact store → barrier → next step dispatched
 *   2. parse_failed reflections: retry publish, degradation, usage accounting
 *   3. completeCirclingSession: blocked vote escalation, all-converged completion
 *   4. handleCirclingStepTimeout: dead nodes, stale timers
 *   5. startRecruitedSession: circling node count guard
 *
 * Run: node --test test/daemon-circling-handlers.test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');

const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');
const daemon = require('../bin/mesh-task-daemon.js');
const { createSession, issueMemberToken, CollabStore, COLLAB_STATUS } = require('../lib/mesh-collab');

// The daemon accepts a reflection only with the member's join token.
const TOKENS = new Map();
const tokenFor = (nodeId) => {
  if (!TOKENS.has(nodeId)) TOKENS.set(nodeId, issueMemberToken());
  return TOKENS.get(nodeId);
};

const sc = StringCodec();

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

function harness() {
  const collabStore = new CollabStore(new MockKV());
  const published = [];
  const completed = [];
  const released = [];
  const failed = [];
  const store = {
    async get(taskId) { return { task_id: taskId, title: 'circling task', description: 'do the thing', scope: [] }; },
    // The daemon publishes 'completed' only for a transition that happened.
    async markCompleted(taskId, result) { completed.push({ taskId, result }); return { task_id: taskId, status: 'completed', result }; },
    async markReleased(taskId, reason) { released.push({ taskId, reason }); return false; },
    async markFailed(taskId, reason) { failed.push({ taskId, reason }); return false; },
  };
  const nc = {
    publish(subject, data) { published.push({ subject, payload: JSON.parse(sc.decode(data)) }); },
    request: async () => { throw new Error('no agent on the test bus'); },
  };
  daemon.__test.setContext({ collabStore, store, nc });
  async function reflect(payload) {
    let reply;
    await daemon.__test.handleCollabReflect({
      data: sc.encode(JSON.stringify({ member_token: tokenFor(payload.node_id).token, ...payload })),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  const roundNotices = (sid) => published.filter(p => p.subject.startsWith(`mesh.collab.${sid}.node.`));
  return { collabStore, published, completed, released, failed, reflect, roundNotices };
}

function makeCirclingSession(overrides = {}) {
  return createSession('test-task', {
    mode: 'circling_strategy',
    min_nodes: 3,
    max_nodes: 3,
    max_subrounds: 3,
    automation_tier: 1,
    node_roles: [
      { role: 'worker', soul: 'solidity-dev' },
      { role: 'reviewer', soul: 'tech-architect' },
      { role: 'reviewer', soul: 'qa-engineer' },
    ],
    ...overrides,
  });
}

/** An active session at circling SR1/step1 with an open round. */
async function makeActiveSession(collabStore, overrides = {}) {
  const session = makeCirclingSession(overrides);
  await collabStore.put(session);
  for (const [id, role] of [['node-worker', 'worker'], ['node-revA', 'reviewer'], ['node-revB', 'reviewer']]) {
    await collabStore.addNode(session.session_id, id, role, '*', { tokenHash: tokenFor(id).hash });
  }

  const s = await collabStore.get(session.session_id);
  s.circling.worker_node_id = 'node-worker';
  s.circling.reviewerA_node_id = 'node-revA';
  s.circling.reviewerB_node_id = 'node-revB';
  s.status = COLLAB_STATUS.ACTIVE;
  await collabStore.put(s);
  await collabStore.advanceCirclingStep(session.session_id);
  await collabStore.startRound(session.session_id);
  return session.session_id;
}

const ok = (node_id, extra = {}) => ({ node_id, vote: 'continue', confidence: 0.8, summary: 'ok', circling_step: 1, ...extra });
const failed = (node_id, extra = {}) => ({ node_id, vote: 'continue', confidence: 0.5, summary: '', circling_step: 1, parse_failed: true, ...extra });

// startCirclingStep arms a CIRCLING_STEP_TIMEOUT_MS timer per step; fake it so
// none can fire mid-test or hold the process open.
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

describe('Daemon Circling: reflect → store → barrier → advance', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('stores artifacts and dispatches step 2 when all 3 nodes submit', async () => {
    const sid = await makeActiveSession(h.collabStore);

    const r1 = await h.reflect({ session_id: sid, ...ok('node-worker', { circling_artifacts: [{ type: 'workArtifact', content: 'code here' }] }) });
    assert.equal(r1.ok, true);
    await h.reflect({ session_id: sid, ...ok('node-revA', { circling_artifacts: [{ type: 'reviewArtifact', content: 'review A' }] }) });
    assert.equal(h.roundNotices(sid).length, 0, 'no step dispatched after 2/3');

    await h.reflect({ session_id: sid, ...ok('node-revB', { circling_artifacts: [{ type: 'reviewArtifact', content: 'review B' }] }) });

    const final = await h.collabStore.get(sid);
    assert.equal(final.circling.current_step, 2, 'advanced to step 2');
    assert.ok(h.collabStore.getArtifactByKey(final, 'sr1_step1_worker_workArtifact'));
    assert.ok(h.collabStore.getArtifactByKey(final, 'sr1_step1_reviewerA_reviewArtifact'));
    assert.ok(h.collabStore.getArtifactByKey(final, 'sr1_step1_reviewerB_reviewArtifact'));

    const notices = h.roundNotices(sid);
    assert.deepEqual(notices.map(n => n.subject).sort(),
      ['node-revA', 'node-revB', 'node-worker'].map(n => `mesh.collab.${sid}.node.${n}.round`));
    assert.ok(notices.every(n => n.payload.circling_step === 2 && n.payload.circling_subround === 1));
  });

  it('does not advance when only 2 of 3 nodes submit', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await h.reflect({ session_id: sid, ...ok('node-worker', { circling_artifacts: [{ type: 'workArtifact', content: 'code' }] }) });
    await h.reflect({ session_id: sid, ...ok('node-revA', { circling_artifacts: [{ type: 'reviewArtifact', content: 'notes' }] }) });

    const s = await h.collabStore.get(sid);
    assert.equal(s.circling.current_step, 1);
    assert.equal(h.roundNotices(sid).length, 0);
  });

  it('a tier-2 session stops at the gate instead of dispatching finalization', async () => {
    const sid = await makeActiveSession(h.collabStore, { automation_tier: 2 });
    for (const n of ['node-worker', 'node-revA', 'node-revB']) {
      await h.reflect({ session_id: sid, ...ok(n, { circling_artifacts: [{ type: 'a', content: 'x' }] }) });
    }
    h.published.length = 0;
    for (const n of ['node-worker', 'node-revA', 'node-revB']) {
      await h.reflect({ session_id: sid, ...ok(n, { vote: 'converged', circling_step: 2, circling_artifacts: [{ type: 'a', content: 'y' }] }) });
    }
    const s = await h.collabStore.get(sid);
    assert.equal(s.circling.phase, 'finalization');
    assert.ok(h.published.some(p => p.subject === 'mesh.events.collab.circling_gate'));
    assert.equal(h.roundNotices(sid).length, 0, 'nothing dispatched while the gate is pending');
  });
});

describe('Daemon Circling: parse_failed reflections (paper §14.2)', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('first parse failure is retried: resent to that node only, not submitted to the round', async () => {
    const sid = await makeActiveSession(h.collabStore);
    const reply = await h.reflect({ session_id: sid, ...failed('node-worker') });

    assert.deepEqual(reply.data, { status: 'retried', failure_count: 1 });
    const s = await h.collabStore.get(sid);
    assert.equal(h.collabStore.getArtifactFailureCount(s, 'node-worker'), 1);
    assert.equal(s.rounds[s.rounds.length - 1].reflections.length, 0, 'retry does not add to the round');
    assert.ok(s.audit_log.some(e => e.event === 'artifact_parse_failed' && e.failure_count === 1));

    const notices = h.roundNotices(sid);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].subject, `mesh.collab.${sid}.node.node-worker.round`);
    assert.equal(notices[0].payload.parse_retry, 1);
    assert.equal(notices[0].payload.circling_step, 1);
  });

  it('usage is accounted for every attempt, retried ones included', async () => {
    const sid = await makeActiveSession(h.collabStore);
    const usage = { input_tokens: 100, output_tokens: 20, cost_usd: 0.01 };
    await h.reflect({ session_id: sid, ...failed('node-worker', { usage }) });
    await h.reflect({ session_id: sid, ...ok('node-revA', { usage, circling_artifacts: [{ type: 'r', content: 'x' }] }) });

    const s = await h.collabStore.get(sid);
    assert.equal(s.circling.usage_total.calls, 2);
    assert.equal(s.circling.usage_total.input_tokens, 200);
  });

  it('3 failures → degraded: counted toward the barrier, no artifact', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await h.reflect({ session_id: sid, ...failed('node-worker') });
    await h.reflect({ session_id: sid, ...failed('node-worker') });
    const r3 = await h.reflect({ session_id: sid, ...failed('node-worker') });
    assert.notEqual(r3.data.status, 'retried', 'third failure is submitted, not retried');

    let s = await h.collabStore.get(sid);
    assert.equal(h.collabStore.getArtifactFailureCount(s, 'node-worker'), 3);
    assert.ok(s.rounds[s.rounds.length - 1].reflections.find(r => r.node_id === 'node-worker'));
    assert.equal(h.roundNotices(sid).length, 2, 'only the two retries were resent');

    await h.reflect({ session_id: sid, ...ok('node-revA', { circling_artifacts: [{ type: 'reviewArtifact', content: 'notes' }] }) });
    await h.reflect({ session_id: sid, ...ok('node-revB', { circling_artifacts: [{ type: 'reviewArtifact', content: 'notes' }] }) });

    s = await h.collabStore.get(sid);
    assert.equal(s.circling.current_step, 2, 'barrier advanced with the degraded node counted');
    assert.ok(!h.collabStore.getArtifactByKey(s, 'sr1_step1_worker_workArtifact'));
  });

  it('a degraded reflection that carries artifacts still stores them', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await h.reflect({ session_id: sid, ...failed('node-worker') });
    await h.reflect({ session_id: sid, ...failed('node-worker') });
    await h.reflect({ session_id: sid, ...failed('node-worker', { circling_artifacts: [{ type: 'workArtifact', content: 'partial' }] }) });

    const s = await h.collabStore.get(sid);
    assert.equal(h.collabStore.getArtifactByKey(s, 'sr1_step1_worker_workArtifact'), 'partial');
  });

  it('2 failures then success: stored, not degraded', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await h.reflect({ session_id: sid, ...failed('node-worker') });
    await h.reflect({ session_id: sid, ...failed('node-worker') });
    const reply = await h.reflect({ session_id: sid, ...ok('node-worker', { circling_artifacts: [{ type: 'workArtifact', content: 'good' }] }) });
    assert.notEqual(reply.data.status, 'retried');

    const s = await h.collabStore.get(sid);
    assert.equal(h.collabStore.getArtifactFailureCount(s, 'node-worker'), 2);
    assert.equal(h.collabStore.getArtifactByKey(s, 'sr1_step1_worker_workArtifact'), 'good');
  });
});

describe('Daemon Circling: completeCirclingSession', () => {
  let h;
  beforeEach(() => { h = harness(); });

  async function atFinalization(artifacts = {}) {
    const sid = await makeActiveSession(h.collabStore);
    const s = await h.collabStore.get(sid);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    Object.assign(s.circling.artifacts, artifacts);
    await h.collabStore.put(s);
    await h.collabStore.startRound(sid);
    return sid;
  }

  it('a blocked vote escalates to the gate and does not complete', async () => {
    const sid = await atFinalization();
    await h.collabStore.submitReflection(sid, { node_id: 'node-worker', vote: 'converged', confidence: 0.9, summary: 'Work is complete', circling_step: 0 });
    await h.collabStore.submitReflection(sid, { node_id: 'node-revA', vote: 'blocked', confidence: 0.95, summary: 'reentrancy guard missing on withdraw function', circling_step: 0 });
    await h.collabStore.submitReflection(sid, { node_id: 'node-revB', vote: 'converged', confidence: 0.8, summary: 'Looks good overall', circling_step: 0 });

    await daemon.__test.completeCirclingSession(sid);

    const s = await h.collabStore.get(sid);
    assert.notEqual(s.status, COLLAB_STATUS.COMPLETED);
    assert.ok(h.published.some(p => p.subject === 'mesh.events.collab.circling_gate'));
    const esc = s.audit_log.find(e => e.event === 'circling_escalation');
    assert.deepEqual(esc.blocked_nodes, ['node-revA']);
    assert.equal(h.completed.length, 0);
  });

  it('all-converged finalization, reached through reflect, completes session and parent task', async () => {
    const sid = await atFinalization({ sr2_step2_worker_workArtifact: 'final code' });
    for (const [n, summary] of [['node-worker', 'Done'], ['node-revA', 'Approved'], ['node-revB', 'LGTM']]) {
      await h.reflect({ session_id: sid, node_id: n, vote: 'converged', confidence: 0.9, summary, circling_step: 0, circling_artifacts: [{ type: 'note', content: summary }] });
    }

    const s = await h.collabStore.get(sid);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.deepEqual(s.result.artifacts, ['workArtifact'], 'the final work artifact was found');
    assert.deepEqual(s.result.node_contributions, { 'node-worker': 'Done', 'node-revA': 'Approved', 'node-revB': 'LGTM' });
    assert.equal(h.completed.length, 1);
    assert.equal(h.completed[0].taskId, 'test-task');
    assert.ok(h.published.some(p => p.subject === 'mesh.events.completed'));
    assert.ok(h.published.some(p => p.subject === 'mesh.events.collab.completed'));
  });
});

describe('Daemon Circling: handleCirclingStepTimeout', () => {
  let h;
  beforeEach(() => { h = harness(); });

  it('marks the silent node dead (pruned at the next round) and aborts when too few nodes remain', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await h.reflect({ session_id: sid, ...ok('node-worker', { circling_artifacts: [{ type: 'workArtifact', content: 'c' }] }) });
    await h.reflect({ session_id: sid, ...ok('node-revA', { circling_artifacts: [{ type: 'reviewArtifact', content: 'r' }] }) });

    await daemon.__test.handleCirclingStepTimeout(sid, { phase: 'circling', subround: 1, step: 1 });

    const s = await h.collabStore.get(sid);
    assert.deepEqual(s.nodes.map(n => n.node_id), ['node-worker', 'node-revA']);
    assert.ok(s.audit_log.some(e => e.event === 'node_marked_dead' && e.node_id === 'node-revB'));
    assert.equal(s.status, COLLAB_STATUS.ABORTED, 'step 2 cannot start with 2 < min_nodes');
    assert.equal(h.released.length, 1);
  });

  it('a stale timer (step already advanced) does nothing', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await daemon.__test.handleCirclingStepTimeout(sid, { phase: 'init', subround: 0, step: 0 });

    const s = await h.collabStore.get(sid);
    assert.ok(s.nodes.every(n => n.status !== 'dead'));
    assert.equal(s.status, COLLAB_STATUS.ACTIVE);
  });
});

// A session can end mid-step (its parent cancelled, failed, released, or a member
// left below min_nodes); the step timer armed for that step must not act on it.
describe('Daemon Circling: a step timer on a session that already ended', () => {
  let h;
  beforeEach(() => { h = harness(); });

  const STEP_TIMEOUT_MS = 10 * 60 * 1000;
  const deadMarks = (s) => s.audit_log.filter(e => e.event === 'node_marked_dead');
  const collabEvents = (from) => h.published.slice(from).filter(p => p.subject.startsWith('mesh.events.collab.'));
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

  async function atStep2() {
    const sid = await makeActiveSession(h.collabStore);
    for (const n of ['node-worker', 'node-revA', 'node-revB']) await h.reflect({ session_id: sid, ...ok(n) });
    assert.equal((await h.collabStore.get(sid)).circling.current_step, 2, 'step 2 started and armed its timer');
    return sid;
  }

  it('a timeout on a session aborted mid-step marks no node dead and publishes nothing', async () => {
    const sid = await makeActiveSession(h.collabStore);
    await h.reflect({ session_id: sid, ...ok('node-worker') });
    await h.reflect({ session_id: sid, ...ok('node-revA') });
    await h.collabStore.markAborted(sid, 'parent cancelled');
    const before = h.published.length;

    await daemon.__test.handleCirclingStepTimeout(sid, { phase: 'circling', subround: 1, step: 1 });

    const s = await h.collabStore.get(sid);
    assert.equal(s.status, COLLAB_STATUS.ABORTED);
    assert.ok(s.nodes.every(n => n.status !== 'dead'));
    assert.deepEqual(deadMarks(s), []);
    assert.deepEqual(collabEvents(before), []);
    assert.deepEqual(h.released, []);
  });

  it('a timeout on an aborted finalization session completes neither it nor its parent', async () => {
    const sid = await makeActiveSession(h.collabStore);
    const s = await h.collabStore.get(sid);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    await h.collabStore.put(s);
    await h.collabStore.startRound(sid);
    await h.collabStore.submitReflection(sid, { node_id: 'node-worker', vote: 'converged', confidence: 0.9, summary: 'Done', circling_step: 0 });
    await h.collabStore.markAborted(sid, 'parent cancelled');
    const before = h.published.length;

    await daemon.__test.handleCirclingStepTimeout(sid, { phase: 'finalization', subround: 2, step: 0 });

    const after = await h.collabStore.get(sid);
    assert.equal(after.status, COLLAB_STATUS.ABORTED);
    assert.deepEqual(deadMarks(after), []);
    assert.deepEqual(h.completed, []);
    assert.deepEqual(collabEvents(before), []);
  });

  it('a member leaving below min_nodes clears the step timer', async () => {
    const sid = await atStep2();
    assert.equal(daemon.__test.hasCirclingStepTimer(sid), true);
    let reply;
    await daemon.__test.handleCollabLeave({
      data: sc.encode(JSON.stringify({ session_id: sid, node_id: 'node-revB', member_token: tokenFor('node-revB').token, reason: 'test' })),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ABORTED);
    assert.equal(daemon.__test.hasCirclingStepTimer(sid), false);
    const before = h.published.length;

    mock.timers.tick(STEP_TIMEOUT_MS + 1);
    await flush();

    assert.deepEqual(deadMarks(await h.collabStore.get(sid)), []);
    assert.deepEqual(collabEvents(before), []);
  });

  it('failing the parent task clears the step timer', async () => {
    const sid = await atStep2();
    assert.equal(daemon.__test.hasCirclingStepTimer(sid), true);
    const parent = { task_id: 'test-task', owner: 'node-worker', collab_session_id: sid };
    daemon.__test.setContext({
      store: {
        async get() { return parent; },
        async markFailed(taskId, reason) { return { ...parent, status: 'failed', result: { error: reason } }; },
        async markReleased() { return false; },
      },
    });
    let reply;
    await daemon.__test.handleFail({
      data: sc.encode(JSON.stringify({ task_id: 'test-task', node_id: 'node-worker', reason: 'gave up' })),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ABORTED);
    assert.equal(daemon.__test.hasCirclingStepTimer(sid), false);
    const before = h.published.length;

    mock.timers.tick(STEP_TIMEOUT_MS + 1);
    await flush();

    assert.deepEqual(deadMarks(await h.collabStore.get(sid)), []);
    assert.deepEqual(collabEvents(before), []);
  });
});

// A session the budget enforcer aborted while it waited at a gate: a late answer
// must not complete it (approve) or send its members new steps (reject).
describe('Daemon Circling: sweepCirclingStepTimeouts', () => {
  let h;
  beforeEach(() => { h = harness(); });

  async function withStepStartedAt(startedAt, phase = 'circling') {
    const sid = await makeActiveSession(h.collabStore);
    const s = await h.collabStore.get(sid);
    s.circling.phase = phase;
    s.circling.step_started_at = startedAt;
    await h.collabStore.put(s);
    return sid;
  }
  const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
  const deadMarks = (s) => s.audit_log.filter(e => e.event === 'node_marked_dead').map(e => e.node_id).sort();

  it('a step past the limit with no reflections marks every member dead, aborts and releases the parent', async () => {
    const sid = await withStepStartedAt(minutesAgo(15));
    await daemon.__test.sweepCirclingStepTimeouts();
    const s = await h.collabStore.get(sid);
    assert.equal(s.status, COLLAB_STATUS.ABORTED);
    assert.deepEqual(deadMarks(s), ['node-revA', 'node-revB', 'node-worker']);
    assert.equal(h.released.length, 1);
  });

  it('a fresh step is left alone', async () => {
    const sid = await withStepStartedAt(new Date().toISOString());
    await daemon.__test.sweepCirclingStepTimeouts();
    const s = await h.collabStore.get(sid);
    assert.equal(s.status, COLLAB_STATUS.ACTIVE);
    assert.deepEqual(deadMarks(s), []);
    assert.deepEqual(h.released, []);
  });

  it('a session in phase complete is left alone however old its step', async () => {
    const sid = await withStepStartedAt(minutesAgo(15), 'complete');
    await daemon.__test.sweepCirclingStepTimeouts();
    const s = await h.collabStore.get(sid);
    assert.equal(s.status, COLLAB_STATUS.ACTIVE);
    assert.deepEqual(deadMarks(s), []);
  });
});

describe('Daemon Circling: a gate answer on an ended session', () => {
  let h;
  const operatorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'circling-gate-op-'));
  const operator = getOrCreateIdentity(operatorDir);
  const savedKeys = process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
  beforeEach(() => {
    h = harness();
    process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;
  });
  afterEach(() => {
    if (savedKeys === undefined) delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
    else process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = savedKeys;
  });
  after(() => fs.rmSync(operatorDir, { recursive: true, force: true }));

  async function abortedAtFinalization() {
    const sid = await makeActiveSession(h.collabStore);
    const s = await h.collabStore.get(sid);
    s.circling.phase = 'finalization';
    await h.collabStore.put(s);
    await h.collabStore.markAborted(sid, 'parent task exceeded its budget');
    return sid;
  }
  async function gate(handler, sid) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(signOperatorRequest({ session_id: sid }, { identity: operator }))),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }

  it('approve is refused and the session stays aborted', async () => {
    const sid = await abortedAtFinalization();
    const reply = await gate('handleCirclingGateApprove', sid);
    assert.equal(reply.ok, false, JSON.stringify(reply));
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ABORTED);
    assert.deepEqual(h.completed, []);
    assert.ok(!h.published.some(p => p.subject === 'mesh.events.collab.completed'));
  });

  it('reject is refused, the session stays aborted and no member gets a step', async () => {
    const sid = await abortedAtFinalization();
    const notices = h.roundNotices(sid).length;
    const reply = await gate('handleCirclingGateReject', sid);
    assert.equal(reply.ok, false, JSON.stringify(reply));
    assert.equal((await h.collabStore.get(sid)).status, COLLAB_STATUS.ABORTED);
    assert.equal(h.roundNotices(sid).length, notices);
  });
});

describe('Daemon Circling: recruiting node count guard', () => {
  it('circling session defaults min_nodes to 3', () => {
    assert.equal(createSession('test', { mode: 'circling_strategy' }).min_nodes, 3);
  });

  it('non-circling session defaults min_nodes to 2', () => {
    assert.equal(createSession('test', { mode: 'parallel' }).min_nodes, 2);
  });

  it('explicit min_nodes overrides the default', () => {
    assert.equal(createSession('test', { mode: 'circling_strategy', min_nodes: 5 }).min_nodes, 5);
  });

  it('reviewer IDs are stored in circling schema', () => {
    const session = createSession('test', { mode: 'circling_strategy' });
    assert.equal(session.circling.reviewerA_node_id, null);
    assert.equal(session.circling.reviewerB_node_id, null);
    assert.equal(session.circling.worker_node_id, null);
  });

  it('startRecruitedSession refuses a circling session with only 2 nodes (min_nodes misconfigured)', async () => {
    const h = harness();
    const session = createSession('test', { mode: 'circling_strategy', min_nodes: 2, max_nodes: 2 });
    await h.collabStore.put(session);
    await h.collabStore.addNode(session.session_id, 'node-a', 'worker');
    await h.collabStore.addNode(session.session_id, 'node-b', 'reviewer');

    assert.equal(await daemon.__test.startRecruitedSession(session.session_id), true);

    const s = await h.collabStore.get(session.session_id);
    assert.equal(s.status, COLLAB_STATUS.ABORTED);
    assert.equal(s.rounds.length, 0, 'no circling step started');
    assert.match(h.released[0].reason, /insufficient role distribution/);
  });

  it('startRecruitedSession assigns roles and dispatches init with 3 nodes', async () => {
    const h = harness();
    const session = createSession('test', { mode: 'circling_strategy', max_nodes: 3 });
    await h.collabStore.put(session);
    for (const n of ['node-a', 'node-b', 'node-c']) await h.collabStore.addNode(session.session_id, n, 'worker');

    await daemon.__test.startRecruitedSession(session.session_id);

    const s = await h.collabStore.get(session.session_id);
    assert.equal(s.circling.worker_node_id, 'node-a');
    assert.deepEqual([s.circling.reviewerA_node_id, s.circling.reviewerB_node_id], ['node-b', 'node-c']);
    assert.equal(h.roundNotices(session.session_id).length, 3);
  });
});
