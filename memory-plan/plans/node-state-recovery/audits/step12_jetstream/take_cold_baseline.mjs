import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api, capture, consumerState, jsonPrivate, openBus, privateDir } from './recovery.mjs';

const [server, expectedName, expectedId, expectedCluster, target, offlineList = ''] = process.argv.slice(2);
assert(server && expectedName && expectedId && expectedCluster && target && process.env.NATS_TOKEN,
  'usage: NATS_TOKEN=<local secret> node take_cold_baseline.mjs <loopback-server> <expected-name> <expected-server-id> <expected-cluster-or-> <new-private-dir> [known-offline-streams]');
assert(path.isAbsolute(target) && !fs.existsSync(target));
assert.match(expectedName, /^[A-Za-z0-9_-]+$/);
assert.match(expectedId, /^N[A-Z2-7]+$/);
assert.match(expectedCluster, /^[-A-Za-z0-9_]+$/);
process.umask(0o077);
privateDir(target);

const expectedOffline = new Set(offlineList.split(',').filter(Boolean));
const manifest = { startedAt: new Date().toISOString(), server, expectedServer: { name: expectedName, id: expectedId, cluster: expectedCluster }, streams: [] };
let nc;

async function names() {
  const result = [];
  let total;
  for (let offset = 0;;) {
    const page = await api(nc, '$JS.API.STREAM.NAMES', { offset });
    if (total === undefined) total = page.total;
    else assert.equal(page.total, total, 'stream inventory changed during pagination');
    result.push(...page.streams);
    offset += page.streams.length;
    if (offset >= page.total) break;
    assert(page.streams.length > 0);
  }
  assert.equal(new Set(result).size, result.length, 'duplicate stream in inventory');
  return result.sort();
}

async function consumers(stream) {
  const jsm = await nc.jetstreamManager();
  const result = [];
  for await (const info of jsm.consumers.list(stream)) result.push(consumerState(info));
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

try {
  nc = await openBus(server, process.env.NATS_TOKEN);
  manifest.serverInfo = {
    server_id: nc.info.server_id,
    server_name: nc.info.server_name,
    version: nc.info.version,
    cluster: nc.info.cluster,
  };
  assert.equal(manifest.serverInfo.server_name, expectedName, 'connected to unexpected NATS server name');
  assert.equal(manifest.serverInfo.server_id, expectedId, 'connected to unexpected NATS server ID');
  assert.equal(manifest.serverInfo.cluster || '-', expectedCluster, 'connected to unexpected NATS cluster');
  const originalNames = await names();
  for (const stream of originalNames) {
    assert(/^[A-Za-z0-9_-]+$/.test(stream));
    try {
      const snapshot = await capture(nc, stream);
      assert(!expectedOffline.has(stream), 'previously offline stream returned; re-inventory before proceeding');
      manifest.streams.push({ stream, snapshot });
    } catch (err) {
      if (expectedOffline.has(stream) && err.api?.code === 500 && err.api.description === 'stream is offline') {
        manifest.streams.push({ stream, offline: true });
        continue;
      }
      throw err;
    }
  }
  assert.deepEqual(await names(), originalNames, 'stream inventory changed during baseline');
  for (const stream of expectedOffline) assert(originalNames.includes(stream), 'expected offline assignment is absent');
  for (const row of manifest.streams) {
    if (row.offline) {
      try {
        await api(nc, `$JS.API.STREAM.INFO.${row.stream}`);
        assert.fail('offline assignment became available during baseline');
      } catch (err) {
        if (err.api?.code !== 500 || err.api.description !== 'stream is offline') throw err;
      }
      continue;
    }
    const final = await api(nc, `$JS.API.STREAM.INFO.${row.stream}`, { deleted_details: true });
    assert.deepEqual(final.config, row.snapshot.config, `stream config changed during baseline: ${row.stream}`);
    assert.deepEqual(final.state, row.snapshot.state, `stream state changed during baseline: ${row.stream}`);
    assert.deepEqual(await consumers(row.stream), row.snapshot.consumers, `consumer positions changed during baseline: ${row.stream}`);
  }
  manifest.finishedAt = new Date().toISOString();
  jsonPrivate(path.join(target, 'manifest.json'), manifest);
  console.log(JSON.stringify({ target, streams: manifest.streams.map(row => ({ stream: row.stream, offline: !!row.offline, last: row.snapshot?.content.last })) }));
} catch (err) {
  jsonPrivate(path.join(target, 'FAILED.json'), { at: new Date().toISOString(), error: err.message, partial: manifest });
  throw err;
} finally {
  await nc?.close();
}
