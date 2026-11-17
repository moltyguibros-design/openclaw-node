#!/usr/bin/env node

/**
 * mesh-deploy-listener.js — Fleet deploy receiver daemon.
 *
 * Runs on every node. When the lead publishes a signed deploy trigger on NATS,
 * this daemon fetches, checks out exactly the signed sha, and runs the pinned
 * deploy (`mesh-deploy.js --local --from <deployed> --to <sha>`). A failure
 * checks the previous sha back out and runs the same pinned deploy in reverse
 * — never a fetching deploy, which would fast-forward onto the failed commit
 * again. No SSH needed.
 *
 * NATS subjects:
 *   mesh.deploy.trigger    — deploy command from lead
 *   mesh.deploy.status     — status query from lead (request/reply)
 *
 * NATS KV buckets:
 *   MESH_DEPLOY_RESULTS    — write deploy result per node per SHA
 *   MESH_DEPLOY_LATEST     — the signed `latest` catch-up marker (no TTL)
 *   MESH_NODES             — this node's registry entry (nodeId, role, platform,
 *                            deployVersion, lastSeen): created at startup,
 *                            updated after each successful deploy
 */

const { connect, StringCodec } = require('nats');
const { execFile, execFileSync, spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-deploy-listener');

// ── Config ───────────────────────────────────────────────────────────────

const NODE_ID = require('../lib/node-id').resolveNodeId();
// NOTE: REPO_DIR defaults to ~/openclaw (runtime). The git repo lives at
// ~/openclaw-node. See mesh-deploy.js "Two-directory problem" comment.
const REPO_DIR = process.env.OPENCLAW_REPO_DIR ||
  path.join(os.homedir(), 'openclaw');
const REPO_REMOTE_URL = process.env.OPENCLAW_REPO_URL ||
  'https://github.com/moltyguibros-design/openclaw-node.git';
const DEPLOY_SCRIPT = path.join(REPO_DIR, 'bin', 'mesh-deploy.js');
// mesh-deploy's record of the sha this node last deployed in full.
const DEPLOY_STATE = path.join(os.homedir(), '.openclaw', '.deploy-state.json');
// npm install + `next build` + rolling restarts; each step inside the deploy
// script has its own shorter timeout.
const DEPLOY_TIMEOUT_MS = 20 * 60 * 1000;
const execFileAsync = promisify(execFile);

const { NATS_URL, natsConnectOpts } = require('../lib/nats-resolve');
const { openMeshKv } = require('../lib/mesh-kv');
const { RESULTS_BUCKET, RESULTS_KV_OPTS, LATEST_BUCKET, openLatestKv, readLatestMarker } = require('../lib/deploy-latest-marker');
const sc = StringCodec();

const NODES_BUCKET = 'MESH_NODES';
const NODE_REGISTRY_HEARTBEAT_MS = 60 * 1000;

// Node role — determines which components this node runs. main() refuses to
// start without a saved one.
const { FLEET_COMPONENTS, requireNodeRole } = require('../lib/mesh-roles');
let NODE_ROLE = null;
let NODE_ROLE_ERROR = null;
try { NODE_ROLE = requireNodeRole(); } catch (err) { NODE_ROLE_ERROR = err; }
const NODE_COMPONENTS = new Set(FLEET_COMPONENTS[NODE_ROLE] || []);

let deploying = false; // prevent concurrent deploys

// Local deploy marker (P4-9): the last outcome on THIS node, per sha. The KV
// result can be lost with the bucket; this file survives restarts and is what
// the catch-up check consults before re-running a deploy that already failed.
const DEPLOY_MARKER = process.env.OPENCLAW_DEPLOY_MARKER ||
  path.join(os.homedir(), '.openclaw', '.last-deploy.json');
// A failed deploy self-reverts and is re-attempted at most this many times
// per sha (a broken commit must not be retried on every restart forever).
const MAX_DEPLOY_ATTEMPTS = parseInt(process.env.OPENCLAW_MAX_DEPLOY_ATTEMPTS || '2', 10);

function readDeployMarker() {
  try { return JSON.parse(fs.readFileSync(DEPLOY_MARKER, 'utf8')); } catch { return null; }
}
function writeDeployMarker(marker) {
  try {
    fs.mkdirSync(path.dirname(DEPLOY_MARKER), { recursive: true });
    fs.writeFileSync(DEPLOY_MARKER, JSON.stringify(marker, null, 2) + '\n');
  } catch (err) { console.warn(`[deploy-listener] write deploy marker: ${err.message}`); }
}

/**
 * Decide whether the catch-up check should (re)deploy `latest`.
 * Pure so it is unit-testable. `lastDeploy` is this node's local marker.
 *   - HEAD already at latest AND the last attempt for it succeeded → no.
 *   - HEAD at latest but that deploy FAILED (rollback impossible or
 *     incomplete) → yes, it is not done just because the tree moved.
 *   - latest already failed `maxAttempts` times here → no (operator's turn).
 *   - latest was skipped here (not for this role, or catch-up would have
 *     moved the tree backward) → no.
 *   - latest was a targeted deploy whose `nodes` name neither this node nor
 *     'all' → no.
 */
function shouldCatchUp({ currentSha, latestSha, lastDeploy, maxAttempts = MAX_DEPLOY_ATTEMPTS, targetNodes, nodeId }) {
  if (Array.isArray(targetNodes) && !targetNodes.includes('all') && !targetNodes.includes(nodeId)) {
    return { deploy: false, reason: `latest ${latestSha} targets ${targetNodes.join(', ')}, not this node` };
  }
  const same = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
  const lastForLatest = lastDeploy && same(lastDeploy.sha, latestSha) ? lastDeploy : null;
  if (lastForLatest && lastForLatest.status === 'failed' && (lastForLatest.attempts || 0) >= maxAttempts) {
    return { deploy: false, reason: `sha ${latestSha} failed ${lastForLatest.attempts}× here — not retrying automatically` };
  }
  if (lastForLatest && lastForLatest.status === 'skipped') {
    return { deploy: false, reason: `sha ${latestSha} was skipped here (${lastForLatest.reason || 'not applicable'})` };
  }
  if (same(currentSha, latestSha)) {
    if (lastForLatest && lastForLatest.status === 'failed') {
      return { deploy: true, reason: `tree is at ${latestSha} but its deploy failed — re-attempting` };
    }
    return { deploy: false, reason: `up to date at ${currentSha}` };
  }
  return { deploy: true, reason: `behind: local=${currentSha} latest=${latestSha}` };
}

// A deploy rewrites this node (`git reset --hard`) — every outcome is worth a
// ledgered desktop popup, not just a console line nobody watches.
const NOTIFY_CLI = path.join(__dirname, 'openclaw-notify.mjs');
const MC_MESH_URL = `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/mesh`;
function notifyDesktop(kind, title, message) {
  try {
    execFile(process.execPath, [
      NOTIFY_CLI, '--source', 'mesh-deploy', '--kind', kind,
      '--title', title, '--message', message, '--url', MC_MESH_URL,
    ], { timeout: 10_000 }, () => {});
  } catch { /* best-effort */ }
}

// ── Deploy Execution ─────────────────────────────────────────────────────

function git(...args) {
  return execFileSync('git', args, {
    cwd: REPO_DIR, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isAncestor(ancestor, descendant) {
  try { git('merge-base', '--is-ancestor', ancestor, descendant); return true; } catch { return false; }
}

// The diff base: the sha mesh-deploy last deployed here in full, not HEAD.
// HEAD moves without deploying — on the lead the repo is a working checkout
// and `mesh deploy` publishes its HEAD, so a HEAD-based diff is always empty.
function deployedBase() {
  let recorded = null;
  try { recorded = JSON.parse(fs.readFileSync(DEPLOY_STATE, 'utf8')).deployedSha; } catch { /* not recorded yet */ }
  if (/^[0-9a-f]{40}$/.test(recorded || '')) {
    try { return git('rev-parse', '--verify', '--quiet', `${recorded}^{commit}`); } catch { /* not in this clone */ }
  }
  return git('rev-parse', 'HEAD');
}

// The signed sha, resolved after the fetch: it must be a commit on the
// trigger's branch, not whatever the branch tip happens to be now.
function resolveSignedSha(sha, branch) {
  let full = null;
  try { full = git('rev-parse', '--verify', '--quiet', `${sha}^{commit}`); } catch { /* unknown object */ }
  if (!full || !isAncestor(full, `origin/${branch}`)) {
    throw new Error(`signed sha ${sha} is not on origin/${branch}`);
  }
  return full;
}

// Run the checked-out tree's mesh-deploy.js in pinned mode (no fetch).
async function runDeployScript(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, [DEPLOY_SCRIPT, '--local', ...args], {
      cwd: REPO_DIR, encoding: 'utf8', timeout: DEPLOY_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, OPENCLAW_REPO_DIR: REPO_DIR },
    }));
  } catch (err) {
    const reported = String(err.stdout || '').split('\n').reverse().find(l => l.startsWith('DEPLOY_ERROR '));
    if (reported) err.message = JSON.parse(reported.slice('DEPLOY_ERROR '.length));
    throw err;
  }
  const line = stdout.split('\n').reverse().find(l => l.startsWith('DEPLOY_RESULT '));
  if (!line) {
    throw Object.assign(new Error(`${DEPLOY_SCRIPT} printed no DEPLOY_RESULT — that tree's deploy script predates pinned deploys`), { stdout });
  }
  return { stdout, deployed: JSON.parse(line.slice('DEPLOY_RESULT '.length)) };
}

/**
 * Deploy exactly `trigger.sha` on this node and, if that fails, put the
 * previous deployed sha back. Returns the result record (status success |
 * skipped | failed); never throws.
 *
 * forwardOnly (catch-up): never move the tree backward. The `latest` marker
 * is state read at every restart; a node ahead of it was moved on purpose
 * (the lead's working checkout), and rewinding it is not catching up.
 */
async function runDeploy(trigger, { forwardOnly = false } = {}) {
  const result = { status: 'success', sha: trigger.sha, preSha: null, componentsDeployed: [], warnings: [], errors: [], log: '' };

  // Requested components this role runs; a filtered run reinstalls them in full.
  const componentArgs = [];
  if (trigger.components && !trigger.components.includes('all')) {
    const applicable = trigger.components.filter(c => NODE_COMPONENTS.has(c));
    if (applicable.length === 0) {
      console.log(`[deploy-listener] No applicable components for role=${NODE_ROLE} — skipping`);
      return { ...result, status: 'skipped', log: `No matching components for role ${NODE_ROLE}` };
    }
    for (const c of applicable) componentArgs.push('--component', c);
  }

  // Pre-deploy SHA (P4-9): the point to roll back to. Null on the bootstrap
  // path (no git tree yet) — nothing to revert to; the failure is reported as-is.
  let preSha = null;
  let targetSha = null;
  let touched = false; // tree moved or deploy script ran: a failure needs a rollback
  try {
    // trigger.sha/branch come from NATS; they reach git as argv, never a shell.
    const branch = trigger.branch || 'main';
    if (!/^[a-zA-Z0-9._/-]+$/.test(branch) || branch.startsWith('-')) {
      throw new Error(`Invalid branch name: ${trigger.branch}`);
    }
    if (!/^[0-9a-f]{7,40}$/i.test(trigger.sha || '')) throw new Error(`Invalid sha: ${trigger.sha}`);

    let deployArgs;
    if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
      // Provisioner copied files without git clone: nothing recorded to diff
      // from, so every component is reinstalled at the signed sha.
      if (!fs.existsSync(REPO_DIR)) throw new Error(`Repo dir not found at ${REPO_DIR}`);
      console.log(`[deploy-listener] No .git found — bootstrapping git repo`);
      git('init', '--quiet');
      git('remote', 'add', 'origin', REPO_REMOTE_URL);
      git('fetch', 'origin', branch);
      targetSha = resolveSignedSha(trigger.sha, branch);
      git('reset', '--hard', '--quiet', targetSha);
      deployArgs = ['--from', targetSha, '--to', targetSha, ...(componentArgs.length ? componentArgs : ['--component', 'all'])];
    } else {
      preSha = deployedBase();
      console.log(`[deploy-listener] git fetch origin ${branch}...`);
      git('fetch', 'origin', branch);
      targetSha = resolveSignedSha(trigger.sha, branch);
      const head = git('rev-parse', 'HEAD');
      if (!isAncestor(head, `origin/${branch}`)) {
        throw new Error(`HEAD ${head.slice(0, 7)} has commits that are not on origin/${branch} — refusing to move this checkout`);
      }
      if (forwardOnly && !isAncestor(head, targetSha)) {
        console.log(`[deploy-listener] HEAD ${head.slice(0, 7)} is ahead of ${trigger.sha} — catch-up never moves a node backward`);
        return { ...result, status: 'skipped', log: `HEAD ${head.slice(0, 7)} is ahead of ${trigger.sha}` };
      }
      // Tracked edits are refused before anything moves: the daemons run this
      // checkout's files, so the edit would go live as the signed sha. The
      // deploy script refuses them too, but only after this checkout — and the
      // rollback could not then move the tree back over the same edit. Content
      // only, as there: mode-only changes never reach a runtime copy.
      const dirty = git('-c', 'core.fileMode=false', 'status', '--porcelain', '--untracked-files=no');
      if (dirty) {
        throw new Error(`tracked files differ from the commit (${dirty.split('\n').slice(0, 5).map(l => l.trim()).join(', ')}) — refusing to deploy over them`);
      }
      if (head !== targetSha) {
        console.log(`[deploy-listener] Checking out ${targetSha.slice(0, 7)} (was ${head.slice(0, 7)})`);
        touched = true;
        git('checkout', '--detach', '--quiet', targetSha);
      }
      deployArgs = ['--from', preSha, '--to', targetSha, ...componentArgs];
    }
    if (trigger.force) deployArgs.push('--force');

    console.log(`[deploy-listener] Running: mesh-deploy.js --local ${deployArgs.join(' ')}`);
    touched = true;
    const { stdout, deployed } = await runDeployScript(deployArgs);
    const head = git('rev-parse', 'HEAD');
    if (head !== targetSha) throw new Error(`deploy left HEAD at ${head.slice(0, 7)}, expected ${targetSha.slice(0, 7)}`);

    result.log = stdout.slice(-5000);
    result.componentsDeployed = deployed.components;
    result.deferredRestart = deployed.deferredRestart || [];
    result.sha = git('rev-parse', '--short', 'HEAD');
    const ids = deployed.components.map(c => c.id).join(', ');
    console.log(`[deploy-listener] Success — now at ${result.sha} (${ids || 'no component changed'})`);
  } catch (err) {
    result.status = 'failed';
    result.errors.push(err.message);
    result.log = String(err.stdout || err.stderr || err.message).slice(-5000);
    console.error(`[deploy-listener] Deploy FAILED: ${err.message}`);

    // Rollback: check preSha back out and deploy the reverse diff with the
    // known-good tree's own script, pinned. The old path re-ran a fetching
    // deploy, which fast-forwarded straight back onto the failed commit.
    if (touched && preSha && targetSha && preSha !== targetSha) {
      try {
        if (git('rev-parse', 'HEAD') !== preSha) {
          console.log(`[deploy-listener] Rolling back ${targetSha.slice(0, 7)} → ${preSha.slice(0, 7)}`);
          git('checkout', '--detach', '--quiet', preSha);
        }
        await runDeployScript(['--from', targetSha, '--to', preSha, ...componentArgs]);
        const head = git('rev-parse', 'HEAD');
        if (head !== preSha) throw new Error(`rollback left HEAD at ${head.slice(0, 7)}`);
        result.rolledBack = true;
        result.rollbackSha = preSha.slice(0, 7);
        console.log(`[deploy-listener] Rolled back to ${preSha.slice(0, 7)} and redeployed`);
      } catch (rbErr) {
        result.rolledBack = false;
        result.errors.push(`rollback failed: ${rbErr.message}`);
        console.error(`[deploy-listener] ROLLBACK FAILED: ${rbErr.message} — node is at an unverified tree`);
      }
    }
  }
  result.preSha = preSha ? preSha.slice(0, 7) : null;
  return result;
}

// This process cannot restart its own unit in-band: systemd would kill the
// cgroup (and launchd the job) that runs the restart command. A transient
// systemd timer, or a setsid'd child on macOS, outlives this process and
// restarts it once the result is written.
const SELF_RESTART_DELAY_S = 10;
function scheduleSelfRestart(services, { platform = os.platform(), spawnFn = spawn, uid = process.getuid?.() } = {}) {
  const scheduled = [];
  for (const svc of services || []) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(svc) || !/mesh-deploy-listener$/.test(svc)) {
      console.warn(`[deploy-listener] not scheduling a restart of ${JSON.stringify(svc).slice(0, 60)}`);
      continue;
    }
    const [cmd, args] = platform === 'darwin'
      ? ['/bin/sh', ['-c', `sleep ${SELF_RESTART_DELAY_S}; exec launchctl kickstart -k "$1"`, 'sh', `gui/${uid}/${svc}`]]
      : ['systemd-run', ['--user', `--on-active=${SELF_RESTART_DELAY_S}s`, '--', 'systemctl', '--user', 'restart', svc]];
    try {
      const child = spawnFn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on?.('error', err => console.error(`[deploy-listener] schedule restart of ${svc}: ${err.message}`));
      child.unref?.();
      scheduled.push(svc);
      console.log(`[deploy-listener] ${svc} restarts in ${SELF_RESTART_DELAY_S}s to load the deployed code`);
    } catch (err) {
      console.error(`[deploy-listener] schedule restart of ${svc}: ${err.message} — restart it by hand`);
    }
  }
  return scheduled;
}

async function executeDeploy(trigger, resultsKv, nodesKv, opts = {}) {
  if (deploying) {
    console.log(`[deploy-listener] Already deploying — ignoring trigger for ${trigger.sha} (from ${trigger.initiator || 'unknown'})`);
    return;
  }

  deploying = true;
  const startedAt = new Date().toISOString();
  // Sanitize sha for NATS KV key safety (KV rejects whitespace, path seps, etc.)
  const safeSha = (trigger.sha || 'unknown').replace(/[^a-fA-F0-9.-]/g, '');
  const resultKey = `${safeSha}-${NODE_ID}`;

  try {
    console.log(`[deploy-listener] ═══ Deploy triggered: ${trigger.sha} by ${trigger.initiator} ═══`);

    // Write "deploying" status so lead sees we're working
    try {
      await resultsKv.put(resultKey, sc.encode(JSON.stringify({
        nodeId: NODE_ID, sha: trigger.sha, status: 'deploying', startedAt,
      })));
    } catch (err) { console.warn(`[deploy-listener] write deploying status: ${err.message}`); }

    const prior = readDeployMarker();
    const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));
    const attempts = (prior && sameSha(prior.sha, trigger.sha) ? (prior.attempts || 0) : 0) + 1;

    const result = { nodeId: NODE_ID, startedAt, ...(await runDeploy(trigger, opts)) };
    result.completedAt = new Date().toISOString();
    result.attempts = attempts;
    // Local marker: what this node last tried, and how it ended.
    writeDeployMarker({
      sha: trigger.sha, status: result.status, attempts,
      completedAt: result.completedAt, preSha: result.preSha,
      rolledBack: result.rolledBack ?? null, initiator: trigger.initiator || null,
      ...(result.status === 'skipped' ? { reason: result.log } : {}),
    });
    result.durationSeconds = Math.round(
      (new Date(result.completedAt) - new Date(result.startedAt)) / 1000
    );

    // Write final result to KV
    try {
      await resultsKv.put(resultKey, sc.encode(JSON.stringify(result)));
    } catch (err) {
      console.error(`[deploy-listener] Failed to write result: ${err.message}`);
    }

    if (result.status === 'success') {
      notifyDesktop('success', 'Mesh deploy applied', `${NODE_ID} now at ${result.sha} (${result.durationSeconds}s)`);
    } else if (result.status === 'failed') {
      const where = result.rolledBack ? `rolled back to ${result.rollbackSha}` : (result.rolledBack === false ? 'ROLLBACK FAILED' : 'no rollback point');
      notifyDesktop('error', 'Mesh deploy FAILED', `${NODE_ID} (${where}, attempt ${attempts}/${MAX_DEPLOY_ATTEMPTS}): ${result.errors[0]?.slice(0, 160) || 'unknown'}`);
    }

    if (result.status === 'success' && nodesKv) {
      try {
        await upsertNodeRegistry(nodesKv, { deployVersion: result.sha, lastDeploy: result.completedAt });
        console.log(`[deploy-listener] Updated node registry: deployVersion=${result.sha.slice(0,7)}`);
      } catch (err) { console.warn(`[deploy-listener] update node deploy version: ${err.message}`); }
    }

    // Last: the result is written and the registry updated before the restart lands.
    if (result.status === 'success' && result.deferredRestart?.length) {
      scheduleSelfRestart(result.deferredRestart);
    }
  } finally {
    deploying = false;
  }
}

// ── Node Registry ────────────────────────────────────────────────────────

/**
 * Create or update this node's MESH_NODES entry. fleet-deploy discovers the
 * fleet from MESH_NODES first, so the listener — which runs on every node —
 * is the one that must create the entry, not only touch an existing one.
 */
async function upsertNodeRegistry(nodesKv, { deployVersion, lastDeploy } = {}) {
  let node = {};
  const existing = await nodesKv.get(NODE_ID);
  if (existing && existing.value) {
    try { node = JSON.parse(sc.decode(existing.value)); } catch { node = {}; }
  }
  node.nodeId = NODE_ID;
  node.role = NODE_ROLE;
  node.platform = os.platform();
  if (deployVersion) node.deployVersion = deployVersion;
  else if (node.deployVersion === undefined) node.deployVersion = null;
  if (lastDeploy) node.lastDeploy = lastDeploy;
  node.lastSeen = new Date().toISOString();
  await nodesKv.put(NODE_ID, sc.encode(JSON.stringify(node)));
  return node;
}

async function registerNode(nodesKv, { readHead = true } = {}) {
  let headSha = null;
  if (readHead) {
    try { headSha = git('rev-parse', '--short', 'HEAD'); } catch (err) { console.warn(`[deploy-listener] read git HEAD: ${err.message}`); }
  }
  try {
    await upsertNodeRegistry(nodesKv, { deployVersion: headSha });
  } catch (err) { console.warn(`[deploy-listener] register in MESH_NODES: ${err.message}`); }
}

// ── Auto-Catch-Up ────────────────────────────────────────────────────────

/**
 * On startup, check if we're behind the latest deployed version.
 * If another deploy happened while we were offline, catch up now.
 */
async function checkAndCatchUp(resultsKv, nodesKv, latestKv) {
  try {
    const found = await readLatestMarker({ latestKv, resultsKv });
    if (!found) {
      console.warn(`[deploy-listener] Catch-up: no catch-up marker in ${LATEST_BUCKET} or ${RESULTS_BUCKET} — staying at the current tree`);
      return;
    }
    const marker = found.marker;

    // C2: the marker steers a checkout + deploy exactly like a live trigger —
    // it gets the same signature+trust gate (no freshness: markers are state,
    // read possibly days after the deploy). Without this, the signed-trigger
    // check was fully bypassed on every startup/reconnect by whoever could
    // write one KV key.
    const { verifyDeployMarker } = await import('../lib/deploy-trigger-auth.mjs');
    const auth = verifyDeployMarker(marker);
    if (!auth.ok) {
      console.error(`[deploy-listener] REJECTED catch-up marker: ${auth.reason} (sha=${marker.sha})`);
      return;
    }

    const { sha, branch } = marker;
    const currentSha = git('rev-parse', '--short', 'HEAD');

    // P4-9: "HEAD == latest" is not "deployed" — a merged-but-failed deploy
    // leaves the tree there too. The local marker breaks the tie, and caps
    // automatic retries of a sha that keeps failing on this node.
    const verdict = shouldCatchUp({ currentSha, latestSha: sha, lastDeploy: readDeployMarker(), targetNodes: marker.nodes, nodeId: NODE_ID });
    console.log(`[deploy-listener] Catch-up: ${verdict.reason}`);
    if (verdict.deploy) {
      await executeDeploy(
        { sha, branch: branch || 'main', components: ['all'], initiator: 'auto-catchup' },
        resultsKv, nodesKv, { forwardOnly: true }
      );
    }
  } catch (err) {
    console.log(`[deploy-listener] Catch-up check skipped: ${err.message}`);
  }
}

// ── Tracer Instrumentation ───────────────────────────────────────────────
executeDeploy = tracer.wrapAsync('executeDeploy', executeDeploy, { tier: 2, category: 'lifecycle' });
checkAndCatchUp = tracer.wrapAsync('checkAndCatchUp', checkAndCatchUp, { tier: 2, category: 'lifecycle' });

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (NODE_ROLE_ERROR) throw NODE_ROLE_ERROR;
  console.log(`[deploy-listener] Node: ${NODE_ID}`);
  console.log(`[deploy-listener] Repo: ${REPO_DIR}`);
  console.log(`[deploy-listener] NATS: ${NATS_URL}`);

  // Connect to NATS with infinite retry
  let nc;
  while (true) {
    try {
      nc = await connect(natsConnectOpts({
        name: `deploy-listener-${NODE_ID}`,
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 5000,
        timeout: 10000,
      }));
      break;
    } catch (err) {
      console.log(`[deploy-listener] NATS connect failed, retrying in 10s...`);
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  console.log(`[deploy-listener] NATS connected`);
  setNatsConnection(nc, sc);

  // Get KV buckets
  const js = nc.jetstream();
  const resultsKv = await openMeshKv(js, RESULTS_BUCKET, RESULTS_KV_OPTS);
  const latestKv = await openLatestKv(js);
  let nodesKv = null;
  try {
    nodesKv = await openMeshKv(js, NODES_BUCKET, { history: 1 }); // No TTL — node identity persists
  } catch (err) { console.warn(`[deploy-listener] open MESH_NODES bucket: ${err.message}`); }
  if (nodesKv) {
    await registerNode(nodesKv);
    // fleet-deploy --status calls a node OFFLINE once lastSeen is 120 s old.
    // Mid-deploy HEAD is transient, so only lastSeen is refreshed then.
    setInterval(() => registerNode(nodesKv, { readHead: !deploying }), NODE_REGISTRY_HEARTBEAT_MS);
  }

  // Check for missed deploys while we were offline
  await checkAndCatchUp(resultsKv, nodesKv, latestKv);

  // Subscribe to deploy triggers
  const sub = nc.subscribe('mesh.deploy.trigger');
  console.log(`[deploy-listener] Listening on mesh.deploy.trigger`);

  // C2 fix (deep review 2026-07-03): authenticate the trigger before running
  // `git reset --hard` + deploy. Strict by default: the signer must be in
  // OPENCLAW_DEPLOY_TRUSTED_KEYS (none configured = every trigger rejected); only
  // OPENCLAW_REQUIRE_SIGNED_DEPLOY=0 accepts unsigned triggers, with a warning.
  // ESM helper loaded dynamically (this is CJS).
  const { verifyDeployTrigger } = await import('../lib/deploy-trigger-auth.mjs');

  (async () => {
    for await (const msg of sub) {
      try {
        const trigger = JSON.parse(sc.decode(msg.data));

        // Ignore triggers for specific nodes that don't include us
        if (trigger.nodes && !trigger.nodes.includes(NODE_ID) && !trigger.nodes.includes('all')) {
          console.log(`[deploy-listener] Trigger not for us — target: ${trigger.nodes.join(', ')}`);
          continue;
        }

        const auth = verifyDeployTrigger(trigger);
        if (!auth.ok) {
          console.error(`[deploy-listener] REJECTED deploy trigger: ${auth.reason} (sha=${trigger.sha}, initiator=${trigger.initiator || 'unknown'})`);
          notifyDesktop('block', 'Mesh deploy REJECTED', `${auth.reason} (sha=${trigger.sha}, from ${trigger.initiator || 'unknown'})`);
          continue;
        }

        await executeDeploy(trigger, resultsKv, nodesKv);
      } catch (err) {
        console.error(`[deploy-listener] Error handling trigger: ${err.message}`);
      }
    }
  })();

  // Respond to status queries (request/reply)
  const statusSub = nc.subscribe(`mesh.deploy.status.${NODE_ID}`);
  (async () => {
    for await (const msg of statusSub) {
      let currentSha = 'unknown';
      try {
        currentSha = git('rev-parse', '--short', 'HEAD');
      } catch (err) { console.warn(`[deploy-listener] read git HEAD: ${err.message}`); }

      const response = {
        nodeId: NODE_ID,
        deployVersion: currentSha,
        deploying,
        repoDir: REPO_DIR,
        platform: os.platform(),
      };

      if (msg.reply) {
        msg.respond(sc.encode(JSON.stringify(response)));
      }
    }
  })();

  // NATS status monitoring
  (async () => {
    for await (const s of nc.status()) {
      console.log(`[deploy-listener] NATS: ${s.type}`);
      // On reconnect, check for missed deploys
      if (s.type === 'reconnect') {
        await checkAndCatchUp(resultsKv, nodesKv, latestKv);
      }
    }
  })();

  // Graceful shutdown
  const shutdown = async (sig) => {
    console.log(`[deploy-listener] ${sig} — shutting down`);
    await nc.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[deploy-listener] ═══ Ready ═══`);
}

module.exports = { shouldCatchUp, runDeploy, scheduleSelfRestart, upsertNodeRegistry, checkAndCatchUp };

if (require.main === module) {
  main().catch(err => {
    console.error(`[deploy-listener] Fatal: ${err.message}`);
    process.exit(1);
  });
}
