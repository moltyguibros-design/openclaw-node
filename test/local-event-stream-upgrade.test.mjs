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
import { createLocalEventLog } from '../lib/local-event-log.mjs';

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
});
