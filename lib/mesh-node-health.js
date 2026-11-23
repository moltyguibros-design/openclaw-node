/**
 * mesh-node-health.js — `mesh status` / `mesh health` read the MESH_NODE_HEALTH
 * KV that every node's mesh-health-publisher writes (every 15s, 120s TTL), the
 * same source fleet-deploy, node-init and Mission Control read.
 */

'use strict';

const { StringCodec } = require('nats');

const HEALTH_BUCKET = 'MESH_NODE_HEALTH';
// Three missed publishes: the publisher is wedged even though the KV TTL has not expired yet.
const STALE_AFTER_MS = 60_000;
const DISK_WARN_PERCENT = 90;

const sc = StringCodec();

async function readNodeHealth(nc) {
  const kv = await nc.jetstream().views.kv(HEALTH_BUCKET, { bindOnly: true });
  const entries = [];
  for await (const key of await kv.keys()) {
    const entry = await kv.get(key);
    if (!entry || !entry.value || entry.value.length === 0) continue;
    try {
      const health = JSON.parse(sc.decode(entry.value));
      entries.push({ ...health, nodeId: health.nodeId || key });
    } catch (err) { console.warn(`[mesh] parse ${HEALTH_BUCKET}/${key}: ${err.message}`); }
  }
  return entries.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

/**
 * ok / degraded / down for one node. `not-found` services are not installed on
 * that node (the macOS publisher lists every service whatever the role), so
 * they do not count, and neither does a stopped on-demand service (manifest
 * autostart false: the worker agent, the gateway).
 */
function summarizeNode(nodeId, health, now = Date.now()) {
  if (!health) return { nodeId, overall: 'down', problems: ['no MESH_NODE_HEALTH entry (publisher not running, or expired)'] };
  const ageMs = health.reportedAt ? now - new Date(health.reportedAt).getTime() : Infinity;
  const stale = !(ageMs <= STALE_AFTER_MS);
  const problems = [];
  if (stale) problems.push(`last report ${Number.isFinite(ageMs) ? Math.round(ageMs / 1000) + 's ago' : 'time unknown'}`);
  for (const s of health.services || []) {
    if (s.status === 'active' || s.status === 'not-found') continue;
    if (s.status === 'down' && s.autostart === false) continue;
    problems.push(`${s.name}: ${s.status}`);
  }
  if (health.diskPercent >= DISK_WARN_PERCENT) problems.push(`disk ${health.diskPercent}% full`);
  return {
    nodeId,
    overall: stale ? 'down' : problems.length > 0 ? 'degraded' : 'ok',
    problems,
    role: health.role || null,
    platform: health.platform || null,
    deployVersion: health.deployVersion || null,
    reportedAt: health.reportedAt || null,
    ageSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    services: health.services || [],
    diskPercent: health.diskPercent ?? null,
    mem: health.mem || null,
    uptimeSeconds: health.uptimeSeconds ?? null,
  };
}

/** The nodes to report: this one only, or every node in the KV (this one included even when absent). */
function summarizeFleet(entries, { localId, all, now = Date.now() }) {
  const byId = new Map(entries.map(e => [e.nodeId, e]));
  const ids = all ? [...new Set([localId, ...byId.keys()])] : [localId];
  const nodes = ids.map(id => summarizeNode(id, byId.get(id), now));
  const rank = { ok: 0, degraded: 1, down: 2 };
  const overall = nodes.reduce((worst, n) => (rank[n.overall] > rank[worst] ? n.overall : worst), 'ok');
  return { overall, nodes };
}

module.exports = { HEALTH_BUCKET, STALE_AFTER_MS, readNodeHealth, summarizeNode, summarizeFleet };
