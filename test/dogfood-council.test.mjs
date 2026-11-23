/**
 * dogfood-council.test.mjs — Tests for the dogfood harness
 *
 * Step 10.9: validates metric recording, aggregation, round-trip
 * calculation, stats formatting, and NATS message processing.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  createMetricEntry,
  formatMetricLine,
  calculateRoundTripMs,
  aggregateFromLines,
  aggregateMetrics,
  emptyStats,
  createMetricCollector,
  formatStatsReport,
  METRIC_TYPES,
  DEFAULT_METRICS_PATH,
  COUNCIL_SIZE,
  MONITORED_SUBJECTS,
} from '../bin/dogfood-council.mjs';

// ─── createMetricEntry ───────────────────────────────────────────────────────

describe('createMetricEntry', () => {
  it('creates an entry with type, data, and ISO timestamp', () => {
    const entry = createMetricEntry(METRIC_TYPES.BROADCAST, { event_id: 'abc' }, 'alpha');
    assert.equal(entry.type, 'broadcast');
    assert.equal(entry.node_id, 'alpha');
    assert.equal(entry.data.event_id, 'abc');
    assert.ok(entry.ts);
    // ts should be a valid ISO date
    assert.ok(!isNaN(new Date(entry.ts).getTime()));
  });

  it('omits node_id when not provided', () => {
    const entry = createMetricEntry(METRIC_TYPES.HARNESS_START, { node_ids: ['a', 'b', 'c'] });
    assert.equal(entry.type, 'harness_start');
    assert.equal(entry.node_id, undefined);
    assert.deepEqual(entry.data.node_ids, ['a', 'b', 'c']);
  });
});

// ─── formatMetricLine ────────────────────────────────────────────────────────

describe('formatMetricLine', () => {
  it('produces valid JSON without trailing newline', () => {
    const entry = createMetricEntry(METRIC_TYPES.OFFER, { event_id: 'x' }, 'bravo');
    const line = formatMetricLine(entry);
    assert.ok(!line.endsWith('\n'));
    const parsed = JSON.parse(line);
    assert.equal(parsed.type, 'offer');
    assert.equal(parsed.node_id, 'bravo');
  });
});

// ─── calculateRoundTripMs ────────────────────────────────────────────────────

describe('calculateRoundTripMs', () => {
  it('calculates positive round-trip from ISO timestamps', () => {
    const t1 = '2026-05-26T14:00:00.000Z';
    const t2 = '2026-05-26T14:00:05.500Z';
    assert.equal(calculateRoundTripMs(t1, t2), 5500);
  });

  it('returns 0 for equal timestamps', () => {
    const t = '2026-05-26T14:00:00.000Z';
    assert.equal(calculateRoundTripMs(t, t), 0);
  });

  it('returns -1 for invalid timestamps', () => {
    assert.equal(calculateRoundTripMs('not-a-date', '2026-05-26T14:00:00.000Z'), -1);
    assert.equal(calculateRoundTripMs('2026-05-26T14:00:00.000Z', 'nope'), -1);
  });

  it('returns 0 when accepted is before broadcast (clamps to 0)', () => {
    const t1 = '2026-05-26T14:00:10.000Z';
    const t2 = '2026-05-26T14:00:05.000Z';
    assert.equal(calculateRoundTripMs(t1, t2), 0);
  });
});

// ─── aggregateFromLines ──────────────────────────────────────────────────────

describe('aggregateFromLines', () => {
  it('counts broadcast, offer, and accepted events', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'alpha', data: { event_id: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:01Z', type: 'broadcast', node_id: 'alpha', data: { event_id: 'b2' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:02Z', type: 'offer', node_id: 'bravo', data: { responding_to: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:03Z', type: 'accepted', node_id: 'alpha', data: { responding_to_broadcast: 'b1' } }),
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.broadcast_count, 2);
    assert.equal(stats.offer_count, 1);
    assert.equal(stats.accepted_count, 1);
  });

  it('calculates offer-to-acceptance ratio', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b2' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b3' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b4' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:01Z', type: 'accepted', node_id: 'a', data: { responding_to_broadcast: 'b1' } }),
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.offer_to_acceptance_ratio, 0.25);
  });

  it('calculates average round-trip time', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00.000Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:10.000Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b2' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:05.000Z', type: 'accepted', node_id: 'a', data: { responding_to_broadcast: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:12.000Z', type: 'accepted', node_id: 'a', data: { responding_to_broadcast: 'b2' } }),
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.avg_round_trip_ms, 3500); // (5000 + 2000) / 2
    assert.equal(stats.round_trip_samples, 2);
  });

  it('tracks signature failures and dead-peer events', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'signature_failure', node_id: 'a', data: { reason: 'bad_sig' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:01Z', type: 'signature_failure', node_id: 'b', data: { reason: 'bad_sig' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:02Z', type: 'dead_peer', node_id: 'a', data: { alert: {} } }),
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.signature_failures, 2);
    assert.equal(stats.dead_peer_events, 1);
  });

  it('builds per-node breakdown', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'alpha', data: { event_id: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:01Z', type: 'offer', node_id: 'bravo', data: {} }),
      JSON.stringify({ ts: '2026-05-26T14:00:02Z', type: 'accepted', node_id: 'alpha', data: {} }),
      JSON.stringify({ ts: '2026-05-26T14:00:03Z', type: 'broadcast', node_id: 'charlie', data: { event_id: 'b2' } }),
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.per_node.alpha.broadcasts, 1);
    assert.equal(stats.per_node.alpha.accepted, 1);
    assert.equal(stats.per_node.bravo.offers, 1);
    assert.equal(stats.per_node.charlie.broadcasts, 1);
  });

  it('computes duration from harness_start to harness_stop', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00.000Z', type: 'harness_start', data: {} }),
      JSON.stringify({ ts: '2026-05-26T14:00:30.000Z', type: 'harness_stop', data: {} }),
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.duration_sec, 30);
  });

  it('handles empty input', () => {
    const stats = aggregateFromLines([]);
    assert.equal(stats.broadcast_count, 0);
    assert.equal(stats.offer_count, 0);
    assert.equal(stats.accepted_count, 0);
    assert.equal(stats.offer_to_acceptance_ratio, 0);
    assert.equal(stats.avg_round_trip_ms, 0);
  });

  it('skips malformed JSON lines', () => {
    const lines = [
      'not json',
      JSON.stringify({ ts: '2026-05-26T14:00:00Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b1' } }),
      '{"incomplete": true',
    ];

    const stats = aggregateFromLines(lines);
    assert.equal(stats.broadcast_count, 1);
  });
});

// ─── emptyStats ──────────────────────────────────────────────────────────────

describe('emptyStats', () => {
  it('returns zeroed stats object', () => {
    const stats = emptyStats();
    assert.equal(stats.broadcast_count, 0);
    assert.equal(stats.offer_count, 0);
    assert.equal(stats.accepted_count, 0);
    assert.equal(stats.offer_to_acceptance_ratio, 0);
    assert.equal(stats.avg_round_trip_ms, 0);
    assert.equal(stats.signature_failures, 0);
    assert.equal(stats.dead_peer_events, 0);
    assert.deepEqual(stats.per_node, {});
  });
});

// ─── createMetricCollector (processMessage) ──────────────────────────────────

describe('round trip on live-shaped events (accepted answers an offer, not the broadcast)', () => {
  it('resolves accepted → offer → broadcast', () => {
    const lines = [
      JSON.stringify({ ts: '2026-05-26T14:00:00.000Z', type: 'broadcast', node_id: 'a', data: { event_id: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:01.000Z', type: 'offer', node_id: 'b', data: { event_id: 'o1', responding_to: 'b1' } }),
      JSON.stringify({ ts: '2026-05-26T14:00:04.000Z', type: 'accepted', node_id: 'a', data: { responding_to_broadcast: 'o1' } }),
    ];
    const stats = aggregateFromLines(lines);
    assert.equal(stats.avg_round_trip_ms, 4000);
    assert.equal(stats.round_trip_samples, 1);
  });

  it('through the collector, as the bus delivers them', async () => {
    const nc = { subscribe: () => ({ [Symbol.asyncIterator]() { return { next() { return { done: true }; } }; } }) };
    const collector = createMetricCollector(nc, { metricsPath: '/dev/null', nodeIds: [], log: () => {} });
    await collector.processMessage('context.broadcast.a', { source_node_id: 'a', event_id: 'b1', data: {} });
    await collector.processMessage('context.offer.b', { node_id: 'b', event_id: 'o1', data: { responding_to: 'b1', artifacts: [] } });
    await collector.processMessage('context.accepted.a', { node_id: 'a', event_id: 'x1', data: { responding_to: 'o1', accepted_artifacts: [] } });
    assert.equal(collector.getStats().round_trip_samples, 1);
  });
});

describe('signature failures from acceptor counters', () => {
  const nc = { subscribe: () => ({ [Symbol.asyncIterator]() { return { next() { return { done: true }; } }; } }) };
  const later = (ms) => new Date(Date.now() + ms).toISOString();

  it('the collector subscribes to the acceptor stats subject', () => {
    assert.ok(MONITORED_SUBJECTS.includes('context.acceptor.stats.>'));
  });

  it('counts increases per acceptor instance, across restarts', async () => {
    const collector = createMetricCollector(nc, { metricsPath: '/dev/null', nodeIds: [], log: () => {} });
    const run1 = later(10);
    const report = (node, started_at, signature_rejected) =>
      collector.processMessage(`context.acceptor.stats.${node}`, { node_id: node, started_at, signature_rejected });

    await report('bravo', run1, 2);
    await report('bravo', run1, 3);
    await report('bravo', run1, 3);
    assert.equal(collector.getStats().signature_failures, 3);

    await report('bravo', later(20), 1);
    const stats = collector.getStats();
    assert.equal(stats.signature_failures, 4);
    assert.equal(stats.per_node.bravo.sig_failures, 4);
  });

  it('baselines an acceptor that was already running when the collector started', async () => {
    const collector = createMetricCollector(nc, { metricsPath: '/dev/null', nodeIds: [], log: () => {} });
    const before = new Date(Date.now() - 60_000).toISOString();
    await collector.processMessage('context.acceptor.stats.charlie', { started_at: before, signature_rejected: 5 });
    assert.equal(collector.getStats().signature_failures, 0);
    await collector.processMessage('context.acceptor.stats.charlie', { started_at: before, signature_rejected: 7 });
    assert.equal(collector.getStats().signature_failures, 2);
  });
});

describe('createMetricCollector.processMessage', () => {
  it('classifies broadcast events from NATS subject', async () => {
    const nc = { subscribe: () => ({ [Symbol.asyncIterator]() { return { next() { return { done: true }; } }; } }) };
    const collector = createMetricCollector(nc, {
      metricsPath: '/dev/null',
      nodeIds: ['a', 'b'],
      log: () => {},
    });

    await collector.processMessage('context.broadcast.alpha', {
      source_node_id: 'alpha',
      event_id: 'b1',
      data: { themes: ['t1'], entities: ['e1'], intensity: 'interested', dedup_key: 'dk' },
    });

    const stats = collector.getStats();
    assert.equal(stats.broadcast_count, 1);
    assert.ok(stats.per_node.alpha);
    assert.equal(stats.per_node.alpha.broadcasts, 1);
  });

  it('classifies offer events from NATS subject', async () => {
    const nc = { subscribe: () => ({ [Symbol.asyncIterator]() { return { next() { return { done: true }; } }; } }) };
    const collector = createMetricCollector(nc, {
      metricsPath: '/dev/null',
      nodeIds: [],
      log: () => {},
    });

    await collector.processMessage('context.offer.bravo', {
      source_node_id: 'bravo',
      event_id: 'o1',
      data: { responding_to: 'b1', artifacts: [{ ref: 'a1' }] },
    });

    const stats = collector.getStats();
    assert.equal(stats.offer_count, 1);
    assert.ok(stats.per_node.bravo);
    assert.equal(stats.per_node.bravo.offers, 1);
  });

  it('detects dead-peer events from health alerts', async () => {
    const nc = { subscribe: () => ({ [Symbol.asyncIterator]() { return { next() { return { done: true }; } }; } }) };
    const collector = createMetricCollector(nc, {
      metricsPath: '/dev/null',
      nodeIds: [],
      log: () => {},
    });

    await collector.processMessage('mesh.health.alerts', {
      source_node_id: 'alpha',
      data: { message: 'dead peer detected: charlie' },
    });

    const stats = collector.getStats();
    assert.equal(stats.dead_peer_events, 1);
    assert.ok(stats.per_node.alpha);
    assert.equal(stats.per_node.alpha.dead_peers, 1);
  });
});

// stop() set `stopped` before recording harness_stop, which recordMetric then
// skipped, so --stats measured the run up to now instead of its duration.
describe('createMetricCollector.stop', () => {
  it('writes harness_stop last, and nothing after it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dogfood-stop-'));
    try {
      const metricsPath = join(dir, 'metrics.jsonl');
      const nc = { subscribe: () => ({
        unsubscribe() {},
        [Symbol.asyncIterator]() { return { next() { return { done: true }; } }; },
      }) };
      const collector = createMetricCollector(nc, { metricsPath, nodeIds: [], log: () => {} });
      await collector.start();
      await collector.stop();
      await collector.processMessage('context.broadcast.alpha', { source_node_id: 'alpha', event_id: 'late', data: {} });
      const entries = (await readFile(metricsPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(entries.map((e) => e.type), ['harness_start', 'harness_stop']);
      assert.equal(entries[1].data.total_lines, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── formatStatsReport ──────────────────────────────────────────────────────

describe('formatStatsReport', () => {
  it('produces a markdown report with summary and per-node tables', () => {
    const stats = {
      broadcast_count: 10,
      offer_count: 5,
      accepted_count: 2,
      offer_to_acceptance_ratio: 0.2,
      avg_round_trip_ms: 3500,
      round_trip_samples: 2,
      signature_failures: 0,
      dead_peer_events: 1,
      duration_sec: 3600,
      per_node: {
        alpha: { broadcasts: 6, offers: 0, accepted: 2, sig_failures: 0, dead_peers: 0 },
        bravo: { broadcasts: 4, offers: 5, accepted: 0, sig_failures: 0, dead_peers: 1 },
      },
    };

    const report = formatStatsReport(stats);
    assert.ok(report.includes('Dogfood Council'));
    assert.ok(report.includes('10'));
    assert.ok(report.includes('0.2'));
    assert.ok(report.includes('3500'));
    assert.ok(report.includes('alpha'));
    assert.ok(report.includes('bravo'));
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('exports expected constants', () => {
    assert.equal(COUNCIL_SIZE, 3);
    assert.ok(DEFAULT_METRICS_PATH.includes('dogfood-metrics.jsonl'));
    assert.ok(Array.isArray(MONITORED_SUBJECTS));
    assert.ok(MONITORED_SUBJECTS.includes('context.broadcast.>'));
    assert.ok(MONITORED_SUBJECTS.includes('context.offer.>'));
    assert.ok(MONITORED_SUBJECTS.includes('context.accepted.>'));
    assert.equal(Object.keys(METRIC_TYPES).length, 7);
  });

  it('--help names lib/nats-resolve as the harness NATS default, not a fixed localhost URL', () => {
    const bin = fileURLToPath(new URL('../bin/dogfood-council.mjs', import.meta.url));
    const { stdout, status } = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    assert.equal(status, 0);
    const line = stdout.split('\n').find((l) => l.trim().startsWith('--nats-url'));
    assert.match(line, /nats-resolve/);
    assert.doesNotMatch(line, /\(default: nats:\/\/localhost:4222\)/);
  });
});

// ─── aggregateMetrics (file-based) ──────────────────────────────────────────

describe('aggregateMetrics', () => {
  it('returns empty stats for non-existent file', () => {
    const stats = aggregateMetrics('/tmp/nonexistent-dogfood-metrics-' + Date.now() + '.jsonl');
    assert.equal(stats.broadcast_count, 0);
    assert.deepEqual(stats.per_node, {});
  });
});
