// Step 3.2 — cooperative protocol: propose-all / integrate-one / rotate-integrator.
// Unit-level: the session schema. The daemon's real rotation (dead members
// skipped) is driven in test/collab-p1-hardening.test.js; the live
// propose→integrate→rotate flow is verified by a mock-LLM runtime run (AUDIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSession, COLLAB_MODE, isModeImplemented } = require('../lib/mesh-collab.js');

test('cooperative is now an implemented mode (3.2)', () => {
  assert.ok(isModeImplemented(COLLAB_MODE.COOPERATIVE));
});

test('createSession builds the cooperative block only for cooperative mode', () => {
  const coop = createSession('t-1', { mode: COLLAB_MODE.COOPERATIVE });
  assert.ok(coop.cooperative, 'cooperative session must carry the cooperative block');
  assert.equal(coop.cooperative.rounds_target, 3, 'default 3 rounds');
  assert.deepEqual(coop.cooperative.integrations, []);
  assert.equal(coop.cooperative.current_integrator, null, 'integrator assigned at recruiting close');
  assert.equal(coop.circling, null, 'cooperative carries no circling block');

  const circ = createSession('t-2', { mode: COLLAB_MODE.CIRCLING_STRATEGY });
  assert.equal(circ.cooperative, null, 'circling carries no cooperative block');

  const par = createSession('t-3', { mode: COLLAB_MODE.PARALLEL });
  assert.equal(par.cooperative, null);
});

test('rounds_target is configurable, bounded by max_rounds default', () => {
  const s = createSession('t-4', { mode: COLLAB_MODE.COOPERATIVE, rounds: 2 });
  assert.equal(s.cooperative.rounds_target, 2);
  assert.ok(s.max_rounds >= s.cooperative.rounds_target, 'max_rounds must cover rounds_target');
});
