import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createGateTracker, createGapDetector, soloArmResult } from '../bin/fed-run-driver.mjs';

describe('createGateTracker — RUN_RULES clause 2, >=90s between gate observations', () => {
  it('does NOT forfeit on consecutive 45s polls (the run-1 pair-4 P0)', () => {
    const g = createGateTracker(90_000);
    const t0 = 1_000_000;
    assert.equal(g.observe(true, t0), false, 'first observation arms only');
    assert.equal(g.observe(true, t0 + 45_100), false, '45.1s apart must NOT forfeit');
  });

  it('forfeits when a gate observation lands >=90s after the first', () => {
    const g = createGateTracker(90_000);
    const t0 = 1_000_000;
    g.observe(true, t0);
    g.observe(true, t0 + 45_000);
    assert.equal(g.observe(true, t0 + 90_000), true, '90s after the first observation forfeits');
  });

  it('a non-gate observation resets the window (observations must be consecutive)', () => {
    const g = createGateTracker(90_000);
    const t0 = 1_000_000;
    g.observe(true, t0);
    g.observe(false, t0 + 45_000);
    assert.equal(g.observe(true, t0 + 120_000), false, 'window restarted by the clear poll');
    assert.equal(g.observe(true, t0 + 220_000), true, 'then forfeits 100s later');
  });
});

describe('createGapDetector — host-suspension gaps are INFRA_INVALID, not forfeits', () => {
  it('stays quiet at normal poll cadence', () => {
    const d = createGapDetector(5 * 60_000);
    let t = 1_000_000;
    assert.equal(d.check(t), 0, 'first check primes');
    for (let i = 0; i < 10; i++) { t += 45_000; assert.equal(d.check(t), 0); }
  });

  it('reports the gap when polls jump beyond the threshold (lid-close freeze)', () => {
    const d = createGapDetector(5 * 60_000);
    const t0 = 1_000_000;
    d.check(t0);
    d.check(t0 + 45_000);
    const gap = d.check(t0 + 45_000 + 100 * 60_000);
    assert.equal(gap, 100 * 60_000, 'the run-1 pair-5 100-minute freeze is detected');
  });
});

describe('soloArmResult — every terminal task status ends the solo arm', () => {
  it('completed is a delivered solo arm', () => {
    assert.deepEqual(soloArmResult('completed'), { ok: true });
  });

  it('failed, cancelled, released and rejected end the arm with their own status as the reason', () => {
    for (const status of ['failed', 'cancelled', 'released', 'rejected']) {
      assert.deepEqual(soloArmResult(status), { ok: false, reason: `solo task ${status}` }, status);
    }
  });

  it('non-terminal statuses keep the arm polling', () => {
    for (const status of ['queued', 'claimed', 'running', 'pending_review']) {
      assert.equal(soloArmResult(status), null, status);
    }
  });
});
