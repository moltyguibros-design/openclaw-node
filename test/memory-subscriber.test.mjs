import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSubscriber,
  evaluateIngestionPolicy,
  parseSharedSubject,
} from '../bin/memory-subscriber.mjs';

// ── parseSharedSubject ───────────────────────────────────

describe('parseSharedSubject', () => {
  it('parses kanban subject', () => {
    const result = parseSharedSubject('kanban.events.task-1.kanban.created');
    assert.deepStrictEqual(result, {
      category: 'kanban',
      remainder: 'task-1.kanban.created',
    });
  });

  it('parses concept subject', () => {
    const result = parseSharedSubject('concepts.shared.entity-abc');
    assert.deepStrictEqual(result, {
      category: 'concept',
      remainder: 'entity-abc',
    });
  });

  it('parses lesson subject', () => {
    const result = parseSharedSubject('lessons.shared.fact-xyz');
    assert.deepStrictEqual(result, {
      category: 'lesson',
      remainder: 'fact-xyz',
    });
  });

  it('parses artifact subject', () => {
    const result = parseSharedSubject('artifacts.shared.sha256-abc');
    assert.deepStrictEqual(result, {
      category: 'artifact',
      remainder: 'sha256-abc',
    });
  });

  it('returns null for unknown subject', () => {
    const result = parseSharedSubject('unknown.subject.foo');
    assert.strictEqual(result, null);
  });

  it('returns null for non-string input', () => {
    assert.strictEqual(parseSharedSubject(null), null);
    assert.strictEqual(parseSharedSubject(42), null);
  });
});

// ── evaluateIngestionPolicy ──────────────────────────────

describe('evaluateIngestionPolicy', () => {
  const nodeId = 'node-A';

  it('skips self-originated events', () => {
    const event = { promoted_from: { node_id: 'node-A' } };
    const parsed = { category: 'kanban', remainder: 'task-1' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'skip');
    assert.strictEqual(result.reason, 'self_originated');
  });

  it('accepts kanban events unconditionally from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-B' } };
    const parsed = { category: 'kanban', remainder: 'task-1.kanban.created' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'kanban_always_ingest');
  });

  it('accepts concept events from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-C' } };
    const parsed = { category: 'concept', remainder: 'entity-abc' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'shared_concept');
  });

  it('accepts lesson events from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-D' } };
    const parsed = { category: 'lesson', remainder: 'fact-xyz' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'shared_lesson');
  });

  it('accepts artifact events from other nodes', () => {
    const event = { promoted_from: { node_id: 'node-E' } };
    const parsed = { category: 'artifact', remainder: 'sha-abc' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'accept');
    assert.strictEqual(result.reason, 'shared_artifact');
  });

  it('skips broadcast/offer/accepted (Block 9 scope)', () => {
    const event = { promoted_from: { node_id: 'node-B' } };
    const parsed = { category: 'broadcast', remainder: 'topic-1' };
    const result = evaluateIngestionPolicy(event, nodeId, parsed);
    assert.strictEqual(result.decision, 'skip');
    assert.strictEqual(result.reason, 'deferred_to_block_9');
  });

  it('skips events with null parsed subject', () => {
    const event = { promoted_from: { node_id: 'node-B' } };
    const result = evaluateIngestionPolicy(event, nodeId, null);
    assert.strictEqual(result.decision, 'skip');
    assert.strictEqual(result.reason, 'unknown_subject');
  });
});

describe('createSubscriber consumer identity', () => {
  it('names the durable consumer from the canonical node id (JetStream rejects dots)', async () => {
    let durable = null;
    const nc = {
      jetstreamManager: async () => ({
        streams: { info: async () => ({ config: {} }) },
        consumers: {
          info: async () => { throw new Error('consumer not found'); },
          add: async (_stream, cfg) => { durable = cfg.durable_name; },
        },
      }),
      jetstream: () => ({
        consumers: {
          get: async () => ({
            consume: async () => ({ stop() {}, async *[Symbol.asyncIterator]() {} }),
          }),
        },
      }),
    };
    const sub = await createSubscriber(nc, 'MoltyMacs-Virtual-Machine.local', {
      onIngest: (event, parsed, provenance) => { void event; void parsed; void provenance; },
      onError: () => {},
    });
    await sub.stop();
    assert.equal(durable, 'subscriber-moltymacs-virtual-machine');
  });
});

describe('createSubscriber projection', () => {
  function fakeShared(messages) {
    return {
      jetstreamManager: async () => ({
        streams: { info: async () => ({ config: {} }) },
        consumers: { info: async () => ({}), add: async () => {} },
      }),
      jetstream: () => ({
        consumers: {
          get: async () => ({
            consume: async () => ({ stop() {}, async *[Symbol.asyncIterator]() { yield* messages; } }),
          }),
        },
      }),
    };
  }
  function message(log) {
    const data = new TextEncoder().encode(JSON.stringify({ event_id: 'e1', promoted_from: { node_id: 'node-B' } }));
    return { subject: 'kanban.events.task-1.kanban.created', data, ack: () => log.push('ack'), nak: () => log.push('nak') };
  }
  async function settled(log) {
    while (!log.includes('ack') && !log.includes('nak')) await new Promise((r) => setTimeout(r, 2));
    await new Promise((r) => setTimeout(r, 20));
  }

  it('awaits an async onIngest: a rejection naks and is not counted as ingested', async () => {
    const log = [];
    const errors = [];
    const sub = await createSubscriber(fakeShared([message(log)]), 'node-A', {
      onIngest: async () => { await new Promise((r) => setTimeout(r, 5)); throw new Error('projection down'); },
      onError: (ctx, err) => errors.push([ctx, err.message]),
    });
    await settled(log);
    await sub.stop();
    assert.deepEqual(log, ['nak']);
    assert.deepEqual(errors, [['projection', 'projection down']]);
    assert.deepEqual(sub.stats, { ingested: 0, skipped: 0, errors: 1 });
  });

  it('acks only after an async onIngest settles', async () => {
    const log = [];
    const sub = await createSubscriber(fakeShared([message(log)]), 'node-A', {
      onIngest: async () => { await new Promise((r) => setTimeout(r, 5)); log.push('projected'); },
      onError: () => {},
    });
    await settled(log);
    await sub.stop();
    assert.deepEqual(log, ['projected', 'ack']);
    assert.equal(sub.stats.ingested, 1);
  });
});
