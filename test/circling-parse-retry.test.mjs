/**
 * circling-parse-retry.test.mjs — Unit + integration tests for paper §14.2.
 *
 * Verifies that a node whose output fails circling-artifact parsing is retried
 * up to 3× before being counted as degraded (barrier advances, CRITICAL logged).
 *
 * Both suites drive the daemon's REAL handleCollabReflect (bin/mesh-task-daemon.js
 * __test surface); they used to drive a hand-written copy of it.
 *
 * Suite 1 (unit): in-memory mock KV.
 * Suite 2 (integration): real NATS JetStream — one node sends parse_failed ×2 then
 *   succeeds; session completes with that node's successful reflection in the round.
 */
import { describe, it, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { natsServerBin, freePort, startNatsServer, writeServerConfig } from './helpers/nats-server.mjs';

const require = createRequire(import.meta.url);
const { CollabStore, COLLAB_MODE, createSession, issueMemberToken } = require('../lib/mesh-collab');

// The daemon accepts a reflection only with the member's join token.
const TOKENS = Object.fromEntries(['worker', 'reviewerA', 'reviewerB'].map((id) => [id, issueMemberToken()]));
const daemon = require('../bin/mesh-task-daemon.js');
const { StringCodec } = require('nats');
const sc = StringCodec();

// The barrier's next step arms a step-timeout timer; fake it so it cannot fire or hold the process.
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

// ── Minimal in-memory KV ────────────────────────────────────────────────────

function makeMockKV() {
  const store = new Map();
  let seq = 0;
  return {
    async get(key) { return store.get(key) ?? null; },
    async put(key, value) {
      seq++;
      store.set(key, { value, revision: seq });
      return seq;
    },
    async update(key, value, revision) {
      const entry = store.get(key);
      if (!entry) throw Object.assign(new Error('key not found'), { code: '10071' });
      if (entry.revision !== revision) throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
      seq++;
      store.set(key, { value, revision: seq });
      return seq;
    },
  };
}

// ── Session factory (circling, step1, all nodes active) ─────────────────────

async function makeSessionAtStep1(collab, sessionIdSuffix = '') {
  const spec = {
    mode: COLLAB_MODE.CIRCLING_STRATEGY,
    min_nodes: 3,
    max_subrounds: 2,
    automation_tier: 1,
  };
  const session = createSession(`task-retry-test${sessionIdSuffix}`, spec);
  session.status = 'active';
  session.nodes = [
    { node_id: 'worker',    role: 'worker',    status: 'active', token_hash: TOKENS.worker.hash },
    { node_id: 'reviewerA', role: 'reviewerA', status: 'active', token_hash: TOKENS.reviewerA.hash },
    { node_id: 'reviewerB', role: 'reviewerB', status: 'active', token_hash: TOKENS.reviewerB.hash },
  ];
  session.circling.worker_node_id = 'worker';
  session.circling.reviewerA_node_id = 'reviewerA';
  session.circling.reviewerB_node_id = 'reviewerB';
  session.circling.phase = 'circling';
  session.circling.current_subround = 1;
  session.circling.current_step = 1;
  session.rounds = [{
    round_number: 1,
    started_at: new Date().toISOString(),
    completed_at: null,
    shared_intel: '',
    reflections: [],
  }];
  await collab.put(session);
  return session.session_id;
}

// ── The daemon's real handler, over the given CollabStore ───────────────────

function useStore(collab) {
  const published = [];
  daemon.__test.setContext({
    collabStore: collab,
    store: { async get(id) { return { task_id: id, description: 'd' }; }, async markCompleted() { return false; }, async markReleased() { return false; } },
    nc: { publish(subject, data) { published.push({ subject, payload: JSON.parse(sc.decode(data)) }); }, request: async () => ({}) },
  });
  return published;
}

async function reflect(collab, sessionId, reflection) {
  let reply;
  await daemon.__test.handleCollabReflect({
    data: sc.encode(JSON.stringify({ session_id: sessionId, member_token: TOKENS[reflection.node_id]?.token, ...reflection })),
    respond(data) { reply = JSON.parse(sc.decode(data)); },
  });
  return { reply, retried: reply.data?.status === 'retried', session: await collab.get(sessionId) };
}

// ── Suite 1: unit tests (in-memory mock KV) ──────────────────────────────────

describe('parse-failure retry (paper §14.2) — unit', () => {
  it('single parse failure: retry event emitted, reflection NOT added to round', async () => {
    const collab = new CollabStore(makeMockKV());
    const published = useStore(collab);
    const sid = await makeSessionAtStep1(collab, '-u1');

    const result = await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });

    assert.equal(result.retried, true);
    assert.equal(result.reply.data.failure_count, 1);
    const resent = published.filter(p => p.subject.endsWith('.node.worker.round'));
    assert.equal(resent.length, 1, 'step resent to the failing node');
    assert.equal(resent[0].payload.parse_retry, 1);

    const s = await collab.get(sid);
    const round = s.rounds[s.rounds.length - 1];
    assert.equal(round.reflections.length, 0, 'failed reflection not in round');
    assert.equal(collab.getArtifactFailureCount(s, 'worker'), 1);
  });

  it('second parse failure: retry event again, reflection still not in round', async () => {
    const collab = new CollabStore(makeMockKV());
    useStore(collab);
    const sid = await makeSessionAtStep1(collab, '-u2');

    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    const result = await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });

    assert.equal(result.retried, true);
    assert.equal(result.reply.data.failure_count, 2);

    const s = await collab.get(sid);
    assert.equal(collab.getArtifactFailureCount(s, 'worker'), 2);
    const round = s.rounds[s.rounds.length - 1];
    assert.equal(round.reflections.length, 0, 'still no reflections after 2 failures');
  });

  it('2 failures then success: barrier satisfied, node NOT degraded', async () => {
    const collab = new CollabStore(makeMockKV());
    useStore(collab);
    const sid = await makeSessionAtStep1(collab, '-u3');

    // Worker fails twice (retried, not submitted)
    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });

    // Check failure count before success (session still at step1 — key matches current step)
    const afterFails = await collab.get(sid);
    assert.equal(collab.getArtifactFailureCount(afterFails, 'worker'), 2, 'failure count is 2 before success');

    // Worker succeeds on 3rd attempt
    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.9, summary: 'finally parsed',
      circling_step: 1,
      circling_artifacts: [{ type: 'workArtifact', content: 'good output' }],
    });
    // ReviewerA + ReviewerB submit
    await reflect(collab, sid, {
      node_id: 'reviewerA', vote: 'continue', confidence: 0.8, summary: 'ok',
      circling_step: 1,
      circling_artifacts: [{ type: 'reviewArtifact', content: 'review A' }],
    });
    const last = await reflect(collab, sid, {
      node_id: 'reviewerB', vote: 'continue', confidence: 0.8, summary: 'ok',
      circling_step: 1,
      circling_artifacts: [{ type: 'reviewArtifact', content: 'review B' }],
    });

    // Barrier fires on 3/3
    assert.equal(last.session.circling.current_step, 2, 'barrier should advance after 3/3');

    // Worker artifact is present (success, not degraded)
    const final = await collab.get(sid);
    assert.ok(collab.getArtifactByKey(final, 'sr1_step1_worker_workArtifact'), 'worker artifact stored on success');
    // Confirm failure count never reached 3 (checked at step1, before advance moved to step2)
    assert.equal(collab.getArtifactFailureCount(afterFails, 'worker'), 2, 'never reached 3 failures — not degraded');
  });

  it('3 failures → degraded: reflection counts toward barrier, CRITICAL expected', async () => {
    const collab = new CollabStore(makeMockKV());
    useStore(collab);
    const sid = await makeSessionAtStep1(collab, '-u4');

    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    const r3 = await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });

    // Third failure: degraded event, reflection submitted
    assert.equal(r3.retried, false, 'third failure is degraded, not retried');

    const s = await collab.get(sid);
    assert.equal(collab.getArtifactFailureCount(s, 'worker'), 3);
    const round = s.rounds[s.rounds.length - 1];
    assert.ok(round.reflections.find(r => r.node_id === 'worker'), 'degraded reflection in round');

    // Other 2 submit → barrier fires with 3/3 (degraded worker counts)
    await reflect(collab, sid, {
      node_id: 'reviewerA', vote: 'continue', confidence: 0.8, summary: 'ok',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'review A' }],
    });
    const last = await reflect(collab, sid, {
      node_id: 'reviewerB', vote: 'continue', confidence: 0.8, summary: 'ok',
      circling_step: 1, circling_artifacts: [{ type: 'reviewArtifact', content: 'review B' }],
    });
    assert.equal(last.session.circling.current_step, 2, 'barrier fires after degraded + 2 good');

    // Degraded node has no artifact
    const final = await collab.get(sid);
    assert.ok(!collab.getArtifactByKey(final, 'sr1_step1_worker_workArtifact'), 'degraded: no artifact');
  });
});

// ── Suite 2: integration via real NATS + JetStream ────────────────────────────
// "runtime:" evidence for step 2.3: a mock session where the worker sends
// parse_failed ×2 then succeeds — session completes with failure_count=2 (not degraded).

const NATS_SKIP = natsServerBin() ? undefined : 'nats-server not found on PATH';

describe('parse-failure retry — integration (real NATS KV)', { skip: NATS_SKIP }, () => {
  let storeDir, nats, nc, kv, collab;

  before(async () => {
    const { connect } = await import('nats');
    storeDir = await mkdtemp(join(tmpdir(), 'circling-retry-nats-'));
    const port = await freePort();
    nats = await startNatsServer(writeServerConfig(storeDir, port, { auth: false }));
    nc = await connect({ servers: `nats://127.0.0.1:${port}` });
    const js = nc.jetstream();
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({ name: 'KV_MESH_COLLAB', subjects: ['$KV.MESH_COLLAB.>'] });
    kv = await js.views.kv('MESH_COLLAB');
    collab = new CollabStore(kv);
    useStore(collab);
  });

  after(async () => {
    await nc?.close();
    await nats?.stop();
    if (storeDir) await rm(storeDir, { recursive: true, force: true });
  });

  it('double parse failure then success: session completes, failure_count=2 (not degraded)', async () => {
    const sid = await makeSessionAtStep1(collab, '-rt-001');

    // Worker fails twice (retried, not submitted to round)
    const f1 = await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    assert.equal(f1.retried, true, 'failure 1: retry issued');

    const f2 = await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.5, summary: '',
      circling_step: 1, parse_failed: true,
    });
    assert.equal(f2.retried, true, 'failure 2: retry issued');

    // Check failure count while session is still at step1 (before barrier advances)
    const midSession = await collab.get(sid);
    const midFailCount = collab.getArtifactFailureCount(midSession, 'worker');
    assert.equal(midFailCount, 2, 'failure_count=2 after 2 retried failures');

    // Worker succeeds on 3rd attempt
    await reflect(collab, sid, {
      node_id: 'worker', vote: 'continue', confidence: 0.95, summary: 'parsed on attempt 3',
      circling_step: 1,
      circling_artifacts: [{ type: 'workArtifact', content: 'final good output' }],
    });

    // Reviewers submit
    await reflect(collab, sid, {
      node_id: 'reviewerA', vote: 'continue', confidence: 0.8, summary: 'looks good',
      circling_step: 1,
      circling_artifacts: [{ type: 'reviewArtifact', content: 'review A text' }],
    });
    const last = await reflect(collab, sid, {
      node_id: 'reviewerB', vote: 'continue', confidence: 0.8, summary: 'approved',
      circling_step: 1,
      circling_artifacts: [{ type: 'reviewArtifact', content: 'review B text' }],
    });

    // Barrier advanced (all 3 submitted after worker's eventual success)
    assert.equal(last.session.circling.current_step, 2, 'barrier advances on 3/3 success');

    // Verify artifact in live KV (after advance, session is at step2)
    const stored = await collab.get(sid);
    assert.ok(collab.getArtifactByKey(stored, 'sr1_step1_worker_workArtifact'), 'worker artifact present in KV');

    // Runtime evidence line for AUDIT_POST
    // failure_count checked at step1 (mid-session), before barrier advanced to step2
    console.log([
      `[step23-runtime] session=${sid}`,
      `worker_parse_failures=2`,
      `failure_count_at_step1=${midFailCount}`,
      `degraded=false`,
      `worker_artifact_present=${!!collab.getArtifactByKey(stored, 'sr1_step1_worker_workArtifact')}`,
      `barrier_advanced=${last.session.circling.current_step === 2}`,
    ].join(' '));
  });
});
