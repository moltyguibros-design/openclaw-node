import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { freePort, natsServerBin, startNatsServer } from './helpers/nats-server.mjs';

// The bridge's mesh.events.> listener against what bin/mesh-task-daemon.js
// publishCollabEvent really sends: subject mesh.events.collab.<type>, `event` is the
// bare type ('completed', not 'collab.completed') and the session rides in `session`.
// Sessions are produced by the real CollabStore so the bridge reads the daemon's shape.

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('nats');
const { createSession, CollabStore } = require('../lib/mesh-collab.js');
const { parseTasks } = require('../lib/kanban-io.js');
const entry = process.env.BRIDGE_TEST_ENTRY || fileURLToPath(new URL('../bin/mesh-bridge.js', import.meta.url));
const skip = natsServerBin() ? false : 'nats-server not found on PATH';
const livePorts = [4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224];
const sc = StringCodec();
const TASK = 'collab-card-1';

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('condition deadline exceeded');
}

async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill('SIGTERM');
  try { await until(() => proc.exitCode !== null || proc.signalCode !== null, 5_000); }
  catch {
    proc.kill('SIGKILL');
    await until(() => proc.exitCode !== null || proc.signalCode !== null, 5_000);
  }
}

// Just enough of a JetStream KV (get/put/update with revision CAS) for CollabStore.
function memoryKv() {
  const rows = new Map();
  let seq = 0;
  return {
    async get(key) { return rows.get(key) || null; },
    async put(key, value) { rows.set(key, { value, revision: ++seq }); return seq; },
    async update(key, value, revision) {
      if (rows.get(key)?.revision !== revision) throw Object.assign(new Error('wrong last sequence'), { code: '10071' });
      rows.set(key, { value, revision: ++seq });
      return seq;
    },
    async delete(key) { rows.delete(key); },
  };
}

// A real bridge on a real nats-server, tracking TASK as an in-flight mesh card:
// reconcile asks mesh.tasks.get and resumes tracking a task the daemon reports running.
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-bridge-collab-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) await stop(proc);
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  const memory = path.join(home, '.openclaw', 'workspace', 'memory');
  await fs.mkdir(memory, { recursive: true, mode: 0o700 });
  const kanban = path.join(memory, 'active-tasks.md');
  await fs.writeFile(kanban, `# Collab fixture\n\n## Live Tasks\n\n- task_id: ${TASK}\n  title: Collaborative card\n  status: running\n  execution: mesh\n  owner: mesh\n  updated_at: 2026-11-16T09:00:00-05:00\n`, { mode: 0o600 });
  const port = await freePort();
  const monitorPort = await freePort();
  assert.ok(!livePorts.includes(port) && !livePorts.includes(monitorPort));
  assert.notEqual(port, monitorPort);
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nhttp: 127.0.0.1:${monitorPort}\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);
  nc = await connect({ servers: `nats://127.0.0.1:${port}`, token, maxReconnectAttempts: 0 });
  nc.subscribe('mesh.tasks.get', { callback: (_err, msg) => {
    msg.respond(sc.encode(JSON.stringify({ ok: true, data: { task_id: TASK, status: 'running', owner: 'node-a' } })));
  } });
  await nc.flush();
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
    OPENCLAW_NODE_ID: 'collab-bridge-fixture',
    OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
    BRIDGE_DISPATCH_INTERVAL: '100',
  };
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;
  const proc = spawn(process.execPath, [entry], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(proc);
  const bridge = { proc, result: null, output: '' };
  proc.on('error', (error) => { bridge.result = { error }; });
  proc.on('exit', (code, signal) => { bridge.result = { code, signal }; });
  proc.stdout.on('data', (data) => { bridge.output += data; });
  proc.stderr.on('data', (data) => { bridge.output += data; });
  await until(async () => {
    assert.equal(bridge.result, null, bridge.output);
    const state = await fetch(`http://127.0.0.1:${monitorPort}/connz?subs=1`).then(r => r.json());
    return state.connections.some(c => c.subscriptions_list?.includes('mesh.events.>'));
  });
  assert.ok(bridge.output.includes(`RECONCILE: ${TASK} still running — resuming tracking`), bridge.output);

  const card = async () => parseTasks(await fs.readFile(kanban, 'utf8')).find(c => c.task_id === TASK);
  // Byte-for-byte what mesh-task-daemon.js publishCollabEvent(eventType, session) sends.
  const publishCollabEvent = async (eventType, session) => {
    nc.publish(`mesh.events.collab.${eventType}`, sc.encode(JSON.stringify({
      event: eventType,
      session_id: session.session_id,
      task_id: session.task_id,
      session,
      timestamp: new Date().toISOString(),
    })));
    await nc.flush();
  };
  const publishEvent = async (eventType, task) => {
    nc.publish(`mesh.events.${eventType}`, sc.encode(JSON.stringify({
      event: eventType, task_id: task.task_id, task, timestamp: new Date().toISOString(),
    })));
    await nc.flush();
  };
  const nextActionBecomes = async (expected) => {
    try { await until(async () => (await card()).next_action === expected); }
    catch { assert.fail(`next_action never became ${JSON.stringify(expected)}; card=${JSON.stringify(await card())}\n${bridge.output}`); }
  };
  return { bridge, card, publishCollabEvent, publishEvent, nextActionBecomes };
}

test('collab session events reach the kanban card and collab.completed does not complete the task', { skip, timeout: 60_000 }, async (t) => {
  const { bridge, card, publishCollabEvent, publishEvent, nextActionBecomes } = await fixture(t);
  const store = new CollabStore(memoryKv());
  const created = createSession(TASK, { mode: 'parallel', min_nodes: 2, max_nodes: 2, max_rounds: 3 });
  const id = created.session_id;
  await store.put(created);

  await publishCollabEvent('created', await store.get(id));
  await nextActionBecomes('Collab session created (mode: parallel). Recruiting 2+ nodes...');

  await store.addNode(id, 'node-a');
  await store.addNode(id, 'node-b');
  await publishCollabEvent('joined', await store.get(id));
  await nextActionBecomes('2 nodes joined. Recruiting...');

  await store.startRound(id);
  await publishCollabEvent('round_started', await store.get(id));
  await nextActionBecomes('Round 1/3 in progress (2 nodes)');

  await store.submitReflection(id, { node_id: 'node-a', summary: 'A wrote a.txt', artifacts: ['a.txt'], vote: 'converged' });
  await publishCollabEvent('reflection_received', await store.get(id));
  await nextActionBecomes('R1: 1/2 reflections received');

  await store.submitReflection(id, { node_id: 'node-b', summary: 'B wrote b.txt', artifacts: ['b.txt'], vote: 'converged' });
  await store.markConverged(id);
  await publishCollabEvent('converged', await store.get(id));
  await nextActionBecomes('Converged after 1 rounds. Collecting artifacts...');

  const contributions = { 'node-a': 'A wrote a.txt', 'node-b': 'B wrote b.txt' };
  await store.markCompleted(id, { artifacts: ['a.txt', 'b.txt'], summary: 'Converged after 1 rounds with 2 nodes', node_contributions: contributions });
  await publishCollabEvent('completed', await store.get(id));
  await nextActionBecomes('Collab completed: 1 rounds, 2 nodes. 2 artifact(s). Converged after 1 rounds with 2 nodes');

  // The session finishing is not the task finishing: the card keeps its status, the
  // result is recorded, and the bridge still owns the task (no slot freed).
  const afterCollab = await card();
  assert.equal(afterCollab.status, 'running');
  assert.deepEqual(afterCollab.collab_result, {
    rounds_taken: 1, node_contributions: contributions, artifacts: ['a.txt', 'b.txt'], summary: 'Converged after 1 rounds with 2 nodes',
  });
  assert.ok(!bridge.output.includes('SLOT FREED'), bridge.output);
  assert.ok(!/ERROR (handling|parsing) event/.test(bridge.output), bridge.output);

  // Aborted session events are session-scoped too: logged, never a task transition.
  await publishCollabEvent('aborted', { ...(await store.get(id)), status: 'aborted', result: { success: false, summary: 'operator abort', aborted: true } });
  await until(() => bridge.output.includes(`COLLAB ABORTED: ${TASK} — operator abort`));
  assert.equal((await card()).status, 'running');

  // The daemon's own task-level completion is what moves the card.
  await publishEvent('completed', {
    task_id: TASK, status: 'completed', owner: 'node-a',
    started_at: '2026-11-16T14:00:00.000Z', completed_at: '2026-11-16T14:00:42.000Z',
    attempts: [{ approach: 'collab', result: 'converged' }],
    result: { success: true, summary: 'Converged after 1 rounds with 2 nodes' },
  });
  await until(async () => (await card()).status === 'waiting-user');
  assert.equal((await card()).next_action, 'Gui review — mesh completed in 42s (1 attempt)');
  assert.ok(bridge.output.includes(`SLOT FREED: ${TASK}`), bridge.output);
});
