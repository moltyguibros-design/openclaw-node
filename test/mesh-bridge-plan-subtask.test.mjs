/**
 * mesh-bridge-plan-subtask.test.mjs — audit mesh-core#14 (operator choice B).
 * The real bin/mesh-bridge.js against a real nats-server and a real
 * active-tasks.md; the test plays the daemon's plan subjects.
 *
 * Nothing reported a local, soul or human plan subtask: the bridge put its card
 * on the board and no component ever sent mesh.plans.subtask.update, so any
 * plan holding one stayed executing forever. The bridge now stamps the card
 * with its plan_id and, when the card reaches done, sends a signed update.
 *
 * Run: node --test test/mesh-bridge-plan-subtask.test.mjs
 */
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
import { getOrCreateIdentity } from '../lib/node-identity.mjs';
import { verifyOperatorRequest } from '../lib/operator-auth.mjs';

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('nats');
const { parseTasks } = require('../lib/kanban-io');
const sc = StringCodec();
const entry = fileURLToPath(new URL('../bin/mesh-bridge.js', import.meta.url));
const skip = natsServerBin() ? false : 'nats-server not found on PATH';

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail('condition deadline exceeded');
}

const card = (id, status, planId) => [
  `- task_id: ${id}`,
  `  title: ${id}`,
  `  status: ${status}`,
  '  parent_id: PARENT',
  `  plan_id: ${planId}`,
  '',
].join('\n');

test('kanban-io reads the plan_id a materialized card carries', () => {
  const [t] = parseTasks(`## Live Tasks\n\n${card('P-L1', 'done', 'PLAN-1')}`);
  assert.equal(t.plan_id, 'PLAN-1');
});

test('a materialized subtask card that reaches done is reported once, signed', { skip, timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-bridge-plan-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) proc.kill('SIGKILL');
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  const identityDir = path.join(home, '.openclaw');
  const memory = path.join(identityDir, 'workspace', 'memory');
  await fs.mkdir(memory, { recursive: true, mode: 0o700 });
  const identity = getOrCreateIdentity(identityDir);
  const kanban = path.join(memory, 'active-tasks.md');
  // P-L3 is from before a restart: done on the board, already completed in the daemon.
  await fs.writeFile(kanban, ['# fixture', '', '## Live Tasks', '', card('P-L3', 'done', 'PLAN-1')].join('\n'), { mode: 0o600 });

  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);

  nc = await connect({ servers: `nats://127.0.0.1:${port}`, token, maxReconnectAttempts: 0 });
  const updates = [];
  // Cards carry the plan-namespaced kanban_task_id; P-L3 was queued before that
  // existed, so its card id is its bare subtask id.
  const kanbanIds = { L1: 'P-L1', L2: 'P-L2', 'P-L3': undefined };
  const statuses = { L1: 'queued', L2: 'queued', 'P-L3': 'completed' };
  nc.subscribe('mesh.plans.get', { callback: (_err, msg) => {
    const subtasks = Object.entries(statuses).map(([subtask_id, status]) => ({ subtask_id, kanban_task_id: kanbanIds[subtask_id], status }));
    msg.respond(sc.encode(JSON.stringify({ ok: true, data: { plan_id: 'PLAN-1', subtasks } })));
  } });
  nc.subscribe('mesh.plans.subtask.update', { callback: (_err, msg) => {
    const body = JSON.parse(sc.decode(msg.data));
    updates.push(body);
    statuses[body.subtask_id] = body.status;
    msg.respond(sc.encode('{"ok":true,"data":{}}'));
  } });
  nc.subscribe('mesh.tasks.get', { callback: (_err, msg) => msg.respond(sc.encode('{"ok":true,"data":null}')) });
  await nc.flush();

  const proc = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      PATH: process.env.PATH, HOME: home, OPENCLAW_HOME: home, OPENCLAW_IDENTITY_DIR: identityDir,
      OPENCLAW_NODE_ID: 'plan-subtask-fixture',
      OPENCLAW_NATS: `nats://127.0.0.1:${port}`, OPENCLAW_NATS_TOKEN: token, OPENCLAW_NATS_AUTH: 'token',
      BRIDGE_DISPATCH_INTERVAL: '100',
      ...(process.env.NODE_PATH ? { NODE_PATH: process.env.NODE_PATH } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(proc);
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });

  await until(() => output.includes('Subscribed to mesh.events.>'), 15_000);
  // Exactly what the daemon's publishPlanEvent sends when it dispatches the wave.
  nc.publish('mesh.events.plan.wave_started', sc.encode(JSON.stringify({
    event: 'wave_started', plan_id: 'PLAN-1', parent_task_id: 'PARENT',
    plan: {
      plan_id: 'PLAN-1', parent_task_id: 'PARENT',
      subtasks: ['L1', 'L2'].map((subtask_id) => ({ subtask_id, kanban_task_id: kanbanIds[subtask_id], title: subtask_id, status: 'queued', delegation: { mode: 'local' }, budget_minutes: 5 })),
    },
  })));
  await until(async () => parseTasks(await fs.readFile(kanban, 'utf8')).length === 3, 10_000)
    .catch(() => assert.fail(`the wave was not materialized:\n${output}`));
  const materialized = parseTasks(await fs.readFile(kanban, 'utf8')).filter((x) => x.task_id !== 'P-L3');
  assert.deepEqual(materialized.map((x) => [x.task_id, x.plan_id]), [['P-L1', 'PLAN-1'], ['P-L2', 'PLAN-1']]);
  await delay(300);
  assert.equal(updates.length, 0, 'nothing is reported before a card is done');

  // The operator (or Daedalus) finishes P-L1 on the board.
  const text = await fs.readFile(kanban, 'utf8');
  await fs.writeFile(kanban, text.replace(/(- task_id: P-L1\n(?:  .*\n)*?  status: )queued/, '$1done'));

  await until(() => updates.length > 0, 15_000).catch(() => assert.fail(`no subtask update sent:\n${output}`));
  await delay(600);
  assert.equal(updates.length, 1, `exactly one report:\n${output}`);
  const [u] = updates;
  assert.equal(u.plan_id, 'PLAN-1');
  assert.equal(u.subtask_id, 'L1', 'the report names the subtask, not its card');
  assert.equal(u.status, 'completed');
  const verdict = verifyOperatorRequest(u, { trustedKeys: [identity.publicKeyBase64], seenIds: null });
  assert.equal(verdict.ok, true, `the daemon requires an operator signature: ${verdict.reason}`);
});
