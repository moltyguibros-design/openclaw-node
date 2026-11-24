/**
 * memory-daemon-wiring.test.mjs — the daemon no longer runs subagent-audit.
 * The audit is report-only until its classifier is verified on a real
 * transcript (subagent-audit.mjs header), and the daemon threw the report away
 * at every boot, every session end and every 30 minutes. Re-enabling it is a
 * plan step for when the classifier is fixed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repo, daemonFixture, recordingBin, transcript, runDaemon, calls, removeFixture } from './helpers/memory-daemon-harness.mjs';

test('no boot, session end or Phase 2 pass runs subagent-audit', () => {
  const fx = daemonFixture();
  try {
    recordingBin(fx, 'subagent-audit.mjs', 'subagent-audit');
    const previous = transcript(fx, 'aaaa1111', 3600);
    const b = transcript(fx, 'bbbb2222', 5);
    runDaemon(fx, `
      await daemon.handleTransitions([{ from: 'ENDED', to: 'BOOT', sessionId: 'bbbb2222', jsonlPath: ${JSON.stringify(b)}, othersLive: false, previousJsonl: ${JSON.stringify(previous)} }], config);
      config.intervals.maintenanceMs = 0;
      await daemon.runPhase2ThrottledWork(config, []);
      await daemon.handleTransitions([{ from: 'IDLE', to: 'ENDED', sessionId: 'bbbb2222', jsonlPath: ${JSON.stringify(b)}, othersLive: true }], config);
    `);
    assert.deepEqual(calls(fx).filter((c) => c.bin === 'subagent-audit'), []);
  } finally {
    removeFixture(fx);
  }
});

test('the daemon source and the audit header no longer wire the two together', () => {
  const daemon = fs.readFileSync(path.join(repo, 'workspace-bin/memory-daemon.mjs'), 'utf8');
  assert.doesNotMatch(daemon, /subagent-audit|lastTrustHealth|trust-health/);
  const audit = fs.readFileSync(path.join(repo, 'workspace-bin/subagent-audit.mjs'), 'utf8');
  assert.doesNotMatch(audit, /Called by memory-daemon/);
});
