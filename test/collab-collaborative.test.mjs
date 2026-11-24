// Step 3.3 — collaborative protocol: decompose → per-node subtasks (parallel) →
// merge + merge-review. Unit-level: session schema + the daemon's scope split (the
// merger choice is driven in test/daemon-recruit-dispatch.test.js). The live
// work→merge→review flow is verified by a mock-LLM runtime run (AUDIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSession, COLLAB_MODE, isModeImplemented } = require('../lib/mesh-collab.js');
const daemon = require('../bin/mesh-task-daemon.js');

test('collaborative is now an implemented mode (3.3)', () => {
  assert.ok(isModeImplemented(COLLAB_MODE.COLLABORATIVE));
});

test('createSession builds the collaborative block only for collaborative mode', () => {
  const c = createSession('t-1', { mode: COLLAB_MODE.COLLABORATIVE });
  assert.ok(c.collaborative, 'collaborative session must carry the collaborative block');
  assert.equal(c.collaborative.phase, 'work', 'starts in the work phase');
  assert.deepEqual(c.collaborative.subtasks, {});
  assert.equal(c.collaborative.merged, null);
  assert.deepEqual(c.collaborative.review_votes, []);
  assert.equal(c.collaborative.merger_node_id, null, 'merger assigned at recruiting close');
  assert.equal(c.cooperative, null, 'collaborative carries no cooperative block');
  assert.equal(c.circling, null, 'collaborative carries no circling block');

  const par = createSession('t-2', { mode: COLLAB_MODE.PARALLEL });
  assert.equal(par.collaborative, null);
});

// The daemon's real scope split. It sets node.role, so every case builds fresh nodes.
test('computeNodeScopes: partitioned, empty-scope and leader_only slices', () => {
  const nodes = (...ids) => ids.map((node_id) => ({ node_id }));
  const { computeNodeScopes } = daemon.__test;
  assert.deepEqual(computeNodeScopes(nodes('alpha', 'bravo', 'charlie'), ['a.js', 'b.js', 'c.js'], 'partitioned'),
    { alpha: ['a.js'], bravo: ['b.js'], charlie: ['c.js'] });
  assert.deepEqual(computeNodeScopes(nodes('alpha', 'bravo', 'charlie'), [], 'partitioned'),
    { alpha: ['*'], bravo: ['*'], charlie: ['*'] });
  assert.deepEqual(computeNodeScopes(nodes('a', 'b', 'c'), ['x.js'], 'partitioned'),
    { a: ['x.js'], b: ['[NO-SCOPE-ASSIGNED]'], c: ['[NO-SCOPE-ASSIGNED]'] });
  const team = nodes('a', 'b', 'c');
  assert.deepEqual(computeNodeScopes(team, ['x.js'], 'leader_only'),
    { a: ['x.js'], b: ['[REVIEW-ONLY] x.js'], c: ['[REVIEW-ONLY] x.js'] });
  assert.deepEqual(team.map((n) => n.role), ['leader', 'reviewer', 'reviewer']);
});
