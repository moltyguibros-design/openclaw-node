/**
 * mesh-kv.js — open (or create) a mesh KV bucket at the council's replica count.
 *
 * js.views.kv() applies `replicas` only when it creates the bucket; an existing
 * bucket keeps the count it was created with. So every opener of a mesh bucket
 * passes OPENCLAW_KV_REPLICAS, whichever process happens to create it first.
 *
 * Ordering: on a council the first creator can start before the other machines'
 * servers have joined, and JetStream then refuses to place R copies. openMeshKv
 * waits for the cluster to form instead of falling back to R=1 (a silent R=1
 * bucket is exactly the single point of failure the setting exists to remove),
 * and gives up after waitMs so the service manager restarts the daemon.
 */
const { resolveEnvKey } = require('./nats-resolve');
const { resolveKvReplicas } = require('./nats-cluster-config');

// JetStream answers while the cluster cannot place R copies yet: a peer still
// joining, or no meta leader elected.
const CLUSTER_FORMING = /insufficient resources|no suitable peers|temporarily unavailable|cluster not (ready|available)|no meta leader/i;

/** OPENCLAW_KV_REPLICAS from the environment or ~/.openclaw/openclaw.env (services get it from the file). */
function meshKvReplicas() {
  return resolveKvReplicas({ OPENCLAW_KV_REPLICAS: resolveEnvKey('OPENCLAW_KV_REPLICAS') ?? undefined });
}

async function openMeshKv(js, bucket, opts = {}, {
  replicas = meshKvReplicas(),
  waitMs = 10 * 60_000,
  retryMs = 5_000,
  log = console.warn,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
} = {}) {
  const deadline = Date.now() + waitMs;
  let lastLog = 0;
  for (;;) {
    try {
      return await js.views.kv(bucket, { ...opts, replicas });
    } catch (err) {
      if (replicas === 1 || !CLUSTER_FORMING.test(err.message)) throw err;
      if (Date.now() >= deadline) {
        throw new Error(`KV ${bucket}: the cluster could not place ${replicas} replicas within ${Math.round(waitMs / 1000)}s (${err.message})`);
      }
      if (Date.now() - lastLog >= 60_000) {
        log(`[mesh-kv] ${bucket}: waiting for the cluster to place ${replicas} replicas (${err.message})`);
        lastLog = Date.now();
      }
      await sleep(retryMs);
    }
  }
}

module.exports = { openMeshKv, meshKvReplicas };
