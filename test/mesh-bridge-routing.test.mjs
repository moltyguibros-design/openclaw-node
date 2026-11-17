// The daemon publishes plan and collab events with a bare payload.event
// ('wave_started', 'circling_gate', 'completed'); only the subject carries the
// plan./collab. prefix. The bridge routed on payload.event, so its plan and collab
// handlers never ran and a collab 'completed' fell into the task-completed path.
// This feeds the real bridge payloads shaped exactly as the daemon (and Mission
// Control's operator interventions) publish them.
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

const require = createRequire(import.meta.url);
const { connect } = require('nats');
const { parseTasks } = require('../lib/kanban-io');
const BRIDGE = fileURLToPath(new URL('../bin/mesh-bridge.js', import.meta.url));
const skip = natsServerBin() ? false : 'nats-server not found on PATH';

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('condition deadline exceeded');
}

// Payload shapes copied from bin/mesh-task-daemon.js publishPlanEvent / publishCollabEvent.
const planEvent = (type, plan) => [`mesh.events.plan.${type}`, { event: type, plan_id: plan.plan_id, parent_task_id: plan.parent_task_id, plan, timestamp: new Date().toISOString() }];
const collabEvent = (type, session) => [`mesh.events.collab.${type}`, { event: type, session_id: session.session_id, task_id: session.task_id, session, timestamp: new Date().toISOString() }];

test('bridge routes real daemon plan and collab events to their kanban handlers', { skip, timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-bridge-routing-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
    }
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  const memory = path.join(home, '.openclaw', 'workspace', 'memory');
  await fs.mkdir(memory, { recursive: true, mode: 0o700 });
  const kanban = path.join(memory, 'active-tasks.md');
  await fs.writeFile(kanban, [
    '# Active Tasks', '', '## Live Tasks', '',
    '- task_id: parent-1', '  title: Planned parent', '  status: running', '  execution: mesh', '  owner: mesh', '  updated_at: 2026-11-16',
    '- task_id: collab-1', '  title: Circling task', '  status: running', '  execution: mesh', '  owner: mesh', '  updated_at: 2026-11-16', '',
  ].join('\n'), { mode: 0o600 });
  const card = async (id) => parseTasks(await fs.readFile(kanban, 'utf8')).find(x => x.task_id === id);

  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
    OPENCLAW_NODE_ID: 'routing-fixture',
    OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
    BRIDGE_DISPATCH_INTERVAL: '600000',
  };
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;

  nc = await connect({ servers: env.OPENCLAW_NATS, token, maxReconnectAttempts: 0 });
  // Reconcile resumes tracking both running cards, so the bridge owns them.
  nc.subscribe('mesh.tasks.get', { callback: (_err, msg) => {
    const { task_id } = JSON.parse(Buffer.from(msg.data).toString());
    msg.respond(Buffer.from(JSON.stringify({ ok: true, data: { task_id, status: 'running' } })));
  } });
  await nc.flush();

  const bridge = spawn(process.execPath, [BRIDGE], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(bridge);
  let out = '';
  bridge.stdout.on('data', (d) => { out += d; });
  bridge.stderr.on('data', (d) => { out += d; });
  await until(() => out.includes('Tracking 2 in-flight task(s)') && out.includes('Subscribed to mesh.events.>'));
  const send = async ([subject, payload]) => { nc.publish(subject, Buffer.from(JSON.stringify(payload))); await nc.flush(); };

  const plan = {
    plan_id: 'PLAN-1', parent_task_id: 'parent-1',
    subtasks: [
      { subtask_id: 'PLAN-1-S1', title: 'Local step', status: 'queued', delegation: { mode: 'local' }, description: 'do it', budget_minutes: 5 },
      { subtask_id: 'PLAN-1-S2', title: 'Mesh step', status: 'queued', delegation: { mode: 'solo_mesh' }, budget_minutes: 5 },
    ],
  };
  await send(planEvent('wave_started', plan));
  await until(async () => (await card('PLAN-1-S1')) && (await card('parent-1')).next_action === 'Plan executing: 0/2 subtasks done');
  assert.equal(await card('PLAN-1-S2'), undefined);
  assert.equal((await card('PLAN-1-S1')).parent_id, 'parent-1');
  assert.equal((await card('PLAN-1-S1')).plan_id, 'PLAN-1', 'the card carries plan_id, so its done state is reported back');

  await send(planEvent('aborted', plan));
  await until(async () => (await card('parent-1')).status === 'blocked');
  assert.equal((await card('parent-1')).next_action, 'Plan aborted — needs triage');

  const session = { session_id: 'collab-collab-1', task_id: 'collab-1', nodes: [{}, {}], circling: { phase: 'circling', current_subround: 2 }, rounds: [{ reflections: [] }] };
  await send(collabEvent('circling_gate', session));
  await until(async () => (await card('collab-1')).status === 'waiting-user');
  assert.match((await card('collab-1')).next_action, /^\[GATE\] SR2 complete/);
  assert.match((await card('collab-1')).next_action, /mesh collab gate approve\|reject collab-collab-1$/);

  // Mission Control's force-converge carries no session object.
  await send(['mesh.events.collab.converged', { session_id: session.session_id, task_id: 'collab-1', forced: true }]);
  await until(async () => (await card('collab-1')).next_action === 'Converged after ? rounds. Collecting artifacts...');

  // A collab 'completed' is not the task's completion: it must not reach handleCompleted.
  await send(collabEvent('completed', { ...session, result: { rounds_taken: 3, node_contributions: { a: 1, b: 1 }, artifacts: [], summary: 'done' } }));
  await until(async () => (await card('collab-1')).next_action?.startsWith('Collab completed: 3 rounds, 2 nodes.'));
  assert.equal((await card('collab-1')).status, 'waiting-user');
  assert.doesNotMatch(out, /ERROR|EVENT IGNORED/, out);
});
