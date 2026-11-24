/**
 * mesh-bridge-trigger-gate.test.mjs — audit mission-control-lib#4, the bridge
 * half. The real bin/mesh-bridge.js against a real nats-server and a real
 * active-tasks.md; the test answers mesh.tasks.submit itself.
 *
 * The bridge submitted every queued mesh card at once and ignored triggers,
 * so a recurring mesh task (recreated as a queued cron card on each
 * completion) ran again immediately. A card with a trigger is due only once
 * Mission Control's scheduler flips it to 'ready'.
 *
 * Run: node --test test/mesh-bridge-trigger-gate.test.mjs
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

const require = createRequire(import.meta.url);
const { connect, StringCodec } = require('nats');
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

const card = (id, status, trigger, priority) => [
  `- task_id: ${id}`,
  `  title: ${id}`,
  `  status: ${status}`,
  '  execution: mesh',
  `  auto_priority: ${priority}`,
  ...(trigger ? [`  trigger_kind: ${trigger}`, '  trigger_cron: 0 10 * * *'] : []),
  '',
].join('\n');

test('a triggered mesh card waits for ready; a ready one dispatches', { skip, timeout: 30_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mesh-bridge-trigger-'));
  const children = [];
  let nc;
  t.after(async () => {
    if (nc) await nc.close();
    for (const proc of children.reverse()) proc.kill('SIGKILL');
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.chmod(root, 0o700);
  const home = path.join(root, 'home');
  const memory = path.join(home, '.openclaw', 'workspace', 'memory');
  await fs.mkdir(memory, { recursive: true, mode: 0o700 });
  // The waiting cron card has the highest priority, so the old bridge picked it first.
  await fs.writeFile(path.join(memory, 'active-tasks.md'), [
    '# fixture', '', '## Live Tasks', '',
    card('R-WAITING', 'queued', 'cron', 9),
    card('R-DUE', 'ready', 'cron', 1),
  ].join('\n'), { mode: 0o600 });

  const port = await freePort();
  const token = randomBytes(32).toString('hex');
  const config = path.join(root, 'nats.conf');
  await fs.writeFile(config, `listen: 127.0.0.1:${port}\nauthorization { token: ${JSON.stringify(token)} }\n`, { mode: 0o600 });
  const server = await startNatsServer(config);
  children.push(server.proc);

  nc = await connect({ servers: `nats://127.0.0.1:${port}`, token, maxReconnectAttempts: 0 });
  const submitted = [];
  nc.subscribe('mesh.tasks.submit', { callback: (_err, msg) => {
    const body = JSON.parse(sc.decode(msg.data));
    submitted.push(body.task_id);
    msg.respond(sc.encode(JSON.stringify({ ok: true, data: { task_id: body.task_id, budget_minutes: 30 } })));
  } });
  nc.subscribe('mesh.tasks.get', { callback: (_err, msg) => msg.respond(sc.encode('{"ok":true,"data":null}')) });
  await nc.flush();

  const proc = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      PATH: process.env.PATH, HOME: home, OPENCLAW_HOME: home,
      OPENCLAW_IDENTITY_DIR: path.join(home, '.openclaw'),
      OPENCLAW_NODE_ID: 'trigger-gate-fixture',
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

  await until(() => submitted.length > 0, 15_000).catch(() => assert.fail(`nothing submitted:\n${output}`));
  assert.equal(submitted[0], 'R-DUE', 'the card MC flipped to ready is dispatched');
  await delay(500);
  assert.ok(!submitted.includes('R-WAITING'), `a queued cron card must wait for its trigger:\n${output}`);
});
