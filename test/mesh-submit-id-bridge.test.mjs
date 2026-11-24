// `mesh submit --id` used to submit straight to the daemon and mark the card
// 'submitted'. The bridge only follows tasks it dispatched itself, so the claim,
// the result and the log write-back for that card were all dropped. The CLI now
// hands the card to the bridge (execution: mesh + mesh.bridge.wake), and this
// drives the real CLI and the real bridge against a stub daemon on a real bus.
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
const MESH = fileURLToPath(new URL('../bin/mesh.js', import.meta.url));
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

test('mesh submit --id queues the card for the bridge, which dispatches and tracks it', { skip, timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-submit-id-'));
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
  await fs.writeFile(kanban, '# Active Tasks\n\n## Live Tasks\n\n- task_id: cli-card\n  title: From the CLI\n  status: queued\n  updated_at: 2026-11-16\n', { mode: 0o600 });

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
    OPENCLAW_NODE_ID: 'submit-id-fixture',
    OPENCLAW_NATS: `nats://127.0.0.1:${port}`,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'token',
  };
  if (process.env.NODE_PATH) env.NODE_PATH = process.env.NODE_PATH;

  nc = await connect({ servers: env.OPENCLAW_NATS, token, maxReconnectAttempts: 0 });
  const submits = [];
  let wakes = 0;
  nc.subscribe('mesh.tasks.submit', { callback: (_err, msg) => {
    const req = JSON.parse(Buffer.from(msg.data).toString());
    submits.push(req);
    msg.respond(Buffer.from(JSON.stringify({ ok: true, data: { ...req, status: 'queued' } })));
  } });
  nc.subscribe('mesh.bridge.wake', { callback: () => { wakes++; } });
  await nc.flush();

  // A long poll interval: only the CLI's wake can make the bridge dispatch in time.
  const bridge = spawn(process.execPath, [BRIDGE], { cwd: root, env: { ...env, BRIDGE_DISPATCH_INTERVAL: '600000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(bridge);
  let out = '';
  bridge.stdout.on('data', (d) => { out += d; });
  bridge.stderr.on('data', (d) => { out += d; });
  await until(() => out.includes('RECONCILE: no orphaned mesh tasks found') && out.includes('Subscribed to mesh.events.>'));
  // The bridge's first poll ran before the card was handed over; wait for it to sleep.
  await delay(200);

  // Async, so the stub daemon above can still answer a CLI that submits directly.
  const cli = await new Promise((resolve) => {
    const proc = spawn(process.execPath, [MESH, 'submit', '--id', 'cli-card'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const r = { status: null, stdout: '', stderr: '' };
    proc.stdout.on('data', (d) => { r.stdout += d; });
    proc.stderr.on('data', (d) => { r.stderr += d; });
    proc.on('exit', (code) => { r.status = code; resolve(r); });
  });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  assert.match(cli.stdout, /Queued for mesh: cli-card/);
  await until(() => wakes === 1);

  await until(() => submits.length === 1, 10_000);
  assert.equal(submits[0].task_id, 'cli-card');
  await until(async () => parseTasks(await fs.readFile(kanban, 'utf8'))[0].status === 'submitted');
  let card = parseTasks(await fs.readFile(kanban, 'utf8'))[0];
  assert.equal(card.execution, 'mesh');

  // The bridge dispatched it, so it now follows the claim.
  nc.publish('mesh.events.claimed', Buffer.from(JSON.stringify({ event: 'claimed', task_id: 'cli-card', task: { task_id: 'cli-card', owner: 'node-a' } })));
  await nc.flush();
  await until(async () => parseTasks(await fs.readFile(kanban, 'utf8'))[0].status === 'running');
  card = parseTasks(await fs.readFile(kanban, 'utf8'))[0];
  assert.equal(card.owner, 'node-a');
  assert.equal(submits.length, 1);
});
