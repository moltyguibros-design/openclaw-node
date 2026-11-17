/**
 * deploy-latest-marker.js — the signed `latest` deploy marker offline nodes
 * catch up from.
 *
 * MESH_DEPLOY_RESULTS has a 7-day max_age, and JetStream expires a key's last
 * value with it, so a marker kept there vanished a week after the last deploy
 * and a node offline longer stayed on old code without a word. The marker now
 * lives in MESH_DEPLOY_LATEST, which has no TTL. Writers still put it in
 * MESH_DEPLOY_RESULTS for listeners that predate the bucket, and readers fall
 * back to it for markers written by leads that predate it.
 */
const { StringCodec } = require('nats');
const { openMeshKv } = require('./mesh-kv');

const sc = StringCodec();

const LATEST_BUCKET = 'MESH_DEPLOY_LATEST';
const RESULTS_BUCKET = 'MESH_DEPLOY_RESULTS';
const LATEST_KEY = 'latest';
const RESULTS_KV_OPTS = { history: 5, ttl: 7 * 24 * 60 * 60 * 1000 };
const LATEST_KV_OPTS = { history: 1 };

function openLatestKv(js, waitOpts) {
  return openMeshKv(js, LATEST_BUCKET, LATEST_KV_OPTS, waitOpts);
}

async function writeLatestMarker({ latestKv, resultsKv }, signedTrigger) {
  const data = sc.encode(JSON.stringify(signedTrigger));
  await latestKv.put(LATEST_KEY, data);
  if (resultsKv) await resultsKv.put(LATEST_KEY, data);
}

async function readOne(kv) {
  if (!kv) return null;
  const entry = await kv.get(LATEST_KEY);
  if (!entry || !entry.value || entry.value.length === 0) return null;
  return JSON.parse(sc.decode(entry.value));
}

/**
 * The newer of the two copies by trigger timestamp: during the mixed-version
 * window an old lead updates only the legacy copy, so the TTL-less bucket can
 * hold an older deploy than MESH_DEPLOY_RESULTS.
 */
async function readLatestMarker({ latestKv, resultsKv }) {
  const current = await readOne(latestKv);
  const legacy = await readOne(resultsKv);
  if (current && legacy) {
    const t = m => Date.parse(m.timestamp) || 0;
    return t(legacy) > t(current)
      ? { marker: legacy, source: RESULTS_BUCKET }
      : { marker: current, source: LATEST_BUCKET };
  }
  if (current) return { marker: current, source: LATEST_BUCKET };
  if (legacy) return { marker: legacy, source: RESULTS_BUCKET };
  return null;
}

module.exports = {
  LATEST_BUCKET, RESULTS_BUCKET, LATEST_KEY, RESULTS_KV_OPTS, LATEST_KV_OPTS,
  openLatestKv, writeLatestMarker, readLatestMarker,
};
