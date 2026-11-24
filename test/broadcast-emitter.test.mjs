// F-N4/F-N51 fixture compatibility — see test/broadcast-acceptor.test.mjs header.
// Unit tests of emitter logic flip STRICT off because the broadcaster
// instances here aren't given an identity option (they test rate-limiting,
// dedup, intensity inference — not signing). Auth-boundary tests live separately.
process.env.OPENCLAW_REQUIRE_SIGNED = '0';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferIntensity,
  computeDedupKey,
  inferProblemClass,
  createBroadcaster,
  RATE_LIMIT_MS,
  DEDUP_WINDOW_MS,
  DEFAULT_TTL_MINUTES,
  MIN_THEMES_FOR_BROADCAST,
} from '../lib/broadcast-emitter.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';

// ── Mock NATS connection ──────────────────────────────────────────────────

function createMockNc() {
  const published = [];
  return {
    published,
    jetstream() {
      return {
        async publish(subject, data, opts) {
          published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)), opts });
          return { seq: published.length, stream: 'OPENCLAW_SHARED' };
        },
      };
    },
  };
}

function seedStore({ themes = {}, entities = {} }) {
  const { db } = createExtractionStore({ dbPath: ':memory:' });
  const now = new Date().toISOString();
  const theme = db.prepare('INSERT INTO themes (label, first_seen, last_seen, private) VALUES (?, ?, ?, ?)');
  for (const [label, priv] of Object.entries(themes)) theme.run(label, now, now, priv);
  const entity = db.prepare('INSERT INTO entities (name, type, first_seen, last_seen, private) VALUES (?, ?, ?, ?, ?)');
  for (const [name, priv] of Object.entries(entities)) entity.run(name, 'tech', now, now, priv);
  return db;
}

const PUBLISHED = seedStore({
  themes: { memory: 0, federation: 0, broadcast: 0, a: 0, b: 0, c: 0 },
  entities: { NATS: 0, JetStream: 0 },
});

// ── inferIntensity ────────────────────────────────────────────────────────

describe('broadcast-emitter / inferIntensity', () => {
  it('returns actively_seeking for question marks', () => {
    assert.equal(inferIntensity('How do I fix this?'), 'actively_seeking');
  });

  it('returns actively_seeking for stuck/blocked keywords', () => {
    assert.equal(inferIntensity("I'm stuck on the memory daemon"), 'actively_seeking');
    assert.equal(inferIntensity('This is blocked by a dependency'), 'actively_seeking');
  });

  it('returns interested for exploration verbs', () => {
    assert.equal(inferIntensity("Let's explore the federation layer"), 'interested');
    assert.equal(inferIntensity('I was wondering about NATS replication'), 'interested');
    assert.equal(inferIntensity('What if we used a different approach'), 'interested');
  });

  it('returns passive for declarative statements', () => {
    assert.equal(inferIntensity('The daemon starts on port 7893.'), 'passive');
    assert.equal(inferIntensity('Memory injection works correctly.'), 'passive');
  });

  it('returns passive for null/empty input', () => {
    assert.equal(inferIntensity(null), 'passive');
    assert.equal(inferIntensity(''), 'passive');
    assert.equal(inferIntensity(42), 'passive');
  });
});

// ── computeDedupKey ───────────────────────────────────────────────────────

describe('broadcast-emitter / computeDedupKey', () => {
  it('produces deterministic hash for same input', () => {
    const k1 = computeDedupKey(['memory', 'federation'], ['NATS', 'JetStream']);
    const k2 = computeDedupKey(['memory', 'federation'], ['NATS', 'JetStream']);
    assert.equal(k1, k2);
  });

  it('is order-independent (canonical sort)', () => {
    const k1 = computeDedupKey(['federation', 'memory'], ['JetStream', 'NATS']);
    const k2 = computeDedupKey(['memory', 'federation'], ['NATS', 'JetStream']);
    assert.equal(k1, k2);
  });

  it('is case-insensitive', () => {
    const k1 = computeDedupKey(['Memory'], ['NATS']);
    const k2 = computeDedupKey(['memory'], ['nats']);
    assert.equal(k1, k2);
  });

  it('deduplicates overlapping themes and entities', () => {
    const k1 = computeDedupKey(['memory', 'memory'], ['nats']);
    const k2 = computeDedupKey(['memory'], ['nats']);
    assert.equal(k1, k2);
  });

  it('returns a 64-char hex SHA-256 hash', () => {
    const k = computeDedupKey(['x'], ['y']);
    assert.equal(k.length, 64);
    assert.match(k, /^[a-f0-9]{64}$/);
  });
});

// ── inferProblemClass ─────────────────────────────────────────────────────

describe('broadcast-emitter / inferProblemClass', () => {
  it('detects debug class', () => {
    assert.equal(inferProblemClass('There is a bug in the extraction'), 'debug');
    assert.equal(inferProblemClass('Fix the crash on startup'), 'debug');
  });

  it('detects implement class', () => {
    assert.equal(inferProblemClass('Implement the broadcaster module'), 'implement');
    assert.equal(inferProblemClass('Build a new feature'), 'implement');
  });

  it('returns undefined for unclassifiable text', () => {
    assert.equal(inferProblemClass('The weather is nice today'), undefined);
  });
});

// ── createBroadcaster / maybeBroadcast ────────────────────────────────────

describe('broadcast-emitter / maybeBroadcast', () => {
  it('suppresses when themes < 3', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED });
    const result = await b.maybeBroadcast('hello', { llmAnalysis: { themes: ['a', 'b'], entities: [] } });
    assert.equal(result.suppressed, true);
    assert.equal(result.reason, 'insufficient_themes');
    assert.equal(nc.published.length, 0);
    b.stop();
  });

  it('emits when themes >= 3 and schema validates', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED });
    const analysis = { llmAnalysis: { themes: ['memory', 'federation', 'broadcast'], entities: ['NATS'] } };
    const result = await b.maybeBroadcast('How do I fix this?', analysis);
    assert.equal(result.suppressed, false);
    assert.ok(result.eventId);
    assert.equal(nc.published.length, 1);
    assert.equal(nc.published[0].subject, 'context.broadcast.test-node');
    assert.equal(nc.published[0].data.data.intensity, 'actively_seeking');
    assert.equal(nc.published[0].data.data.themes.length, 3);
    assert.equal(nc.published[0].data.data.ttl_minutes, DEFAULT_TTL_MINUTES);
    b.stop();
  });

  it('rate limits within 60s window', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED, rateLimitMs: 100 });
    const analysis = { llmAnalysis: { themes: ['a', 'b', 'c'], entities: [] } };

    const r1 = await b.maybeBroadcast('How do I fix this?', analysis);
    assert.equal(r1.suppressed, false);

    const r2 = await b.maybeBroadcast('Another question?', analysis);
    assert.equal(r2.suppressed, true);
    assert.equal(r2.reason, 'rate_limited');

    b.stop();
  });

  it('deduplicates within dedup window', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED, rateLimitMs: 0, dedupWindowMs: 60_000 });
    const analysis = { llmAnalysis: { themes: ['memory', 'federation', 'broadcast'], entities: ['NATS'] } };

    const r1 = await b.maybeBroadcast('How do I fix this?', analysis);
    assert.equal(r1.suppressed, false);

    // Same themes+entities → dedup
    const r2 = await b.maybeBroadcast('Still stuck on this?', analysis);
    assert.equal(r2.suppressed, true);
    assert.equal(r2.reason, 'dedup');

    b.stop();
  });

  it('skips passive + unchanged theme set after 5 turns', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED, rateLimitMs: 0, dedupWindowMs: 0 });
    const analysis = { llmAnalysis: { themes: ['a', 'b', 'c'], entities: [] } };
    const passivePrompt = 'The system is running fine.';

    // Fill 5 turns with the same passive theme set
    for (let i = 0; i < 5; i++) {
      await b.maybeBroadcast(passivePrompt, analysis);
    }

    // 6th turn — passive + same themes should be skipped
    const r = await b.maybeBroadcast(passivePrompt, analysis);
    assert.equal(r.suppressed, true);
    assert.equal(r.reason, 'passive_unchanged');

    b.stop();
  });
});

describe('broadcast-emitter / maybeBroadcast carries only published names', () => {
  const KEY = 'sk-' + 'A'.repeat(40);
  const store = seedStore({
    themes: { memory: 0, federation: 0, debugging: 0, 'medical leave': 1, [`rotate ${KEY}`]: 0 },
    entities: { NATS: 0, acme: 1, ['ghp_' + 'b'.repeat(36)]: 0 },
  });

  it('drops private and never-published names and sends the published ones as stored', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: store });
    const result = await b.maybeBroadcast('How do I fix this?', { llmAnalysis: {
      themes: ['MEMORY', 'Federation', 'debugging', 'medical leave', 'brand-new project'],
      entities: ['nats', 'acme', 'Dr. Martin', KEY],
    } });
    assert.equal(result.suppressed, false, JSON.stringify(result));
    assert.deepEqual(nc.published[0].data.data.themes, ['memory', 'federation', 'debugging']);
    assert.deepEqual(nc.published[0].data.data.entities, ['NATS']);
    b.stop();
  });

  it('suppresses with reason private when fewer than 3 published themes survive', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: store });
    const result = await b.maybeBroadcast('How do I fix this?', { llmAnalysis: {
      themes: ['memory', 'medical leave', 'brand-new project'], entities: ['NATS'],
    } });
    assert.deepEqual(result, { suppressed: true, reason: 'private' });
    assert.equal(nc.published.length, 0);
    b.stop();
  });

  it('never publishes a key-shaped name, even one stored as published', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: store });
    const result = await b.maybeBroadcast('How do I fix this?', { llmAnalysis: {
      themes: ['memory', 'federation', 'debugging', `rotate ${KEY}`],
      entities: ['NATS', 'ghp_' + 'b'.repeat(36)],
    } });
    assert.equal(result.suppressed, false, JSON.stringify(result));
    const wire = JSON.stringify(nc.published[0].data);
    assert.ok(!wire.includes(KEY) && !wire.includes('ghp_'), wire);
    assert.deepEqual(nc.published[0].data.data.entities, ['NATS']);
    b.stop();
  });

  it('publishes nothing per prompt without an extraction store to check against', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node');
    const result = await b.maybeBroadcast('How do I fix this?', { llmAnalysis: {
      themes: ['memory', 'federation', 'debugging'], entities: ['NATS'],
    } });
    assert.deepEqual(result, { suppressed: true, reason: 'private' });
    assert.equal(nc.published.length, 0);
    b.stop();
  });
});

// ── createBroadcaster / broadcastFromConsolidation ─────────────────────────

describe('broadcast-emitter / broadcastFromConsolidation', () => {
  it('emits with interested intensity and no rate limit', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node');
    const result = await b.broadcastFromConsolidation(
      ['memory', 'federation', 'broadcast'],
      ['NATS', 'JetStream']
    );
    assert.equal(result.suppressed, false);
    assert.ok(result.eventId);
    assert.equal(nc.published[0].data.data.intensity, 'interested');
    b.stop();
  });

  it('suppresses when themes is empty', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node');
    const result = await b.broadcastFromConsolidation([], ['NATS']);
    assert.equal(result.suppressed, true);
    assert.equal(result.reason, 'no_themes');
    b.stop();
  });

  it('respects dedup window even on consolidation path', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { dedupWindowMs: 60_000 });
    const themes = ['memory', 'federation', 'broadcast'];
    const entities = ['NATS'];

    const r1 = await b.broadcastFromConsolidation(themes, entities);
    assert.equal(r1.suppressed, false);

    const r2 = await b.broadcastFromConsolidation(themes, entities);
    assert.equal(r2.suppressed, true);
    assert.equal(r2.reason, 'dedup');
    b.stop();
  });
});

// ── TTL env override ──────────────────────────────────────────────────────

describe('broadcast-emitter / TTL override', () => {
  it('uses opts.ttlMinutes', async () => {
    const nc = createMockNc();
    const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED, ttlMinutes: 120 });
    const analysis = { llmAnalysis: { themes: ['a', 'b', 'c'], entities: [] } };
    await b.maybeBroadcast('How do I fix this?', analysis);
    assert.equal(nc.published[0].data.data.ttl_minutes, 120);
    b.stop();
  });

  it('uses OPENCLAW_BROADCAST_TTL_MIN when opts.ttlMinutes is absent', async () => {
    const saved = process.env.OPENCLAW_BROADCAST_TTL_MIN;
    process.env.OPENCLAW_BROADCAST_TTL_MIN = '120';
    try {
      const nc = createMockNc();
      const b = createBroadcaster(nc, 'test-node', { extractionDb: PUBLISHED });
      const analysis = { llmAnalysis: { themes: ['a', 'b', 'c'], entities: [] } };
      await b.maybeBroadcast('How do I fix this?', analysis);
      assert.equal(nc.published[0].data.data.ttl_minutes, 120);
      b.stop();
    } finally {
      if (saved === undefined) delete process.env.OPENCLAW_BROADCAST_TTL_MIN;
      else process.env.OPENCLAW_BROADCAST_TTL_MIN = saved;
    }
  });
});

// ── Constants exported ────────────────────────────────────────────────────

describe('broadcast-emitter / constants', () => {
  it('exports expected defaults', () => {
    assert.equal(RATE_LIMIT_MS, 60_000);
    assert.equal(DEDUP_WINDOW_MS, 15 * 60 * 1000);
    assert.equal(DEFAULT_TTL_MINUTES, 60);
    assert.equal(MIN_THEMES_FOR_BROADCAST, 3);
  });
});
