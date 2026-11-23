/**
 * federation-startup.test.mjs — the broadcast trio is driven, not just built.
 *
 * startFederation used to construct broadcaster/offerer/acceptor and hand
 * them nothing else to do: no peer tracker, no llm-client, and no caller of
 * maybeBroadcast / broadcastFromConsolidation / getTopOffer / checkAcceptance.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'fed-startup-'));
process.env.HOME = TMP;
process.env.OPENCLAW_HOME = join(TMP, '.openclaw');
process.env.MEMORY_INJECT_PORT = '0';
process.env.INJECTION_LOG_DISABLED = '1';
after(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const { startFederation, publishedContext } = await import('../lib/federation-startup.mjs');
const { createExtractionStore } = await import('../lib/extraction-store.mjs');
const { createConsolidationScheduler } = await import('../bin/consolidation-scheduler.mjs');
const { startInjectionServer } = await import('../lib/memory-inject-server.mjs');
const { getOrCreateIdentity, signEvent } = await import('../lib/node-identity.mjs');
const { buildOfferFromResults } = await import('../lib/broadcast-offerer.mjs');
const { DEAD_PEER_TIMEOUT_MS } = await import('../lib/federation-resilience.mjs');

function mockNc(published) {
  return {
    jetstream() {
      return {
        async publish(subject, data) {
          published.push({ subject, event: JSON.parse(new TextDecoder().decode(data)) });
        },
        consumers: { get() { throw new Error('no consumer'); } },
        async subscribe() { return { async *[Symbol.asyncIterator]() {}, unsubscribe() {} }; },
      };
    },
  };
}

function seedStore() {
  const { db } = createExtractionStore({ dbPath: ':memory:' });
  const now = new Date().toISOString();
  const theme = db.prepare('INSERT INTO themes (label, first_seen, last_seen, private) VALUES (?, ?, ?, ?)');
  theme.run('shared-theme', now, now, 0);
  theme.run('secret-theme', now, now, 1);
  const entity = db.prepare('INSERT INTO entities (name, type, first_seen, last_seen, private) VALUES (?, ?, ?, ?, ?)');
  entity.run('PublicThing', 'tech', now, now, 0);
  entity.run('PrivateThing', 'person', now, now, 1);
  return db;
}

test('publishedContext carries only published themes and entities', () => {
  const db = seedStore();
  assert.deepEqual(publishedContext(db), { themes: ['shared-theme'], entities: ['PublicThing'] });
  db.close();
});

test('startFederation shares a peer tracker and broadcasts published context after a consolidation cycle', async () => {
  const published = [];
  const extractionDb = seedStore();
  const fed = await startFederation(mockNc(published), 'node-a', {
    extractionDb,
    knowledgeDb: extractionDb,
    identityDir: join(TMP, 'identity'),
    llmClient: { generateAnalysis: async () => ({ mode: 'fallback' }) },
  });
  try {
    const scheduler = createConsolidationScheduler({
      getStateFn: () => ({ current_job: null, queue_depth: 0, history: { extraction: { count: 0 } }, recent_fallbacks: [] }),
      runCycle: async () => ({}),
      log: () => {},
      onCycleComplete: () => fed.broadcastConsolidation(),
    });
    const r = await scheduler.runOnce();
    await scheduler.stop();
    assert.equal(r.ok, true, JSON.stringify(r));
    const broadcasts = published.filter((p) => p.subject === 'context.broadcast.node-a');
    assert.equal(broadcasts.length, 1, 'one consolidation broadcast');
    assert.deepEqual(broadcasts[0].event.data.themes, ['shared-theme']);
    assert.deepEqual(broadcasts[0].event.data.entities, ['PublicThing']);
    assert.ok(broadcasts[0].event.signature, 'signed');

    // A trusted peer answers that broadcast. The acceptor queues the offer and
    // records the peer in the shared tracker; once the peer goes silent past
    // the dead-peer timeout its offer is no longer injected.
    const peer = getOrCreateIdentity(join(TMP, 'peer-identity'));
    fed.registry.trust('node-b', peer.publicKeyBase64, 'test');
    const offer = signEvent(buildOfferFromResults(broadcasts[0].event.event_id, 'node-b',
      [{ session_id: 's1', chunk_id: 1, score: 0.9 }], ['relevant']), peer.privateKey);
    assert.equal((await fed.acceptor._processOffer(offer)).action, 'queued');
    assert.match(fed.acceptor.getTopOffer(), /peer-memory/);
    const realNow = Date.now;
    Date.now = () => realNow() + DEAD_PEER_TIMEOUT_MS + 1000;
    try {
      assert.equal(fed.acceptor.getTopOffer(), '', 'a dead peer\'s offer is filtered');
      assert.equal(fed.acceptor.stats.deadPeerFiltered, 1);
    } finally {
      Date.now = realNow;
    }
  } finally {
    await fed.stop();
    extractionDb.close();
  }
});

test('startFederation hands the broadcaster its extraction store, so a per-prompt broadcast keeps private names home', async () => {
  const published = [];
  const extractionDb = seedStore();
  const now = new Date().toISOString();
  for (const label of ['nats', 'jetstream']) {
    extractionDb.prepare('INSERT INTO themes (label, first_seen, last_seen, private) VALUES (?, ?, ?, 0)').run(label, now, now);
  }
  const fed = await startFederation(mockNc(published), 'node-a', {
    extractionDb,
    knowledgeDb: extractionDb,
    identityDir: join(TMP, 'identity'),
  });
  try {
    const r = await fed.broadcaster.maybeBroadcast('how do I fix the nats consumer?', { llmAnalysis: {
      themes: ['shared-theme', 'nats', 'jetstream', 'secret-theme'],
      entities: ['PublicThing', 'PrivateThing', 'sk-' + 'Z'.repeat(40)],
    } });
    assert.equal(r.suppressed, false, JSON.stringify(r));
    const [b] = published.filter((p) => p.subject === 'context.broadcast.node-a');
    assert.deepEqual(b.event.data.themes, ['shared-theme', 'nats', 'jetstream']);
    assert.deepEqual(b.event.data.entities, ['PublicThing']);
  } finally {
    await fed.stop();
    extractionDb.close();
  }
});

test('the inject server checks acceptance, broadcasts the prompt and appends the top peer offer', async () => {
  const calls = [];
  const peerBlock = '[peer-memory: from node-b]\nsomething useful\n[end peer-memory]';
  const fed = {
    broadcaster: { maybeBroadcast: async (prompt, analysis) => { calls.push(['broadcast', prompt, analysis]); } },
    acceptor: {
      checkAcceptance: async (prompt) => { calls.push(['accept', prompt]); },
      getTopOffer: () => peerBlock,
    },
  };
  const handle = await startInjectionServer({ getFederation: () => fed }, { port: 0, host: '127.0.0.1', log: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/memory/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ prompt: 'how do I fix the nats consumer?' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.block.endsWith(peerBlock), body.block);
    assert.deepEqual(calls.map((c) => c.slice(0, 2)), [
      ['accept', 'how do I fix the nats consumer?'],
      ['broadcast', 'how do I fix the nats consumer?'],
    ]);
    assert.ok('llmAnalysis' in calls[1][2], 'maybeBroadcast gets the analysis under the key it reads');
  } finally {
    await handle.close();
  }
});
