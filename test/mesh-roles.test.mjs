/**
 * mesh-roles.test.mjs — the deploy listener's component filter names the
 * mesh-deploy MANIFEST ids. It used to hold gateway / companion-bridge /
 * service-defs (no such ids) and miss config, services, lane-watchdog,
 * log-rotate and mesh-tool-discord: a fleet `--component config` was skipped on
 * every node, and `--component gateway` "succeeded" having deployed nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ROLE_COMPONENTS, FLEET_COMPONENTS } = require('../lib/mesh-roles.js');

process.env.OPENCLAW_NODE_ROLE = 'lead';
process.env.OPENCLAW_REPO_DIR = path.join(os.tmpdir(), `mesh-roles-no-repo-${process.pid}`);
const { runDeploy } = require('../bin/mesh-deploy-listener.js');

const trigger = components => ({ sha: 'abcdef1', branch: 'main', components });

describe('fleet component filter', () => {
  it('lets every repo-sourced MANIFEST id through on the role that runs it', () => {
    assert.deepEqual(FLEET_COMPONENTS.lead, [
      'mesh-daemons', 'mesh-cli', 'shared-lib', 'mc', 'memory-daemon', 'workspace-bin', 'memory-harness',
      'souls', 'skills', 'boot', 'workspace-docs', 'harness-rules', 'config', 'services', 'lane-watchdog',
      'log-rotate', 'mesh-tool-discord',
    ]);
    assert.deepEqual(FLEET_COMPONENTS.worker, [
      'mesh-daemons', 'mesh-cli', 'shared-lib', 'workspace-bin', 'souls', 'skills', 'workspace-docs',
      'harness-rules', 'config', 'services',
    ]);
  });

  it('keeps the npm/git-sourced openclaw and companion local-only, but advertises them', () => {
    for (const role of ['lead', 'worker']) {
      assert.ok(!FLEET_COMPONENTS[role].includes('openclaw'));
      assert.ok(!FLEET_COMPONENTS[role].includes('companion'));
      assert.ok(ROLE_COMPONENTS[role].includes('openclaw'));
    }
    assert.ok(ROLE_COMPONENTS.lead.includes('companion'));
    assert.ok(!ROLE_COMPONENTS.worker.includes('companion'));
  });

  it('a fleet trigger naming config reaches the deploy on a lead', async () => {
    const r = await runDeploy(trigger(['config']));
    assert.equal(r.status, 'failed', 'passed the filter and reached the (missing) repo');
    assert.match(r.errors.join(' '), /Repo dir not found/);
  });

  for (const id of ['gateway', 'companion-bridge', 'service-defs', 'openclaw', 'companion']) {
    it(`a fleet trigger naming only ${id} is skipped, not reported deployed`, async () => {
      const r = await runDeploy(trigger([id]));
      assert.equal(r.status, 'skipped');
    });
  }
});
