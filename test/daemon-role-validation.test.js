#!/usr/bin/env node
/**
 * daemon-role-validation.test.js — audit mesh-core#13, the daemon half,
 * driven through the REAL handleComplete over in-memory KV.
 *
 * handleComplete validated required_outputs against result.artifacts (always
 * empty) merged with the files of harness violations (out-of-scope files that
 * had already been reverted), and skipped the check when that list was empty.
 * So a role's required outputs were almost never checked, and the rare check
 * could pass on a reverted file. The worker now sends the verdict it computed
 * in its worktree, and the daemon acts on it.
 *
 * Uses config/roles/solidity-dev.yaml: a test file under test/** is required.
 *
 * Run: node --test test/daemon-role-validation.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'role-validation-'));
process.env.OPENCLAW_OBS_DB = path.join(TMP, 'obs.db');
process.env.HOME = TMP;

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');
const { signOperatorRequest } = require('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(TMP, 'operator'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { TaskStore } = require('../lib/mesh-tasks');
const { CollabStore } = require('../lib/mesh-collab');
const { PlanStore } = require('../lib/mesh-plans');

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
  const store = new TaskStore(new MockKV());
  const nc = { publish() {}, request: async () => { throw new Error('no agent on the test bus'); } };
  daemon.__test.setContext({ nc, store, collabStore: new CollabStore(new MockKV()), planStore: new PlanStore(new MockKV()) });
  async function rpc(handler, payload) {
    let reply;
    await daemon.__test[handler]({
      data: sc.encode(JSON.stringify(payload)),
      respond(data) { reply = JSON.parse(sc.decode(data)); },
    });
    return reply;
  }
  return { store, rpc };
}

/** A claimed metric task with role solidity-dev: without a role failure it auto-completes. */
async function claimed(h) {
  assert.equal((await h.rpc('handleSubmit', { task_id: 'T-1', title: 'token', metric: 'npm test', role: 'solidity-dev' })).ok, true);
  const claim = await h.rpc('handleClaim', { node_id: 'worker' });
  return { task_id: 'T-1', node_id: 'worker', lease_token: claim.data.lease_token };
}

const reverted = { violations: [{ rule: 'scope-enforcement', files: ['test/Token.test.js'], message: 'reverted' }], warnings: [] };

describe('handleComplete acts on the worker\'s role verdict (mesh-core#13)', () => {
  it('a failing verdict sends the task to review with its issues', async () => {
    const h = harness();
    const owner = await claimed(h);
    const reply = await h.rpc('handleComplete', { ...owner, result: {
      success: true, artifacts: ['contracts/Token.sol'],
      role_validation: { role: 'solidity-dev', passed: false, issues: ['[required_output] Test file must accompany any contract change: No output file matches pattern: test/**/*.test.js'] },
    } });
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'pending_review');
    assert.equal(reply.data.result.role_validation.passed, false);
    assert.match(reply.data.result.role_validation.issues[0], /Test file must accompany/);
  });

  it('a reverted out-of-scope file no longer satisfies file_match', async () => {
    const h = harness();
    const owner = await claimed(h);
    const reply = await h.rpc('handleComplete', { ...owner, result: {
      success: true, artifacts: ['contracts/Token.sol'], harness: reverted,
      role_validation: { role: 'solidity-dev', passed: false, issues: ['[required_output] missing test'] },
    } });
    assert.equal(reply.data.status, 'pending_review');
  });

  it('an owner completion with no verdict goes to review instead of passing unchecked', async () => {
    const h = harness();
    const owner = await claimed(h);
    const reply = await h.rpc('handleComplete', { ...owner, result: { success: true, artifacts: [] } });
    assert.equal(reply.data.status, 'pending_review');
    assert.deepEqual(reply.data.result.role_validation.issues, ['[required_output] the worker sent no role validation']);
  });

  it('a passing verdict lets the metric auto-approve stand', async () => {
    const h = harness();
    const owner = await claimed(h);
    const reply = await h.rpc('handleComplete', { ...owner, result: {
      success: true, artifacts: ['contracts/Token.sol', 'test/Token.test.js'],
      role_validation: { role: 'solidity-dev', passed: true, issues: [] },
    } });
    assert.equal(reply.data.status, 'completed');
  });

  it('a signed operator force-complete is not held for a verdict it cannot carry', async () => {
    const h = harness();
    await claimed(h);
    const reply = await h.rpc('handleComplete', signOperatorRequest({ task_id: 'T-1', result: { success: true, forced: true } }, { identity: operator, nodeId: 'operator' }));
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.status, 'completed');
  });
});
