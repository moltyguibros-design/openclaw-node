#!/usr/bin/env node

/**
 * mesh-health-publisher.js
 *
 * Runs on each mesh node. Every PUBLISH_INTERVAL_MS, gathers local system
 * health and writes it to the MESH_NODE_HEALTH KV bucket in NATS JetStream.
 *
 * MC reads from this bucket — no synchronous request-reply, no timeout races.
 *
 * Usage:
 *   OPENCLAW_NODE_ID=moltymac NATS_URL=nats://calos:4222 node mesh-health-publisher.js
 *
 * As a launchd/systemd service:
 *   ai.openclaw.mesh-health-publisher
 */

const { connect, StringCodec } = require("nats");
const { execFile } = require("child_process");
const { promisify } = require("util");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-health-publisher');

// ── Config ───────────────────────────────────────────────────────────────

const NODE_ID = require('../lib/node-id').resolveNodeId();
const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const { openMeshKv } = require('../lib/mesh-kv');
const PUBLISH_INTERVAL_MS = 15_000; // 15 seconds
const HEALTH_BUCKET = "MESH_NODE_HEALTH";
const KV_TTL_MS = 120_000; // entries expire after 2 minutes if node dies

const REPO_DIR = process.env.OPENCLAW_REPO_DIR ||
  path.join(os.homedir(), 'openclaw');

const execFileAsync = promisify(execFile);
const sc = StringCodec();
const IS_MAC = os.platform() === "darwin";

const { ROLE_COMPONENTS, requireNodeRole } = require('../lib/mesh-roles');
const { launchdServiceStatus, systemdServiceStatus } = require('../lib/service-status');
// Whether a service is meant to run on its own (the installer starts only the
// autostart ones), so a stopped on-demand one is not reported as an outage.
const AUTOSTART = new Map(require('../services/service-manifest.json')
  .map((s) => [s.name.replace(/^openclaw-/, ''), s.autostart]));

// ── Circuit Breaker State ───────────────────────────────────────────────
let consecutiveFailures = 0;
let skipTicksRemaining = 0;
let lastErrorMsg = '';
let lastErrorRepeatCount = 0;

// ── Health Gathering ─────────────────────────────────────────────────────
// Probes are async: a synchronous shell (tailscale ping waits up to 3s per
// peer) stalls the event loop, and with it the NATS connection.

async function runProbe(file, args, opts = {}) {
  try {
    const { stdout } = await execFileAsync(file, args, { encoding: "utf-8", timeout: 5000, ...opts });
    return stdout.trim();
  } catch (err) {
    console.warn(`[health-publisher] ${file} ${args.join(" ").slice(0, 40)}: ${err.message}`);
    return null;
  }
}

async function getDiskPercent(run = runProbe) {
  const raw = await run("df", ["-h", "/"]);
  if (!raw) return 0;
  const match = raw.split("\n").pop().match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : 0;
}

function getMemory() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    total: Math.round(total / 1024 / 1024),
    free: Math.round(free / 1024 / 1024),
  };
}

const MESH_SERVICES = [
  "mesh-task-daemon",
  "mesh-bridge",
  "mesh-agent",
  "gateway",
  "memory-daemon",
  "mission-control",
  "mesh-health-publisher",
  "mesh-deploy-listener",
];

async function getServices(run = runProbe, isMac = IS_MAC) {
  if (isMac) {
    return Promise.all(MESH_SERVICES.map(async (name) => ({
      name,
      autostart: AUTOSTART.get(name),
      ...launchdServiceStatus(await run("launchctl", ["list", `ai.openclaw.${name}`])),
    })));
  }
  // The installer renders every unit as a systemd --user unit.
  const props = "--property=LoadState,ActiveState,MainPID";
  return Promise.all(MESH_SERVICES.map(async (name) => ({
    name,
    autostart: AUTOSTART.get(name),
    ...systemdServiceStatus(await run("systemctl", ["--user", "show", `openclaw-${name}`, props])),
  })));
}

let warnedNoRole = false;

/**
 * The role this node is configured as: OPENCLAW_NODE_ROLE, else openclaw.env, via
 * the same requireNodeRole mesh-deploy uses. Never a guess from the platform: an
 * unset or invalid role is null (published as "unknown"), logged once.
 */
function resolveConfiguredRole(env = process.env, home = os.homedir()) {
  try {
    return requireNodeRole({ env, envFile: path.join(home, ".openclaw", "openclaw.env") });
  } catch (err) {
    if (!warnedNoRole) {
      warnedNoRole = true;
      console.warn(`[health-publisher] publishing role "unknown": ${err.message}`);
    }
    return null;
  }
}

/**
 * The published role is the configured one (what mesh-deploy installs and MC
 * assumes); runningRole is whether the task daemon is actually up. A mismatch is
 * flagged rather than resolved, since either side can be the wrong one.
 */
function reconcileRole(configuredRole, services) {
  const runningRole = services.some((s) => s.name === "mesh-task-daemon" && s.status === "active")
    ? "lead" : "worker";
  const role = configuredRole || "unknown";
  return { role, configuredRole, runningRole, roleMismatch: !!configuredRole && role !== runningRole };
}

async function getAgentStatus(home = os.homedir()) {
  const status = { status: "idle", currentTask: null, llm: null, model: null };
  try {
    const raw = await fs.promises.readFile(path.join(home, ".openclaw", ".tmp", "agent-state.json"), "utf8");
    const state = JSON.parse(raw);
    status.status = state.status || "idle";
    status.currentTask = state.taskId || null;
    status.llm = state.llm || null;
    status.model = state.model || null;
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[health-publisher] read agent state: ${err.message}`);
  }
  return status;
}

async function getDeployVersion(run = runProbe) {
  return (await run("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO_DIR })) || "unknown";
}

async function getTailscalePeers(run = runProbe) {
  try {
    const raw = await run("tailscale", ["status", "--json"]);
    if (!raw) return { peers: [], selfIp: 'unknown', natType: 'unknown' };
    const status = JSON.parse(raw);

    const selfIps = status.Self?.TailscaleIPs || [];
    const selfIp = selfIps.find(ip => !ip.includes(':')) || selfIps[0] || 'unknown';

    const peers = [];
    if (status.Peer) {
      for (const [key, peer] of Object.entries(status.Peer)) {
        const peerIp = (peer.TailscaleIPs || []).find(ip => !ip.includes(':')) || '';
        peers.push({
          hostname: peer.HostName || key,
          ip: peerIp,
          online: peer.Online || false,
          os: peer.OS || 'unknown',
          lastSeen: peer.LastSeen || null,
          curAddr: peer.CurAddr || null,
          idle: !peer.Active,
          relay: peer.Active && !peer.CurAddr ? (peer.Relay || null) : null,
          direct: !!peer.CurAddr,
        });
      }
    }

    return { peers, selfIp, natType: status.Self?.CapMap?.['natType'] || 'unknown' };
  } catch (err) { console.warn(`[health-publisher] get tailscale peers: ${err.message}`); return { peers: [], selfIp: 'unknown', natType: 'unknown' }; }
}

async function getTailscaleLatency(peerIp, run = runProbe) {
  try {
    const raw = await run("tailscale", ["ping", "-c", "1", "--timeout", "3s", peerIp]);
    if (!raw) return null;
    const match = raw.match(/in (\d+(?:\.\d+)?)ms/);
    const viaMatch = raw.match(/via (DERP\([^)]+\)|[\d.]+:\d+)/);
    return {
      latencyMs: match ? parseFloat(match[1]) : null,
      via: viaMatch ? viaMatch[1] : 'unknown',
      isDirect: viaMatch ? !viaMatch[1].startsWith('DERP') : null,
    };
  } catch (err) { console.warn(`[health-publisher] tailscale ping: ${err.message}`); return null; }
}

function getCpuLoad() {
  const load1m = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  return Math.round((load1m / cpuCount) * 100);
}

function getNatsInfo(nc, natsUrl) {
  try {
    const info = nc.info;
    return {
      serverUrl: natsUrl || 'unknown',
      connected: !nc.isClosed(),
      serverVersion: info?.version || 'unknown',
      isHost: false,
    };
  } catch (err) { console.warn(`[health-publisher] get NATS info: ${err.message}`); return { serverUrl: 'unknown', connected: false, serverVersion: 'unknown', isHost: false }; }
}

let publishCount = 0;
let lastRoleMismatch = false;

async function gatherHealth(nc, run = runProbe) {
  publishCount++;
  const [services, tsData, deployVersion, diskPercent, agent] = await Promise.all([
    getServices(run),
    getTailscalePeers(run),
    getDeployVersion(run),
    getDiskPercent(run),
    getAgentStatus(),
  ]);
  const roleInfo = reconcileRole(resolveConfiguredRole(), services);
  if (roleInfo.roleMismatch !== lastRoleMismatch) {
    lastRoleMismatch = roleInfo.roleMismatch;
    if (roleInfo.roleMismatch) {
      console.warn(`[health-publisher] role mismatch: configured ${roleInfo.role}, running as ${roleInfo.runningRole}`);
    }
  }

  // Only ping peers every 5th cycle (every 75 seconds)
  if (publishCount % 5 === 0) {
    await Promise.all(tsData.peers.filter((p) => p.ip && p.online).map(async (peer) => {
      peer.latency = await getTailscaleLatency(peer.ip, run);
    }));
  }

  const natsInfo = getNatsInfo(nc, NATS_URL);
  const natsHost = new URL(NATS_URL).hostname;
  natsInfo.isHost = (natsHost === tsData.selfIp || natsHost === '127.0.0.1' || natsHost === 'localhost');

  return {
    nodeId: NODE_ID,
    platform: os.platform(),
    role: roleInfo.role,
    runningRole: roleInfo.runningRole,
    roleMismatch: roleInfo.roleMismatch,
    deployVersion,
    components: ROLE_COMPONENTS[roleInfo.role] || [],
    tailscaleIp: tsData.selfIp,
    diskPercent,
    mem: getMemory(),
    uptimeSeconds: Math.round(os.uptime()),
    services,
    agent,
    capabilities: [],
    tailscale: tsData,
    nats: natsInfo,
    cpuLoadPercent: getCpuLoad(),
    reportedAt: new Date().toISOString(),
  };
}

// ── Tracer Instrumentation ───────────────────────────────────────────────
gatherHealth = tracer.wrapAsync('gatherHealth', gatherHealth, { tier: 3 });

// ── Main Loop ────────────────────────────────────────────────────────────

async function main() {
  console.log(`[health-publisher] node=${NODE_ID} nats=${NATS_URL}`);
  console.log(`[health-publisher] publishing every ${PUBLISH_INTERVAL_MS / 1000}s`);

  const nc = await connect(natsConnectOpts({
    name: `health-publisher-${NODE_ID}`,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 2000,
  }));

  console.log("[health-publisher] NATS connected");
  setNatsConnection(nc, sc);

  // Get or create the KV bucket
  const js = nc.jetstream();
  const kv = await openMeshKv(js, HEALTH_BUCKET, {
    history: 1,
    ttl: KV_TTL_MS,
  });

  console.log(`[health-publisher] KV bucket ${HEALTH_BUCKET} ready`);

  // Publish immediately, then every interval
  async function publish() {
    // Circuit breaker: skip ticks during backoff
    if (skipTicksRemaining > 0) {
      skipTicksRemaining--;
      return;
    }

    try {
      const health = await gatherHealth(nc);
      const payload = JSON.stringify(health);
      await kv.put(NODE_ID, sc.encode(payload));
      if (publishCount % 10 === 0) {
        console.log(`[health-publisher] Health: cpu=${health.cpuLoadPercent}% mem=${health.mem.free}MB disk=${health.diskPercent}% services=${health.services?.length || 0}`);
        console.log(`[health-publisher] Published: ${NODE_ID} (${payload.length} bytes)`);
      }
      // Reset on success
      if (consecutiveFailures > 0) {
        console.log(`[health-publisher] recovered after ${consecutiveFailures} consecutive failures`);
      }
      consecutiveFailures = 0;
      lastErrorMsg = '';
      lastErrorRepeatCount = 0;
    } catch (err) {
      consecutiveFailures++;
      const msg = err.message;

      // Log dedup: after 3 identical consecutive errors, log every 10th
      if (msg === lastErrorMsg) {
        lastErrorRepeatCount++;
        if (lastErrorRepeatCount === 3) {
          console.error(`[health-publisher] suppressing repeated errors (${lastErrorRepeatCount} occurrences): ${msg}`);
        } else if (lastErrorRepeatCount > 3 && lastErrorRepeatCount % 10 === 0) {
          console.error(`[health-publisher] suppressing repeated errors (${lastErrorRepeatCount} occurrences): ${msg}`);
        }
        // Silently skip logs between dedup thresholds
      } else {
        lastErrorMsg = msg;
        lastErrorRepeatCount = 1;
        console.error("[health-publisher] publish failed:", msg);
      }

      // Backoff capped at 4 skipped ticks (a retry every 75s): a longer gap
      // outlives the 120s KV TTL, so the node would read as offline long after
      // the bus recovered.
      const backoffTicks = Math.pow(2, Math.min(consecutiveFailures, 2));
      skipTicksRemaining = backoffTicks;
      console.error(`[health-publisher] backoff: skipping next ${backoffTicks} ticks (failures=${consecutiveFailures})`);
    }
  }

  publish = tracer.wrapAsync('publish', publish, { tier: 3 });
  await publish();
  setInterval(publish, PUBLISH_INTERVAL_MS);

  // Keep process alive
  await nc.closed();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[health-publisher] fatal:", err);
    process.exit(1);
  });
}

module.exports = { gatherHealth, getServices, getAgentStatus, resolveConfiguredRole, reconcileRole };
