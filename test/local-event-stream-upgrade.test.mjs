/**
 * local-event-stream-upgrade.test.mjs — the local event stream and its durable
 * consumers on a node upgraded from an older release, against a real
 * nats-server: the streams and consumers are pre-created with the config the
 * older code wrote, then the current code starts on top of them.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { freePort, natsServerBin, startNatsServer, writeServerConfig } from './helpers/nats-server.mjs';
import { createLocalEventLog, EVENT_STREAM_MAX_AGE_NS, EVENT_STREAM_MAX_BYTES, eventStreamRetention } from '../lib/local-event-log.mjs';
import { SHARED_CONSUMER_MAX_DELIVER, SHARED_STREAM_NAME, SHARED_SUBJECTS } from '../lib/shared-event-stream.mjs';
import { FEDERATION_NAK_DELAY_MS } from '../lib/federation-resilience.mjs';
import { createMemoryWatcher } from '../lib/memory-watcher.mjs';
import { createPromoter } from '../bin/memory-promoter.mjs';
import { createSubscriber } from '../bin/memory-subscriber.mjs';

const require = createRequire(import.meta.url);
const { connect, StorageType } = require('nats');
const skip = natsServerBin() ? false : 'nats-server not found on PATH';

describe('local event stream on an upgraded node (real nats-server)', { skip }, () => {
  let dir;
  let server;
  let nc;
  let jsm;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-stream-upgrade-'));
    const port = await freePort();
    server = await startNatsServer(writeServerConfig(dir, port, { auth: false }));
    nc = await connect({ servers: `127.0.0.1:${port}` });
    jsm = await nc.jetstreamManager();
  });

  afterEach(async () => {
    for await (const name of jsm.streams.names()) await jsm.streams.delete(name);
  });

  after(async () => {
    await nc?.close();
    await server?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The pre-per-node layout: one stream claimed every node's subjects.
  const addLegacyStream = (name) => jsm.streams.add({ name, subjects: ['local.>'], storage: StorageType.File, num_replicas: 1 });

  it('a legacy local.> stream under another node id is named with its narrowing command, and left untouched', async () => {
    await addLegacyStream('local-events-daedalus');
    await assert.rejects(createLocalEventLog(nc, 'moltymacs-virtual-machine'), (err) => {
      assert.match(err.message, /cannot create local-events-moltymacs-virtual-machine/);
      assert.ok(err.message.includes("nats stream edit local-events-daedalus --subjects 'local.daedalus.>'"), err.message);
      return true;
    });
    assert.deepEqual((await jsm.streams.info('local-events-daedalus')).config.subjects, ['local.>']);
  });

  it('a stream created without retention gets 30 days / 256 MiB in place, keeping its messages', async () => {
    await jsm.streams.add({ name: 'local-events-daedalus', subjects: ['local.daedalus.>'], storage: StorageType.File, num_replicas: 1 });
    const js = nc.jetstream();
    await js.publish('local.daedalus.session.events.s1.memory.session_started', new TextEncoder().encode('{}'));
    await js.publish('local.daedalus.session.events.s2.memory.session_started', new TextEncoder().encode('{}'));
    const logs = [];
    await createLocalEventLog(nc, 'daedalus', { log: (m) => logs.push(m) });
    const { config, state } = await jsm.streams.info('local-events-daedalus');
    assert.equal(config.max_age, EVENT_STREAM_MAX_AGE_NS);
    assert.equal(config.max_bytes, EVENT_STREAM_MAX_BYTES);
    assert.equal(config.discard, 'old');
    assert.equal(state.messages, 2);
    assert.match(logs.join('\n'), /local-events-daedalus: retention set/);
  });

  const LOCAL = 'local-events-daedalus';
  const addLocalStream = () => jsm.streams.add({ name: LOCAL, subjects: ['local.daedalus.>'], storage: StorageType.File, num_replicas: 1, ...eventStreamRetention() });
  const publishEvent = (id) => nc.jetstream().publish(`local.daedalus.memory.events.${id}.memory.ingested`,
    new TextEncoder().encode(JSON.stringify({ event_id: id, event_type: 'memory.ingested', timestamp: new Date().toISOString(), data: { messages_added: 1 } })));
  const watcherIds = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).event_id) : []);
  async function until(check, timeoutMs, what) {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  it('durables an older release created AckNone are recreated explicit, resuming after their last delivery', async () => {
    await addLocalStream();
    await jsm.streams.add({ name: SHARED_STREAM_NAME, subjects: SHARED_SUBJECTS, storage: StorageType.File, num_replicas: 1, ...eventStreamRetention() });
    // The shapes the older code created: no ack_policy, so the server made them AckNone.
    await jsm.consumers.add(LOCAL, { durable_name: 'watcher-daedalus', deliver_policy: 'all' });
    await jsm.consumers.add(LOCAL, { durable_name: 'promoter-daedalus', deliver_policy: 'new' });
    await jsm.consumers.add(SHARED_STREAM_NAME, { durable_name: 'subscriber-daedalus', deliver_policy: 'new' });
    await publishEvent('e1');
    await publishEvent('e2');
    const old = await nc.jetstream().consumers.get(LOCAL, 'watcher-daedalus');
    for await (const m of await old.fetch({ max_messages: 2, expires: 1000 })) void m;
    await publishEvent('e3');

    const logs = [];
    const outputPath = path.join(dir, 'watcher.jsonl');
    const watcher = await createMemoryWatcher(nc, 'daedalus', { outputPath, log: (m) => logs.push(m) });
    const promoter = await createPromoter(nc, 'daedalus', { policy: { automatic: [], explicit: [], threshold: {} }, log: (m) => logs.push(m) });
    const subscriber = await createSubscriber(nc, 'daedalus', { onIngest: async (event) => { logs.push(`ingested ${event.event_id}`); }, onError: () => {}, log: (m) => logs.push(m) });
    try {
      for (const [stream, name] of [[LOCAL, 'watcher-daedalus'], [LOCAL, 'promoter-daedalus'], [SHARED_STREAM_NAME, 'subscriber-daedalus']]) {
        const { config } = await jsm.consumers.info(stream, name);
        assert.equal(config.ack_policy, 'explicit', name);
        assert.equal(config.max_deliver, SHARED_CONSUMER_MAX_DELIVER, name);
        assert.ok(logs.some((l) => l.includes(`${stream}/${name}: recreated with explicit acks`)), `${name}: ${logs.join(' | ')}`);
      }
      await until(() => watcherIds(outputPath).length > 0, 5000, 'the watcher record');
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(watcherIds(outputPath), ['e3'], 'the recreated watcher re-read events the old one had delivered');
    } finally {
      await watcher.stop();
      await promoter.stop();
      await subscriber.stop();
    }
  });

  it('on a legacy local.> stream, an unfiltered durable is narrowed to this node\'s events, deleting nothing', async () => {
    await addLegacyStream(LOCAL);
    await jsm.consumers.add(LOCAL, { durable_name: 'watcher-daedalus', deliver_policy: 'all', ack_policy: 'explicit' });
    await nc.jetstream().publish('local.othernode.memory.events.x1.memory.ingested',
      new TextEncoder().encode(JSON.stringify({ event_id: 'x1', event_type: 'memory.ingested', data: {} })));
    await publishEvent('e2');
    const logs = [];
    const outputPath = path.join(dir, 'watcher-filter.jsonl');
    const watcher = await createMemoryWatcher(nc, 'daedalus', { outputPath, log: (m) => logs.push(m) });
    try {
      assert.equal((await jsm.consumers.info(LOCAL, 'watcher-daedalus')).config.filter_subject, 'local.daedalus.>');
      assert.ok(logs.some((l) => l.includes(`${LOCAL}/watcher-daedalus: filter_subject (none) -> local.daedalus.>`)), logs.join(' | '));
      await until(() => watcherIds(outputPath).length > 0, 5000, 'the watcher record');
      await new Promise((r) => setTimeout(r, 300));
      assert.deepEqual(watcherIds(outputPath), ['e2']);
      assert.equal((await jsm.streams.info(LOCAL)).state.messages, 2);
    } finally {
      await watcher.stop();
    }
  });

  it('a watcher record that fails to write is redelivered after the nak delay', async () => {
    await addLocalStream();
    const logs = [];
    const outputDir = path.join(dir, 'not-yet');
    const outputPath = path.join(outputDir, 'watcher.jsonl');
    const watcher = await createMemoryWatcher(nc, 'daedalus', { outputPath, log: (m) => logs.push(m) });
    try {
      await publishEvent('e1');
      await until(() => logs.some((l) => l.startsWith('watcher: failed to process message')), 5000, 'the failed write');
      fs.mkdirSync(outputDir);
      await until(() => watcherIds(outputPath).length > 0, FEDERATION_NAK_DELAY_MS + 4000, 'the redelivery');
      assert.deepEqual(watcherIds(outputPath), ['e1']);
    } finally {
      await watcher.stop();
    }
  });
});
