/**
 * local-event-log.test.mjs — Unit tests for lib/local-event-log.mjs
 *
 * Tests buildMemoryEvent helper and MemoryBudget dual-write integration.
 * Uses mock event log (no live NATS required).
 *
 * Run: node --test test/local-event-log.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { buildMemoryEvent, canonicalNodeId, createLocalEventLog, eventStreamRetention, localEventStreamName, localEventSubjectPrefix } from '../lib/local-event-log.mjs';
import { MemoryBudget } from '../lib/memory-budget.mjs';
import {
  MemoryEventSchema,
  SessionStartedSchema,
  SessionEndedSchema,
  FactExtractedSchema,
} from '../packages/event-schemas/dist/index.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-event-log-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── buildMemoryEvent ────────────────────────────────────

describe('buildMemoryEvent', () => {
  it('produces valid envelope fields', () => {
    const event = buildMemoryEvent(
      'memory.session_started',
      'sess-123',
      'session',
      { session_id: 'sess-123', start_time: new Date().toISOString(), session_type: 'daemon' },
      'test-node',
    );

    // UUID format for event_id
    assert.match(event.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // ISO timestamp
    assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    // idempotency_key defaults to event_id
    assert.equal(event.idempotency_key, event.event_id);
    // envelope fields
    assert.equal(event.event_type, 'memory.session_started');
    assert.equal(event.event_version, 1);
    assert.equal(event.entity_id, 'sess-123');
    assert.equal(event.entity_type, 'session');
    assert.equal(event.node_id, 'test-node');
    assert.deepEqual(event.actor, { type: 'system', id: 'daemon-test-node' });
    assert.equal(event.causation_id, null);
    assert.equal(event.correlation_id, null);
  });

  it('session_started event validates against schema', () => {
    const event = buildMemoryEvent(
      'memory.session_started',
      'sess-456',
      'session',
      { session_id: 'sess-456', start_time: new Date().toISOString(), session_type: 'interactive' },
      'node-a',
    );
    const result = SessionStartedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });

  it('session_ended event validates against schema', () => {
    const event = buildMemoryEvent(
      'memory.session_ended',
      'sess-456',
      'session',
      { session_id: 'sess-456', end_time: new Date().toISOString(), duration_ms: 60000, turn_count: 10 },
      'node-a',
    );
    const result = SessionEndedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });

  it('fact_extracted event validates against schema', () => {
    const event = buildMemoryEvent(
      'memory.fact_extracted',
      'sess-789',
      'session',
      { session_id: 'sess-789', fact: 'User prefers dark mode', category: 'preference', speaker: 'user' },
      'node-b',
    );
    const result = FactExtractedSchema.safeParse(event);
    assert.equal(result.success, true, `Validation errors: ${JSON.stringify(result.error?.issues)}`);
  });
});

describe('local event stream naming', () => {
  it('preserves a valid deployed node id', () => {
    assert.equal(localEventStreamName('moltymacs-virtual-machine'), 'local-events-moltymacs-virtual-machine');
  });

  it('maps the dotted macOS hostname to the deployed canonical node id', () => {
    assert.equal(canonicalNodeId('MoltyMacs-Virtual-Machine.local'), 'moltymacs-virtual-machine');
    assert.equal(localEventStreamName('MoltyMacs-Virtual-Machine.local'), 'local-events-moltymacs-virtual-machine');
  });

  it('rejects an empty node identity', () => {
    assert.throws(() => localEventStreamName('...'), /nodeId/);
  });
});

// ── createLocalEventLog subject partition ───────────────

// A JetStream stand-in that, like the server, refuses a stream whose subjects
// overlap another stream's, and reports a missing stream with err_code 10059.
function mockJetStream() {
  const streams = new Map();
  const states = new Map();
  const updates = [];
  const published = [];
  const overlaps = (a, b) => {
    const pa = a.split('.'), pb = b.split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if (pa[i] === '>' || pb[i] === '>') return true;
      if (pa[i] === undefined || pb[i] === undefined) return false;
      if (pa[i] !== '*' && pb[i] !== '*' && pa[i] !== pb[i]) return false;
    }
    return true;
  };
  const jsm = {
    streams: {
      info: async (name) => {
        if (jsm.infoError) throw jsm.infoError;
        if (!streams.has(name)) throw Object.assign(new Error('stream not found'), { api_error: { code: 404, err_code: 10059 } });
        return { config: streams.get(name), state: states.get(name) ?? { messages: 0, bytes: 0, first_ts: '0001-01-01T00:00:00Z' } };
      },
      update: async (name, cfg) => {
        updates.push({ name, cfg });
        streams.set(name, cfg);
      },
      add: async (cfg) => {
        for (const other of streams.values()) {
          if (cfg.subjects.some((s) => other.subjects.some((o) => overlaps(s, o)))) {
            throw Object.assign(new Error('subjects overlap with an existing stream'), { api_error: { code: 400, err_code: 10065 } });
          }
        }
        streams.set(cfg.name, cfg);
      },
      list: (subject) => ({
        async *[Symbol.asyncIterator]() {
          for (const config of streams.values()) {
            if (config.subjects.some((s) => overlaps(s, subject))) yield { config };
          }
        },
      }),
    },
  };
  const nc = {
    jetstreamManager: async () => jsm,
    jetstream: () => ({ publish: async (subject, data) => { published.push(subject); return { seq: published.length }; } }),
  };
  return { nc, jsm, streams, states, updates, published };
}

describe('createLocalEventLog subject partition', () => {
  it('gives each node its own subject space, so a second node (or a renamed one) gets its stream', async () => {
    const { nc, streams, published } = mockJetStream();
    const a = await createLocalEventLog(nc, 'daedalus');
    const b = await createLocalEventLog(nc, 'MoltyMacs-Virtual-Machine.local');
    assert.deepEqual(streams.get('local-events-daedalus').subjects, ['local.daedalus.>']);
    assert.deepEqual(streams.get('local-events-moltymacs-virtual-machine').subjects, ['local.moltymacs-virtual-machine.>']);
    assert.equal(localEventSubjectPrefix('MoltyMacs-Virtual-Machine.local'), 'local.moltymacs-virtual-machine');

    const event = buildMemoryEvent('memory.session_started', 'sess-1', 'session',
      { session_id: 'sess-1', start_time: new Date().toISOString(), session_type: 'daemon' }, 'daedalus');
    await a.publishLocal(event);
    await b.publishLocal({ ...event, node_id: 'moltymacs-virtual-machine' });
    assert.deepEqual(published, [
      'local.daedalus.session.events.sess-1.memory.session_started',
      'local.moltymacs-virtual-machine.session.events.sess-1.memory.session_started',
    ]);
  });

  it('a legacy stream on local.> blocks the new stream: the error names it and the narrowing command', async () => {
    const { nc, streams } = mockJetStream();
    streams.set('local-events-daedalus', { name: 'local-events-daedalus', subjects: ['local.>'] });
    await assert.rejects(
      createLocalEventLog(nc, 'MoltyMacs-Virtual-Machine.local'),
      (err) => {
        assert.match(err.message, /local-events-moltymacs-virtual-machine/);
        assert.match(err.message, /local-events-daedalus owns local\.>/);
        assert.ok(err.message.includes("nats stream edit local-events-daedalus --subjects 'local.daedalus.>'"), err.message);
        return true;
      },
    );
    assert.deepEqual(streams.get('local-events-daedalus').subjects, ['local.>'], 'the legacy stream is the operator\'s to narrow');
  });

  it('creates the stream only when it is missing; any other info error surfaces', async () => {
    const { nc, jsm, streams } = mockJetStream();
    jsm.infoError = Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT' });
    await assert.rejects(createLocalEventLog(nc, 'daedalus'), /TIMEOUT/);
    assert.equal(streams.size, 0, 'a timeout was treated as "create it"');
  });
});

describe('createLocalEventLog retention', () => {
  const MONTH_NS = 30 * 24 * 60 * 60 * 1e9;
  const MIB_256 = 256 * 1024 * 1024;
  const unlimited = (name) => ({ name, subjects: [`local.${name.slice('local-events-'.length)}.>`], storage: 'file', num_replicas: 1, max_age: 0, max_bytes: -1, discard: 'old' });

  it('a new stream is created with 30 days / 256 MiB, oldest discarded first', async () => {
    const { nc, streams, updates } = mockJetStream();
    await createLocalEventLog(nc, 'daedalus', { log: () => {} });
    const cfg = streams.get('local-events-daedalus');
    assert.equal(cfg.max_age, MONTH_NS);
    assert.equal(cfg.max_bytes, MIB_256);
    assert.equal(cfg.discard, 'old');
    assert.equal(updates.length, 0);
  });

  it('an existing unlimited stream is updated in place once, keeping its config', async () => {
    const { nc, streams, states, updates } = mockJetStream();
    streams.set('local-events-daedalus', unlimited('local-events-daedalus'));
    states.set('local-events-daedalus', { messages: 3, bytes: 900, first_ts: new Date(Date.now() - 86_400_000).toISOString() });
    const logs = [];
    await createLocalEventLog(nc, 'daedalus', { log: (m) => logs.push(m) });
    await createLocalEventLog(nc, 'daedalus', { log: (m) => logs.push(m) });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
      name: 'local-events-daedalus',
      cfg: { ...unlimited('local-events-daedalus'), max_age: MONTH_NS, max_bytes: MIB_256, discard: 'old' },
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /local-events-daedalus/);
  });

  it('a stream that already has limits is left alone', async () => {
    const { nc, streams, updates } = mockJetStream();
    streams.set('local-events-daedalus', { ...unlimited('local-events-daedalus'), max_age: 7 * 24 * 60 * 60 * 1e9, max_bytes: 64 * 1024 * 1024 });
    await createLocalEventLog(nc, 'daedalus', { log: () => {} });
    assert.equal(updates.length, 0);
  });

  it('an unlimited stream holding older history is not trimmed: the command is logged instead', async () => {
    const { nc, streams, states, updates } = mockJetStream();
    streams.set('local-events-daedalus', unlimited('local-events-daedalus'));
    states.set('local-events-daedalus', { messages: 55_173, bytes: 80_000_000, first_ts: '2026-07-14T12:00:00Z' });
    const logs = [];
    await createLocalEventLog(nc, 'daedalus', { log: (m) => logs.push(m) });
    assert.equal(updates.length, 0, 'applying max_age would have expired stored history');
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('nats stream edit local-events-daedalus --max-age 720h --max-bytes 268435456 --discard old'), logs[0]);
  });
});

describe('local event consumers read only their node\'s subjects', () => {
  function consumerNc() {
    const added = [];
    const nc = {
      jetstreamManager: async () => ({
        streams: {
          info: async (name) => ({ config: { name, ...eventStreamRetention() }, state: { messages: 0, bytes: 0, first_ts: '0001-01-01T00:00:00Z' } }),
          add: async () => ({}),
        },
        consumers: {
          info: async () => { throw Object.assign(new Error('consumer not found'), { api_error: { err_code: 10014 } }); },
          add: async (stream, cfg) => { added.push({ stream, ...cfg }); },
        },
      }),
      jetstream: () => ({
        consumers: { get: async () => ({ consume: async () => ({ stop() {}, async *[Symbol.asyncIterator]() {} }) }) },
      }),
    };
    return { nc, added };
  }

  it('the memory watcher and promoter consumers filter on local.<node>.>', async () => {
    const { createMemoryWatcher } = await import('../lib/memory-watcher.mjs');
    const { createPromoter } = await import('../bin/memory-promoter.mjs');
    const { nc, added } = consumerNc();
    const watcher = await createMemoryWatcher(nc, 'Daedalus.local', { outputPath: path.join(tmpDir, 'watcher.jsonl') });
    await watcher.stop();
    const promoter = await createPromoter(nc, 'Daedalus.local');
    await promoter.stop();
    assert.deepEqual(added.map(({ stream, durable_name, filter_subject }) => ({ stream, durable_name, filter_subject })), [
      { stream: 'local-events-daedalus', durable_name: 'watcher-daedalus', filter_subject: 'local.daedalus.>' },
      { stream: 'local-events-daedalus', durable_name: 'promoter-daedalus', filter_subject: 'local.daedalus.>' },
    ]);
  });
});

// ── MemoryBudget dual-write ─────────────────────────────

describe('MemoryBudget dual-write', () => {
  it('calls publishLocal on startSession when eventLog provided', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const published = [];
    const mockEventLog = {
      publishLocal: async (event) => { published.push(event); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });
    mb.startSession();

    // Give fire-and-forget a tick to resolve
    await new Promise(r => setTimeout(r, 10));

    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'memory.session_started');
    assert.equal(published[0].entity_type, 'session');
    assert.ok(published[0].data.session_id);
    assert.equal(published[0].data.session_type, 'daemon');
  });

  it('calls publishLocal on endSession when eventLog provided', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const published = [];
    const mockEventLog = {
      publishLocal: async (event) => { published.push(event); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });
    mb.startSession();
    await new Promise(r => setTimeout(r, 10));
    published.length = 0; // clear startSession event

    mb.endSession();
    await new Promise(r => setTimeout(r, 10));

    assert.equal(published.length, 1);
    assert.equal(published[0].event_type, 'memory.session_ended');
    assert.ok(published[0].data.duration_ms >= 0);
    assert.equal(published[0].data.turn_count, 0);
  });

  it('works without eventLog (no errors)', () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const mb = new MemoryBudget(memFile);
    const frozen = mb.startSession();
    assert.equal(frozen, '# Memory\n');

    mb.endSession();
    assert.equal(mb.isFrozen, false);
    // No errors thrown — this is the baseline behavior
  });

  it('publishLocal errors do not propagate to MemoryBudget callers', async () => {
    const memFile = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(memFile, '# Memory\n');

    const mockEventLog = {
      publishLocal: async () => { throw new Error('NATS connection lost'); },
    };

    const mb = new MemoryBudget(memFile, { eventLog: mockEventLog, nodeId: 'test-node' });

    // None of these should throw despite publishLocal errors
    const frozen = mb.startSession();
    assert.equal(typeof frozen, 'string');

    mb.endSession();
    assert.equal(mb.isFrozen, false);

    // Give fire-and-forget promises time to settle
    await new Promise(r => setTimeout(r, 20));
  });
});

describe('R31 (repair 7.7): content samples are byte-capped', () => {
  it('an oversized decision text is rejected by the schema', () => {
    const event = buildMemoryEvent('memory.extracted', 's-cap', 'memory', {
      session_id: 's-cap', entities_count: 0, themes_count: 0, mentions_count: 0,
      decisions_count: 1, decision_texts: ['x'.repeat(10_000)],
      model: 'qwen3:8b', duration_ms: 1,
    }, 'daedalus');
    assert.throws(() => MemoryEventSchema.parse(event), /too_big|500/i);
  });

  it('a producer-truncated decision text passes', () => {
    const event = buildMemoryEvent('memory.extracted', 's-cap', 'memory', {
      session_id: 's-cap', entities_count: 0, themes_count: 0, mentions_count: 0,
      decisions_count: 1, decision_texts: ['x'.repeat(10_000).slice(0, 500)],
      model: 'qwen3:8b', duration_ms: 1,
    }, 'daedalus');
    assert.doesNotThrow(() => MemoryEventSchema.parse(event));
  });
});
