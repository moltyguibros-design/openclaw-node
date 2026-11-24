/**
 * nats-nkey-server.test.mjs — Phase 7 against a REAL nats-server.
 *
 * The rendered users block (bin/nats-auth-render.mjs) must let a lead in with
 * its identity nkey, refuse an unknown nkey, accept then (after re-render +
 * SIGHUP) refuse the legacy user, deny a worker's mesh.deploy.trigger publish
 * while its KV put/get/purge keep working, and natsConnectOpts must connect
 * end to end from a HOME that only carries identity.key + openclaw.env.
 *
 * Gated on the binary with the canonical skip marker
 * 'nats-server not found on PATH' (censused by mesh-skip-census).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { connect, nkeys, nkeyAuthenticator, StorageType } from 'nats';
import { natsServerBin, freePort, startNatsServer, writeServerConfig } from './helpers/nats-server.mjs';
import { renderAuthorization } from '../bin/nats-auth-render.mjs';
import { getOrCreateIdentity } from '../lib/node-identity.mjs';
import { buildMemoryEvent, createLocalEventLog, localEventStreamName, localEventSubjectPrefix } from '../lib/local-event-log.mjs';
import { ensureSharedStream, SHARED_STREAM_NAME, SHARED_SUBJECTS } from '../lib/shared-event-stream.mjs';
import { createMemoryWatcher } from '../lib/memory-watcher.mjs';

const require = createRequire(import.meta.url);
const { identityToNkey, nkeyAuthenticatorFor } = require('../lib/nats-nkey.js');

const SKIP = natsServerBin() ? false : 'nats-server not found on PATH';

describe('nkey auth on a real nats-server', { skip: SKIP }, () => {
  let dir, port, server, authPath, lead, worker;
  const TOKEN = 'legacy-shared-token';

  function render({ legacyUser = 'openclaw' } = {}) {
    const text = renderAuthorization({
      mode: 'nkey', token: TOKEN, legacyUser,
      self: { nodeId: 'lead-a', nkey: lead.publicNkey, role: 'lead' },
      peers: [{ nodeId: 'w1', nkey: worker.publicNkey, role: 'worker' }],
    });
    fs.writeFileSync(authPath, text);
  }
  const url = () => `nats://127.0.0.1:${port}`;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkey-server-'));
    getOrCreateIdentity(path.join(dir, 'lead'));
    getOrCreateIdentity(path.join(dir, 'worker'));
    lead = identityToNkey(path.join(dir, 'lead'));
    worker = identityToNkey(path.join(dir, 'worker'));
    port = await freePort();
    authPath = path.join(dir, 'nats-auth.conf');
    render();
    server = await startNatsServer(writeServerConfig(dir, port));
  });
  after(async () => {
    if (server) await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lead connects with its identity nkey on an auth-required bus and may publish deploy triggers', async () => {
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'lead')), timeout: 3000 });
    assert.equal(nc.info.auth_required, true);
    const errors = [];
    (async () => { for await (const s of nc.status()) if (s.type === 'error') errors.push(String(s.data)); })();
    nc.publish('mesh.deploy.trigger', Buffer.from('{}'));
    await nc.flush();
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(errors, []);
    await nc.close();
  });

  it('an nkey that is not in the users list is refused', async () => {
    const stranger = nkeys.createUser();
    await assert.rejects(
      connect({ servers: url(), authenticator: nkeyAuthenticator(stranger.getSeed()), timeout: 3000, maxReconnectAttempts: 0 }),
      /Authorization Violation/i,
    );
  });

  it('the worker cannot publish mesh.deploy.trigger but KV put/get/purge and mesh.tasks.* work', async () => {
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'worker')), timeout: 3000 });
    const errors = [];
    (async () => { for await (const s of nc.status()) if (s.type === 'error') errors.push(String(s.data)); })();
    nc.publish('mesh.deploy.trigger', Buffer.from('{}'));
    await nc.flush();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(errors.length, 1, `expected one permissions violation, got ${JSON.stringify(errors)}`);
    assert.match(errors[0], /PERMISSIONS_VIOLATION/);
    errors.length = 0;
    nc.publish('mesh.tasks.heartbeat', Buffer.from('{}'));
    nc.publish('mesh.tasks.merged', Buffer.from('{}'));
    const kv = await nc.jetstream().views.kv('NKEY_PROBE');
    await kv.put('k', 'v');
    assert.equal((await kv.get('k')).string(), 'v');
    await kv.purge('k');
    await nc.flush();
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(errors, [], 'the deny set must not touch KV or mesh.tasks');
    await nc.close();
  });

  // Denying only STREAM.DELETE protected no data: the same worker credential could purge a
  // whole bucket, shrink a stream to one message, or delete single messages.
  it('the worker cannot purge, shrink or delete messages from a stream; the lead still can', async () => {
    const leadNc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'lead')), timeout: 3000 });
    const leadKv = await leadNc.jetstream().views.kv('NKEY_GUARD', { history: 5 });
    await leadKv.put('a', '1');
    await leadKv.put('b', '2');
    const stream = 'KV_NKEY_GUARD';
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'worker')), timeout: 3000 });
    const jsm = await nc.jetstreamManager();
    const { config } = await jsm.streams.info(stream);
    await assert.rejects(jsm.streams.purge(stream), /permissions violation/i, 'STREAM.PURGE');
    await assert.rejects(jsm.streams.update(stream, { ...config, max_msgs: 1 }), /permissions violation/i, 'STREAM.UPDATE');
    await assert.rejects(jsm.streams.deleteMessage(stream, 1), /permissions violation/i, 'STREAM.MSG.DELETE');
    assert.equal((await jsm.streams.info(stream)).state.messages, 2, 'the stream kept every message');
    const kv = await nc.jetstream().views.kv('NKEY_GUARD');
    await kv.put('c', '3');
    assert.equal((await kv.get('a')).string(), '1');
    await kv.purge('b');
    await nc.close();
    const leadJsm = await leadNc.jetstreamManager();
    assert.equal((await leadJsm.streams.purge(stream)).success, true, 'the allow-all lead keeps its maintenance path (pruneTerminal purgeDeletes)');
    await leadNc.close();
  });

  // The worker deny on STREAM.UPDATE also refuses the retention update a
  // worker's memory daemon makes on its own pre-retention streams.
  it('a worker on pre-retention event streams keeps its local event log and watcher, logging the lead command', async () => {
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'worker')), timeout: 3000 });
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({ name: localEventStreamName('w1'), subjects: [`${localEventSubjectPrefix('w1')}.>`], storage: StorageType.File, num_replicas: 1 });
    await jsm.streams.add({ name: SHARED_STREAM_NAME, subjects: SHARED_SUBJECTS, storage: StorageType.File, num_replicas: 1 });
    const logs = [];
    const eventLog = await createLocalEventLog(nc, 'w1', { log: (m) => logs.push(m) });
    const watcher = await createMemoryWatcher(nc, 'w1', { outputPath: path.join(dir, 'watcher-w1.jsonl'), log: () => {} });
    try {
      await eventLog.publishLocal(buildMemoryEvent('memory.session_started', 'sess-w1', 'session',
        { session_id: 'sess-w1', start_time: new Date().toISOString(), session_type: 'daemon' }, 'w1'));
      assert.equal((await jsm.streams.info(localEventStreamName('w1'))).state.messages, 1);
      await ensureSharedStream(nc, { log: (m) => logs.push(m) });
    } finally {
      await watcher.stop();
    }
    assert.deepEqual(logs, [
      'local-events-w1 has no retention limit and this connection may not update streams; from a lead: nats stream edit local-events-w1 --max-age 720h --max-bytes 268435456 --discard old',
      'OPENCLAW_SHARED has no retention limit and this connection may not update streams; from a lead: nats stream edit OPENCLAW_SHARED --max-age 720h --max-bytes 268435456 --discard old',
    ]);
    assert.equal((await jsm.streams.info(localEventStreamName('w1'))).config.max_age, 0, 'the worker changed no stream');
    await nc.close();
  });

  it('the legacy user works until the render drops it and the server reloads', async () => {
    const legacy = await connect({ servers: url(), user: 'openclaw', pass: TOKEN, timeout: 3000 });
    assert.equal(legacy.info.auth_required, true);
    await legacy.close();
    render({ legacyUser: false });
    server.reload();
    await new Promise((r) => setTimeout(r, 500));
    await assert.rejects(
      connect({ servers: url(), user: 'openclaw', pass: TOKEN, timeout: 3000, maxReconnectAttempts: 0 }),
      /Authorization Violation/i,
    );
    // The nkey users survived the reload.
    const nc = await connect({ servers: url(), authenticator: nkeyAuthenticatorFor(path.join(dir, 'lead')), timeout: 3000 });
    await nc.close();
  });

  it('natsConnectOpts connects end to end from a HOME with identity.key + openclaw.env', async () => {
    const home = path.join(dir, 'home');
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'lead', 'identity.key'), path.join(home, '.openclaw', 'identity.key'));
    fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.env'), `OPENCLAW_NATS=${url()}\nOPENCLAW_NATS_TOKEN=${TOKEN}\nOPENCLAW_NATS_AUTH=nkey\n`);
    const saved = { HOME: process.env.HOME, ID: process.env.OPENCLAW_IDENTITY_DIR, N: process.env.OPENCLAW_NATS, T: process.env.OPENCLAW_NATS_TOKEN, A: process.env.OPENCLAW_NATS_AUTH };
    process.env.HOME = home;
    delete process.env.OPENCLAW_IDENTITY_DIR; delete process.env.OPENCLAW_NATS; delete process.env.OPENCLAW_NATS_TOKEN; delete process.env.OPENCLAW_NATS_AUTH;
    try {
      const modPath = require.resolve('../lib/nats-resolve.js');
      delete require.cache[modPath];
      const { natsConnectOpts, NATS_AUTH_MODE } = require('../lib/nats-resolve.js');
      assert.equal(NATS_AUTH_MODE, 'nkey');
      const opts = natsConnectOpts({ timeout: 3000 });
      assert.equal(opts.token, undefined);
      const nc = await connect(opts);
      assert.equal(nc.info.auth_required, true);
      await nc.close();
    } finally {
      process.env.HOME = saved.HOME;
      for (const [k, v] of [['OPENCLAW_IDENTITY_DIR', saved.ID], ['OPENCLAW_NATS', saved.N], ['OPENCLAW_NATS_TOKEN', saved.T], ['OPENCLAW_NATS_AUTH', saved.A]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      delete require.cache[require.resolve('../lib/nats-resolve.js')];
    }
  });
});
