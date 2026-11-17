/**
 * shared-consumer.test.mjs — offerer/acceptor start() create their durable
 * consumer on OPENCLAW_SHARED. They used to call js.consumers.get() (a lookup:
 * it rejects for a consumer nobody created, and nothing did) and fall back to a
 * js.subscribe() whose options object always threw, so every start logged
 * "degraded mode" / "failed to subscribe" and no broadcast or offer was read.
 *
 * The fake models nats 2.29's semantics for the calls involved: consumers.get
 * and consumers.info reject for a missing consumer, consumers.add validates the
 * durable name, and js.subscribe with a plain options object throws.
 * test/federation-2node.test.mjs runs the same start() against a real nats-server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createOfferer } from '../lib/broadcast-offerer.mjs';
import { createAcceptor } from '../lib/broadcast-acceptor.mjs';
import { SHARED_STREAM_NAME, SHARED_CONSUMER_MAX_DELIVER } from '../lib/shared-event-stream.mjs';

function fakeNats() {
  const consumers = new Map();
  const queued = [];
  const encode = obj => new TextEncoder().encode(JSON.stringify(obj));
  const missing = name => Object.assign(new Error(`consumer not found: ${name}`), { code: '404' });
  const iterate = filter => ({
    closed: false,
    close() { this.closed = true; },
    async *[Symbol.asyncIterator]() {
      while (!this.closed) {
        const i = queued.findIndex(m => m.subject.startsWith(filter.replace('>', '')));
        if (i >= 0) yield queued.splice(i, 1)[0];
        else await new Promise(r => setTimeout(r, 5));
      }
    },
  });
  return {
    consumers,
    deliver(subject, event) {
      const msg = { subject, data: encode(event), acked: false, ack() { this.acked = true; }, nak() {} };
      queued.push(msg);
      return msg;
    },
    async jetstreamManager() {
      return {
        consumers: {
          async info(stream, name) {
            if (!consumers.has(`${stream}/${name}`)) throw missing(name);
            return { name, config: consumers.get(`${stream}/${name}`) };
          },
          async add(stream, cfg) {
            if (/[.*>\s]/.test(cfg.durable_name)) throw new Error(`invalid durable name ${cfg.durable_name}`);
            consumers.set(`${stream}/${cfg.durable_name}`, cfg);
            return { name: cfg.durable_name, config: cfg };
          },
        },
      };
    },
    jetstream() {
      return {
        async publish() { return { seq: 1, stream: SHARED_STREAM_NAME }; },
        consumers: {
          async get(stream, name) {
            const cfg = consumers.get(`${stream}/${name}`);
            if (!cfg) throw missing(name);
            return { consume: async () => iterate(cfg.filter_subject) };
          },
        },
        subscribe() { throw new TypeError("Cannot read properties of undefined (reading 'ack_policy')"); },
      };
    },
  };
}

const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise(r => setTimeout(r, 5));
  }
};

describe('offerer/acceptor start() on the shared stream', () => {
  it('the offerer creates its durable consumer and reads context.broadcast.>', async () => {
    const nc = fakeNats();
    const logs = [];
    const offerer = createOfferer(nc, 'host.local', { log: m => logs.push(m) });
    await offerer.start();
    assert.ok(!logs.some(l => l.includes('degraded')), logs.join('\n'));

    const cfg = nc.consumers.get(`${SHARED_STREAM_NAME}/offerer-host_local`);
    assert.ok(cfg, `consumers: ${[...nc.consumers.keys()]}`);
    assert.equal(cfg.filter_subject, 'context.broadcast.>');
    assert.equal(cfg.ack_policy, 'explicit');
    assert.equal(cfg.deliver_policy, 'new');
    assert.equal(cfg.max_deliver, SHARED_CONSUMER_MAX_DELIVER);

    const msg = nc.deliver('context.broadcast.peer', { event_type: 'context.broadcast', node_id: 'peer' });
    await until(() => offerer.stats.broadcastsReceived === 1 && msg.acked);
    await offerer.stop();
  });

  it('the acceptor creates its durable consumer and reads context.offer.>', async () => {
    const nc = fakeNats();
    const logs = [];
    const acceptor = createAcceptor(nc, 'host.local', { log: m => logs.push(m) });
    await acceptor.start();
    assert.ok(!logs.some(l => l.includes('failed to subscribe')), logs.join('\n'));

    const cfg = nc.consumers.get(`${SHARED_STREAM_NAME}/acceptor-host_local`);
    assert.ok(cfg, `consumers: ${[...nc.consumers.keys()]}`);
    assert.equal(cfg.filter_subject, 'context.offer.>');

    nc.deliver('context.offer.peer', { event_type: 'context.offer', node_id: 'peer' });
    await until(() => acceptor.stats.offersReceived === 1);
    await acceptor.stop();
  });

  it('a restart reuses the existing consumer', async () => {
    const nc = fakeNats();
    const first = createOfferer(nc, 'n1', { log: () => {} });
    await first.start();
    await first.stop();
    const second = createOfferer(nc, 'n1', { log: () => {} });
    await second.start();
    assert.equal(nc.consumers.size, 1);
    await second.stop();
  });
});
