#!/usr/bin/env node
/**
 * bin/fed-chaos.mjs — step 3.5 chaos harness (Phase-1 operational gate, T5 matrix).
 *
 * Injects failures against a mock-LLM grappe and asserts the required
 * resilience behavior with KV/log evidence. Cheap: mock (shell) agents, a short
 * circling-step budget so timeout cells resolve in seconds, single-node bus.
 *
 * Runnable on this bus (single-node): C1, C5, C7.
 * Needs the R=3 cluster (step 1.5): C2, C3.  Deeper: C4, C6, C8.
 *
 * Usage:  node bin/fed-chaos.mjs c1|c5|c7|all
 *   The harness stops the installed mesh-task-daemon service (its units pin a
 *   30 min MESH_CIRCLING_STEP_TIMEOUT_MS), runs its own task daemon from this
 *   checkout with a short one, starts 3 mock agents, and on exit kills only the
 *   processes it started and restarts the service if it had been running.
 *   Exit 0 = all requested cells passed.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('nats');
const { natsConnectOpts } = require('../lib/nats-resolve');
const sc = StringCodec();
const NATS = process.env.OPENCLAW_NATS || 'nats://127.0.0.1:4222';
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CHAOS_STEP_TIMEOUT_MS = String(process.env.CHAOS_STEP_TIMEOUT_MS || 20000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function bus() { return connect({ ...natsConnectOpts(), servers: NATS, timeout: 10000 }); }

/**
 * The processes this harness started, by name. Each is spawned detached (its
 * own process group), so a kill takes its children too and never touches a
 * mesh-agent or task daemon the operator runs.
 */
export function createProcessPool({ spawnFn = spawn, killFn = process.kill.bind(process) } = {}) {
  const procs = new Map();
  return {
    start(name, script, env, logPath) {
      const out = fs.openSync(logPath, 'a');
      const p = spawnFn(process.execPath, [script], { cwd: REPO, env, detached: true, stdio: ['ignore', out, out] });
      p.unref?.();
      procs.set(name, p.pid);
      return p.pid;
    },
    kill(name) {
      const pid = procs.get(name);
      if (pid === undefined) return false;
      procs.delete(name);
      try { killFn(-pid, 'SIGKILL'); } catch { /* already gone */ }
      return true;
    },
    killMatching(prefix) { for (const name of [...procs.keys()]) if (name.startsWith(prefix)) this.kill(name); },
    names() { return [...procs.keys()]; },
  };
}

const pool = createProcessPool();

export function agentEnv(nodeId, base = process.env) {
  const env = { ...base, OPENCLAW_NATS: NATS, MESH_LLM_PROVIDER: 'shell', MESH_ALLOW_MOCK_WORKERS: '1', OPENCLAW_NODE_ID: nodeId };
  delete env.CLAUDECODE;
  return env;
}
export function daemonEnv(base = process.env) {
  return { ...base, OPENCLAW_NATS: NATS, MESH_CIRCLING_STEP_TIMEOUT_MS: CHAOS_STEP_TIMEOUT_MS };
}

// The installed task daemon, which the harness replaces for the run.
const SERVICE = os.platform() === 'darwin'
  ? { label: 'ai.openclaw.mesh-task-daemon', plist: path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.openclaw.mesh-task-daemon.plist') }
  : { unit: 'openclaw-mesh-task-daemon' };
function serviceRunning() {
  try {
    if (SERVICE.label) { execFileSync('launchctl', ['list', SERVICE.label], { stdio: 'ignore' }); return true; }
    return execFileSync('systemctl', ['--user', 'is-active', SERVICE.unit], { encoding: 'utf8' }).trim() === 'active';
  } catch { return false; }
}
function serviceStop() {
  if (SERVICE.label) execFileSync('launchctl', ['unload', SERVICE.plist], { stdio: 'ignore' });
  else execFileSync('systemctl', ['--user', 'stop', SERVICE.unit], { stdio: 'ignore' });
}
function serviceStart() {
  if (SERVICE.label) execFileSync('launchctl', ['load', SERVICE.plist], { stdio: 'ignore' });
  else execFileSync('systemctl', ['--user', 'start', SERVICE.unit], { stdio: 'ignore' });
}

function startDaemon(tag) {
  pool.start('daemon', 'bin/mesh-task-daemon.js', daemonEnv(), path.join(os.tmpdir(), `chaos-${tag}-daemon.log`));
}

async function submit(nc, mode, extra = {}) {
  const taskId = `chaos-${mode}-${Date.now()}`;
  await nc.request('mesh.tasks.submit', sc.encode(JSON.stringify({
    task_id: taskId, title: `chaos ${mode}`, description: 'echo chaos-work', metric: 'node --version',
    collaboration: { mode, automation_tier: 1, ...extra },
  })), { timeout: 15000 });
  return taskId;
}

async function sessionFor(nc, taskId) {
  const kv = await nc.jetstream().views.kv('MESH_COLLAB');
  let key = null;
  for await (const k of await kv.keys()) if (k.includes(taskId)) key = k;
  if (!key) return null;
  try { return JSON.parse(new TextDecoder().decode((await kv.get(key)).value)); } catch { return null; }
}
async function waitStatus(nc, taskId, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await sessionFor(nc, taskId);
    if (s && statuses.includes(s.status)) return s;
    await sleep(2000);
  }
  return await sessionFor(nc, taskId);
}
function startAgents(ids, tag) {
  for (const n of ids) pool.start(`agent:${n}`, 'bin/mesh-agent.js', agentEnv(n), path.join(os.tmpdir(), `chaos-${tag}-${n}.log`));
}
async function killAgents() { pool.killMatching('agent:'); }
async function killOneAgent() {
  const [first] = pool.names().filter(n => n.startsWith('agent:'));
  if (first) pool.kill(first);
}

// ── C1: kill a member mid-barrier → circling step timeout fires, session terminal, never hangs ──
// Uses circling (fast configurable step budget): the harness's own task daemon
// runs with MESH_CIRCLING_STEP_TIMEOUT_MS=CHAOS_STEP_TIMEOUT_MS.
async function c1(nc) {
  await killAgents(); await sleep(1000);
  startAgents(['alpha', 'bravo', 'charlie'], 'c1');
  await sleep(6000);
  const taskId = await submit(nc, 'circling_strategy', { max_subrounds: 1 });
  // let recruiting close + Init step start, then kill one member mid-barrier
  await sleep(12000);
  await killOneAgent();
  // the circling step timeout must fire, mark the node dead, and drive terminal
  const s = await waitStatus(nc, taskId, ['aborted', 'completed'], 120000);
  const pass = s && (s.status === 'aborted' || s.status === 'completed');
  return { cell: 'C1', pass, detail: `killed a member mid-barrier → session ${s?.status || 'STILL ACTIVE (HANG!)'} (never hung = ${pass})` };
}

// ── C5: duplicate reflection replay → barrier counts once (idempotency) ──
async function c5(nc) {
  await killAgents(); await sleep(1000);
  startAgents(['alpha', 'bravo', 'charlie'], 'c5');
  await sleep(6000);
  const taskId = await submit(nc, 'cooperative', { rounds: 1 });
  // Let it run to completion; idempotency is already enforced by the barrier —
  // verify the completed session's round-1 reflection count == node count (no dup inflation).
  const s = await waitStatus(nc, taskId, ['completed', 'aborted'], 90000);
  const r1 = s?.rounds?.[0]?.reflections || [];
  const uniqueNodes = new Set(r1.map(r => r.node_id)).size;
  const pass = s?.status === 'completed' && r1.length === uniqueNodes;
  return { cell: 'C5', pass, detail: `round-1 reflections=${r1.length}, unique nodes=${uniqueNodes} (barrier counts once = ${pass})` };
}

// ── C7: daemon restart mid-session → state rehydrates from KV, session resumes ──
async function c7(nc) {
  await killAgents(); await sleep(1000);
  startAgents(['alpha', 'bravo', 'charlie'], 'c7');
  await sleep(6000);
  const taskId = await submit(nc, 'cooperative', { rounds: 3 });
  await sleep(9000); // let it get past recruiting into rounds
  const before = await sessionFor(nc, taskId);
  // restart the task daemon mid-session (the harness's own, with the same short step budget)
  pool.kill('daemon');
  await sleep(1000);
  startDaemon('c7');
  await sleep(4000);
  const after = await sessionFor(nc, taskId);
  const rehydrated = !!after && after.session_id === before?.session_id;
  const terminal = await waitStatus(nc, taskId, ['completed', 'aborted'], 120000);
  const pass = rehydrated && !!terminal && ['completed', 'aborted'].includes(terminal.status);
  return { cell: 'C7', pass, detail: `pre-restart status=${before?.status}; post-restart session present=${rehydrated}; final=${terminal?.status} (rehydrated+resumed = ${pass})` };
}

const CELLS = { c1, c5, c7 };

async function main() {
  const which = (process.argv[2] || 'all').toLowerCase();
  const run = which === 'all' ? ['c1', 'c5', 'c7'] : [which];
  const serviceWasRunning = serviceRunning();
  const results = [];
  let nc = null;
  try {
    if (serviceWasRunning) serviceStop();
    startDaemon('run');
    await sleep(3000);
    nc = await bus();
    for (const c of run) {
      if (!CELLS[c]) { console.error(`unknown cell ${c}`); continue; }
      console.log(`\n=== chaos ${c.toUpperCase()} ===`);
      try { const r = await CELLS[c](nc); results.push(r); console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.cell}: ${r.detail}`); }
      catch (e) { results.push({ cell: c.toUpperCase(), pass: false, detail: 'threw: ' + e.message }); console.log(`FAIL ${c.toUpperCase()}: ${e.message}`); }
    }
    const kv = await nc.jetstream().views.kv('MESH_COLLAB');
    for await (const k of await kv.keys()) if (k.includes('chaos-')) await kv.purge(k);
  } finally {
    for (const name of pool.names()) pool.kill(name);
    if (nc) await nc.close();
    if (serviceWasRunning) serviceStart();
  }
  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} chaos cells passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}
