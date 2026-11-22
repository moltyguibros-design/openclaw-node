#!/usr/bin/env node

/**
 * circling-comprehensive.test.js — Comprehensive test suite for the entire
 * Circling Strategy implementation. Covers every untested path from the
 * V3 coverage audit.
 *
 * Organized by layer:
 *   1. Parser (lib/circling-parser.js) — edge cases, opts, legacy fallback
 *   2. State (lib/mesh-collab.js) — storeArtifact blob/exception, compileDirectedInput finalization,
 *      adaptive convergence edge cases
 *   3. State — step_started_at across a finalization gate (the daemon's timeout
 *      handler and sweep are driven for real in test/daemon-circling-handlers.test.js)
 *   4. Prompt — see test/circling-worker-harness.test.mjs (drives the real buildCirclingPrompt)
 *
 * Run: node --test test/circling-comprehensive.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSession,
  CollabStore,
  COLLAB_STATUS,
  COLLAB_MODE,
} = require('../lib/mesh-collab');
const { parseCirclingReflection } = require('../lib/circling-parser');

class MockKV {
  constructor() { this.store = new Map(); this.failOnPut = false; }
  async put(key, value) {
    if (this.failOnPut) throw new Error('JetStream KV write failed: max value size exceeded');
    this.store.set(key, { value });
  }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

// ── Helpers ──

function makeCirclingSession(overrides = {}) {
  return createSession('test-task', {
    mode: 'circling_strategy',
    min_nodes: 3,
    max_nodes: 3,
    max_subrounds: 3,
    automation_tier: 2,
    node_roles: [
      { role: 'worker', soul: 'solidity-dev' },
      { role: 'reviewer', soul: 'tech-architect' },
      { role: 'reviewer', soul: 'qa-engineer' },
    ],
    ...overrides,
  });
}

async function makeActiveSession(overrides = {}) {
  const kv = new MockKV();
  const store = new CollabStore(kv);
  const session = makeCirclingSession(overrides);
  await store.put(session);

  await store.addNode(session.session_id, 'node-worker', 'worker');
  await store.addNode(session.session_id, 'node-revA', 'reviewer');
  await store.addNode(session.session_id, 'node-revB', 'reviewer');

  const s = await store.get(session.session_id);
  s.circling.worker_node_id = 'node-worker';
  s.circling.reviewerA_node_id = 'node-revA';
  s.circling.reviewerB_node_id = 'node-revB';
  s.status = COLLAB_STATUS.ACTIVE;
  await store.put(s);

  return { store, kv, session, sessionId: session.session_id };
}

// ═══════════════════════════════════════════════════════
// 1. PARSER — Edge Cases and Options
// ═══════════════════════════════════════════════════════

describe('Parser: opts.legacyParser fallback', () => {
  it('calls legacyParser when no circling delimiters found', () => {
    let called = false;
    const result = parseCirclingReflection('plain text without delimiters', {
      legacyParser: (output) => {
        called = true;
        return { summary: 'legacy', confidence: 0.6, vote: 'continue', parse_failed: false };
      },
    });
    assert.equal(called, true, 'legacyParser should be called');
    assert.equal(result.summary, 'legacy');
    assert.equal(result.confidence, 0.6);
    assert.equal(result.parse_failed, false);
  });

  it('returns parse_failed when no delimiters and no legacyParser', () => {
    const result = parseCirclingReflection('plain text');
    assert.equal(result.parse_failed, true);
    assert.equal(result.vote, 'parse_error');
  });
});

describe('Parser: opts.log callback', () => {
  it('calls log when no artifacts extracted but not parse_failed', () => {
    const logs = [];
    // Reflection block present but no artifact content before it
    const output = '===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\nvote: continue\n===END_REFLECTION===';
    parseCirclingReflection(output, { log: (msg) => logs.push(msg) });
    assert.ok(logs.some(l => l.includes('No artifacts extracted')), 'should log warning');
  });
});

describe('Parser: invalid vote handling', () => {
  it('marks parse_failed for unknown vote value', () => {
    const output = `some artifact\n\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\nvote: maybe\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.parse_failed, true);
    assert.equal(result.vote, 'parse_error');
  });

  it('defaults to continue when vote line is missing', () => {
    const output = `some artifact\n\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.vote, 'continue');
    assert.equal(result.parse_failed, false);
  });
});

describe('Parser: confidence edge cases', () => {
  it('defaults confidence to 0.5 when missing', () => {
    const output = `artifact content\n\n===CIRCLING_REFLECTION===\ntype: x\nsummary: test\nvote: continue\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.confidence, 0.5);
  });

  it('parses decimal confidence correctly', () => {
    const output = `art\n\n===CIRCLING_REFLECTION===\ntype: x\nsummary: s\nconfidence: 0.95\nvote: converged\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.equal(result.confidence, 0.95);
  });
});

describe('Parser: multi-artifact extra content after last delimiter', () => {
  it('captures extra content after last END_ARTIFACT as type "extra"', () => {
    const output = `first artifact content\n\n===CIRCLING_ARTIFACT===\ntype: workArtifact\n===END_ARTIFACT===\n\nextra trailing content\n\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: test\nconfidence: 0.5\nvote: continue\n===END_REFLECTION===`;
    const result = parseCirclingReflection(output);
    assert.ok(result.circling_artifacts.some(a => a.type === 'extra'), 'should capture trailing content as extra');
  });
});

// ═══════════════════════════════════════════════════════
// 2. STATE — storeArtifact, compileDirectedInput, adaptive convergence
// ═══════════════════════════════════════════════════════

describe('storeArtifact: KV write failure recovery', () => {
  it('returns null and removes artifact on write failure', async () => {
    const kv = new MockKV();
    const store = new CollabStore(kv);
    const session = makeCirclingSession();
    await store.put(session);

    // Store one artifact successfully
    await store.storeArtifact(session.session_id, 'sr0_step0_worker_workArtifact', 'initial code');
    const s1 = await store.get(session.session_id);
    assert.ok(store.getArtifactByKey(s1, 'sr0_step0_worker_workArtifact'));

    // Now make KV fail on ALL puts (simulates persistent blob-too-large)
    let putFailCount = 0;
    const origPut = kv.put.bind(kv);
    kv.put = async (key, value, opts) => {
      putFailCount++;
      if (putFailCount <= 3) throw new Error('max value size exceeded');
      // After 3 failures, allow the recovery write (artifact removed)
      return origPut(key, value, opts);
    };

    // This should exhaust retries, remove the artifact, and re-persist
    const result = await store.storeArtifact(session.session_id, 'sr1_huge_artifact', 'x'.repeat(100));
    assert.equal(result, null, 'should return null on write failure');

    // The failed artifact should NOT be in the session
    const s2 = await store.get(session.session_id);
    assert.equal(store.getArtifactByKey(s2, 'sr1_huge_artifact'), null, 'failed artifact should be removed');
    // But the original artifact should still be there
    assert.ok(store.getArtifactByKey(s2, 'sr0_step0_worker_workArtifact'), 'existing artifacts should survive');
  });
});

describe('compileDirectedInput: finalization phase', () => {
  it('finalization: all nodes receive task plan', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    await store.put(s);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', 'Build ManaToken');
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', 'Build ManaToken');

    assert.ok(workerInput.includes('Original Task Plan'), 'Worker should get task plan in finalization');
    assert.ok(workerInput.includes('Build ManaToken'));
    assert.ok(revAInput.includes('Original Task Plan'), 'Reviewer should get task plan in finalization');
  });

  it('finalization: all nodes receive final workArtifact', async () => {
    const { store, sessionId } = await makeActiveSession();

    await store.storeArtifact(sessionId, 'sr2_step2_worker_workArtifact', 'pragma solidity ^0.8.24; // final');

    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 2;
    s.circling.current_step = 0;
    await store.put(s);

    const fresh = await store.get(sessionId);
    const workerInput = store.compileDirectedInput(fresh, 'node-worker', '');
    const revAInput = store.compileDirectedInput(fresh, 'node-revA', '');

    assert.ok(workerInput.includes('pragma solidity ^0.8.24'), 'Worker should see final artifact');
    assert.ok(revAInput.includes('pragma solidity ^0.8.24'), 'Reviewer should see final artifact');
  });

  it('finalization: missing workArtifact shows UNAVAILABLE', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'finalization';
    s.circling.current_subround = 1;
    s.circling.current_step = 0;
    await store.put(s);

    const fresh = await store.get(sessionId);
    const input = store.compileDirectedInput(fresh, 'node-revA', '');
    assert.ok(input.includes('UNAVAILABLE'), 'missing final artifact should show UNAVAILABLE');
  });
});

describe('Adaptive convergence: edge cases', () => {
  it('dead node excluded from convergence check', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 1;
    // Mark one node dead
    s.nodes[2].status = 'dead'; // node-revB
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revA', circling_step: 2, vote: 'converged' },
        // node-revB is dead, no reflection
      ],
    }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'finalization', 'should early-finalize when all ACTIVE nodes converged');
  });

  it('no reflections in round → does not early exit', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 1;
    s.rounds = [{ round_number: 1, reflections: [] }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'circling', 'should advance to next SR, not finalize');
    assert.equal(result.subround, 2);
  });

  it('early convergence with tier 2 still gates', async () => {
    const { store, sessionId } = await makeActiveSession();
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.automation_tier = 2;
    s.status = COLLAB_STATUS.ACTIVE;
    s.rounds = [{
      round_number: 1,
      reflections: [
        { node_id: 'node-worker', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revA', circling_step: 2, vote: 'converged' },
        { node_id: 'node-revB', circling_step: 2, vote: 'converged' },
      ],
    }];
    await store.put(s);

    const result = await store.advanceCirclingStep(sessionId);
    assert.equal(result.phase, 'finalization');
    assert.equal(result.needsGate, true, 'tier 2 should gate even on early convergence');
  });
});

// ═══════════════════════════════════════════════════════
// 3. STATE — step_started_at across a finalization gate
// ═══════════════════════════════════════════════════════

describe('State: step_started_at across a finalization gate', () => {
  async function atConvergedStep2(automationTier) {
    const { store, sessionId } = await makeActiveSession({ automation_tier: automationTier });
    const s = await store.get(sessionId);
    s.circling.phase = 'circling';
    s.circling.current_subround = 1;
    s.circling.current_step = 2;
    s.circling.step_started_at = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    s.rounds = [{
      round_number: 1,
      reflections: ['node-worker', 'node-revA', 'node-revB'].map(node_id => ({
        node_id, circling_step: 2, vote: 'converged',
      })),
    }];
    await store.put(s);
    return { store, sessionId, startedAt: s.circling.step_started_at };
  }

  it('a tier-2 gate clears step_started_at so the sweep cannot fire during the wait', async () => {
    const { store, sessionId } = await atConvergedStep2(2);
    const r = await store.advanceCirclingStep(sessionId);
    assert.equal(r.needsGate, true);
    assert.equal(r.phase, 'finalization');

    const after = await store.get(sessionId);
    assert.equal(after.circling.step_started_at, null);
  });

  it('a tier-1 transition (no gate) leaves step_started_at alone', async () => {
    const { store, sessionId, startedAt } = await atConvergedStep2(1);
    const r = await store.advanceCirclingStep(sessionId);
    assert.equal(r.needsGate, false);
    assert.equal(r.phase, 'finalization');

    const after = await store.get(sessionId);
    assert.equal(after.circling.step_started_at, startedAt);
  });
});

// ═══════════════════════════════════════════════════════
// 6. SCHEMA — step_started_at and artifact_failures
// ═══════════════════════════════════════════════════════

describe('Schema: artifact_failures tracking', () => {
  it('recordArtifactFailure returns incremented count', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId); // init → SR1/step1

    const count1 = await store.recordArtifactFailure(sessionId, 'node-worker');
    assert.equal(count1, 1);
    const count2 = await store.recordArtifactFailure(sessionId, 'node-worker');
    assert.equal(count2, 2);
    const count3 = await store.recordArtifactFailure(sessionId, 'node-worker');
    assert.equal(count3, 3);
  });

  it('different nodes have independent failure counts', async () => {
    const { store, sessionId } = await makeActiveSession();
    await store.advanceCirclingStep(sessionId);

    await store.recordArtifactFailure(sessionId, 'node-worker');
    await store.recordArtifactFailure(sessionId, 'node-worker');
    await store.recordArtifactFailure(sessionId, 'node-revA');

    const session = await store.get(sessionId);
    assert.equal(store.getArtifactFailureCount(session, 'node-worker'), 2);
    assert.equal(store.getArtifactFailureCount(session, 'node-revA'), 1);
    assert.equal(store.getArtifactFailureCount(session, 'node-revB'), 0);
  });

  it('failure count is per-step (different steps have different counts)', async () => {
    const { store, sessionId } = await makeActiveSession();

    // Advance to step 1
    await store.advanceCirclingStep(sessionId);
    await store.recordArtifactFailure(sessionId, 'node-worker');
    const session1 = await store.get(sessionId);
    assert.equal(store.getArtifactFailureCount(session1, 'node-worker'), 1);

    // Advance to step 2
    await store.advanceCirclingStep(sessionId);
    const session2 = await store.get(sessionId);
    // New step → new key → count resets to 0
    assert.equal(store.getArtifactFailureCount(session2, 'node-worker'), 0);
  });

  it('returns 0 for non-circling session', async () => {
    const result = await (() => {
      const kv = new MockKV();
      const store = new CollabStore(kv);
      return store.recordArtifactFailure('nonexistent', 'node-worker');
    })();
    assert.equal(result, 0);
  });
});

describe('Schema: circling defaults', () => {
  it('circling_strategy min_nodes defaults to 3', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.equal(s.min_nodes, 3);
  });

  it('parallel min_nodes defaults to 2', () => {
    const s = createSession('t', { mode: 'parallel' });
    assert.equal(s.min_nodes, 2);
  });

  it('sequential min_nodes defaults to 2', () => {
    const s = createSession('t', { mode: 'sequential' });
    assert.equal(s.min_nodes, 2);
  });

  it('explicit min_nodes overrides circling default', () => {
    const s = createSession('t', { mode: 'circling_strategy', min_nodes: 5 });
    assert.equal(s.min_nodes, 5);
  });

  it('automation_tier defaults to 2', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.equal(s.circling.automation_tier, 2);
  });

  it('max_subrounds defaults to 3', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.equal(s.circling.max_subrounds, 3);
  });

  it('artifact_failures initialized empty', () => {
    const s = createSession('t', { mode: 'circling_strategy' });
    assert.deepEqual(s.circling.artifact_failures, {});
  });

  it('circling_strategy max_nodes defaults to 3', () => {
    assert.equal(createSession('t', { mode: 'circling_strategy' }).max_nodes, 3);
  });

  it('circling_strategy clamps an explicit max_nodes above 3', () => {
    assert.equal(createSession('t', { mode: 'circling_strategy', max_nodes: 5 }).max_nodes, 3);
  });

  it('parallel max_nodes stays unlimited by default', () => {
    assert.equal(createSession('t', { mode: 'parallel' }).max_nodes, null);
  });

  it('a default circling session refuses a 4th node', async () => {
    const store = new CollabStore(new MockKV());
    const session = createSession('t', { mode: 'circling_strategy' });
    await store.put(session);
    for (const id of ['n1', 'n2', 'n3']) {
      assert.ok(await store.addNode(session.session_id, id), `${id} joins`);
    }
    assert.equal(await store.addNode(session.session_id, 'n4'), null);
    assert.equal((await store.get(session.session_id)).nodes.length, 3);
  });
});
