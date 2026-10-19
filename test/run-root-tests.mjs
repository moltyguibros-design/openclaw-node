#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { connect, nkeyAuthenticator, StringCodec } from 'nats';
import { renderAuthorization } from '../bin/nats-auth-render.mjs';
import { getOrCreateIdentity } from '../lib/node-identity.mjs';
import { freePort, natsServerBin } from './helpers/nats-server.mjs';

const require = createRequire(import.meta.url);
const { nkeyFromPrivateKey } = require('../lib/nats-nkey.js');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testDir = join(root, 'test');
const sc = StringCodec();

function terminate(child, signal = 'SIGTERM') {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.rootTestGroup) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* already exited */ }
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  terminate(child);
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) {
    terminate(child, 'SIGKILL');
    await exited;
  }
}

async function waitFor(check, child, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${label} exited before readiness`);
    try { if (await check()) return; } catch { /* startup in progress */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready`);
}

async function run() {
  const mode = process.argv[2];
  if (mode && !['--probe', '--integration'].includes(mode)) throw new Error(`unknown option: ${mode}`);
  const binary = natsServerBin();
  if (!binary) throw new Error('isolated root tests require nats-server on PATH');

  const home = mkdtempSync(join(tmpdir(), 'openclaw-root-tests-'));
  const identityDir = join(home, '.openclaw');
  const scratch = join(home, 'tmp');
  const store = join(home, 'jetstream');
  mkdirSync(identityDir);
  mkdirSync(scratch);
  mkdirSync(store);
  const port = await freePort();
  const url = `nats://127.0.0.1:${port}`;
  const token = randomBytes(32).toString('hex');
  const identity = getOrCreateIdentity(identityDir);
  const nkey = nkeyFromPrivateKey(identity.privateKey);
  const authenticator = nkeyAuthenticator(new TextEncoder().encode(nkey.seed));
  writeFileSync(join(home, 'nats-auth.conf'), renderAuthorization({
    mode: 'nkey', token, self: { nodeId: 'root-test-lead', nkey: nkey.publicNkey, role: 'lead' },
  }));
  const config = join(home, 'nats.conf');
  writeFileSync(config, `listen: 127.0.0.1:${port}\njetstream { store_dir: ${JSON.stringify(store)} }\ninclude "nats-auth.conf"\n`);
  const env = {
    ...process.env,
    HOME: home,
    OPENCLAW_HOME: home,
    OPENCLAW_IDENTITY_DIR: identityDir,
    OPENCLAW_NATS: url,
    OPENCLAW_NATS_TOKEN: token,
    OPENCLAW_NATS_AUTH: 'nkey',
    OPENCLAW_NODE_ID: 'root-test-lead',
    OPENCLAW_NODE_ROLE: 'lead',
    OPENCLAW_REQUIRE_MESH: '1',
    OPENCLAW_TEST_MESH_ISOLATED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    TMPDIR: scratch,
  };
  delete env.OPENCLAW_OPERATOR_TRUSTED_KEYS;

  let server;
  let daemon;
  let tests;
  let interrupted = null;
  const onSignal = signal => {
    interrupted = signal;
    terminate(tests, signal);
    terminate(daemon, signal);
    terminate(server, signal);
  };
  const onInt = () => onSignal('SIGINT');
  const onTerm = () => onSignal('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  let logs = '';
  try {
    server = spawn(binary, ['-c', config], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.on('error', () => {});
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
    await waitFor(async () => {
      const nc = await connect({ servers: url, authenticator, timeout: 400, maxReconnectAttempts: 0 });
      await nc.close();
      return true;
    }, server, 'isolated NATS');
    const unauthenticated = await connect({ servers: url, timeout: 400, maxReconnectAttempts: 0 })
      .then(async nc => { await nc.close(); return true; }, () => false);
    if (unauthenticated) throw new Error('isolated NATS accepted an unauthenticated connection');

    daemon = spawn(process.execPath, [join(root, 'bin', 'mesh-task-daemon.js')], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    daemon.on('error', () => {});
    for (const stream of [daemon.stdout, daemon.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
    const nc = await connect({ servers: url, authenticator, timeout: 2000, maxReconnectAttempts: 0 });
    try {
      await waitFor(async () => {
        const msg = await nc.request('mesh.tasks.list', sc.encode('{}'), { timeout: 400 });
        return JSON.parse(sc.decode(msg.data)).ok === true;
      }, daemon, 'isolated mesh-task-daemon');
    } finally { await nc.close(); }

    if (interrupted) throw new Error(`interrupted by ${interrupted}`);
    if (mode === '--probe') {
      console.log(JSON.stringify({ isolated: true, url, home }));
      return;
    }

    const files = mode === '--integration'
      ? [join(testDir, 'distributed-mc.test.js')]
      : readdirSync(testDir).filter(name => /\.test\.(?:js|mjs)$/.test(name)).sort().map(name => join(testDir, name));
    tests = spawn(process.execPath, ['--test', ...files], {
      cwd: root, env, stdio: 'inherit', detached: true,
    });
    tests.rootTestGroup = true;
    const code = await new Promise((resolve, reject) => {
      tests.once('error', reject);
      tests.once('exit', (exitCode, signal) => resolve(signal ? 128 + (signal === 'SIGINT' ? 2 : 15) : exitCode));
    });
    process.exitCode = code;
  } catch (error) {
    console.error(`isolated root test setup failed: ${error.message}`);
    if (logs) console.error(logs);
    process.exitCode = 1;
  } finally {
    await stop(tests);
    await stop(daemon);
    await stop(server);
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    rmSync(home, { recursive: true, force: true });
  }
}

await run();
