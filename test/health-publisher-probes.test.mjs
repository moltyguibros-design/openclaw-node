/**
 * health-publisher-probes.test.mjs — mesh-health-publisher's probes must not
 * block the event loop, a Linux node must probe units that exist, and the
 * published role is the configured one, flagged when the running services
 * disagree.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const publisher = require('../bin/mesh-health-publisher.js');

const activeUnit = 'LoadState=loaded\nActiveState=active\nMainPID=42';
const missingUnit = 'LoadState=not-found\nActiveState=inactive\nMainPID=0';

describe('mesh-health-publisher probes', () => {
  it('Linux probes the mesh-agent and task-daemon user units, not the nonexistent openclaw-agent', async () => {
    const calls = [];
    const services = await publisher.getServices(async (file, args) => {
      calls.push([file, ...args].join(' '));
      return args.includes('openclaw-mesh-task-daemon') ? activeUnit : missingUnit;
    }, false);
    assert.ok(calls.every((c) => c.startsWith('systemctl --user show ')), calls.join('\n'));
    assert.ok(!calls.some((c) => / openclaw-agent /.test(c)), calls.join('\n'));
    const names = services.map((s) => s.name);
    assert.ok(names.includes('mesh-task-daemon') && names.includes('mesh-agent'), names.join(','));
    assert.equal(services.find((s) => s.name === 'mesh-task-daemon').status, 'active');
  });

  it('the role is the configured one, with a flag when the running services disagree', () => {
    const lead = [{ name: 'mesh-task-daemon', status: 'active' }];
    assert.deepEqual(publisher.reconcileRole('lead', lead),
      { role: 'lead', configuredRole: 'lead', runningRole: 'lead', roleMismatch: false });
    assert.deepEqual(publisher.reconcileRole('worker', lead),
      { role: 'worker', configuredRole: 'worker', runningRole: 'lead', roleMismatch: true });
    assert.equal(publisher.reconcileRole('lead', []).roleMismatch, true);
  });

  // follow-up#4: a role is what was saved for the node, never a guess from its OS.
  it('with no configured role it publishes "unknown", logs once, and never guesses from the platform', () => {
    assert.deepEqual(publisher.reconcileRole(null, []),
      { role: 'unknown', configuredRole: null, runningRole: 'worker', roleMismatch: false });
    const home = mkdtempSync(join(tmpdir(), 'health-norole-'));
    const warn = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      assert.equal(publisher.resolveConfiguredRole({}, home), null);
      assert.equal(publisher.resolveConfiguredRole({ OPENCLAW_NODE_ROLE: 'Lead' }, home), null);
    } finally {
      console.warn = warn;
      rmSync(home, { recursive: true, force: true });
    }
    assert.ok(warnings.length <= 1, warnings.join('\n'));
    const src = readFileSync(new URL('../bin/mesh-health-publisher.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /isMac \? "lead"|IS_MAC \? .lead/);
  });

  it('the configured role comes from OPENCLAW_NODE_ROLE, else openclaw.env', () => {
    const home = mkdtempSync(join(tmpdir(), 'health-role-'));
    try {
      assert.equal(publisher.resolveConfiguredRole({ OPENCLAW_NODE_ROLE: 'lead' }, home), 'lead');
      assert.equal(publisher.resolveConfiguredRole({}, home), null);
      mkdirSync(join(home, '.openclaw'));
      writeFileSync(join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_NODE_ID=a\nOPENCLAW_NODE_ROLE="lead"\n');
      assert.equal(publisher.resolveConfiguredRole({ OPENCLAW_NODE_ROLE: '' }, home), 'lead');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('gatherHealth runs its probes concurrently and leaves the event loop free', async () => {
    const DELAY = 150;
    let inFlight = 0;
    let maxInFlight = 0;
    const run = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, DELAY));
      inFlight--;
      return null;
    };
    const nc = { info: { version: 'test' }, isClosed: () => false };
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 10);
    const start = Date.now();
    const health = await publisher.gatherHealth(nc, run);
    const elapsed = Date.now() - start;
    clearInterval(timer);
    assert.ok(maxInFlight > 1, `probes ran one at a time (max in flight ${maxInFlight})`);
    assert.ok(elapsed < DELAY * 3, `gatherHealth took ${elapsed}ms for ${DELAY}ms probes`);
    assert.ok(ticks > 3, `event loop starved during gatherHealth (${ticks} ticks)`);
    assert.ok(['lead', 'worker', 'unknown'].includes(health.role));
    assert.equal(typeof health.roleMismatch, 'boolean');
  });
});
