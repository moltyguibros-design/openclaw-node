/**
 * nats-server-helper.test.mjs — the shared nats-server helper every NATS suite
 * uses, exercised against a stand-in binary (no real nats-server needed).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNatsServer, writeServerConfig } from './helpers/nats-server.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('startNatsServer().stop()', () => {
  let dir, stubborn;
  const started = [];
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-helper-'));
    stubborn = path.join(dir, 'nats-server');
    fs.writeFileSync(stubborn, `#!${process.execPath}\n` +
      "process.on('SIGTERM', () => {});\n" +
      "console.log('Listening for client connections on 127.0.0.1:0');\n" +
      'setInterval(() => {}, 1000);\n');
    fs.chmodSync(stubborn, 0o755);
  });
  after(() => {
    for (const s of started) s.proc.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('SIGKILLs a server that ignores SIGTERM instead of hanging the teardown', { timeout: 10_000 }, async () => {
    const server = await startNatsServer(path.join(dir, 'unused.conf'), { bin: stubborn });
    started.push(server);
    await server.stop();
    assert.equal(server.proc.signalCode, 'SIGKILL');
  });

  it('resolves at once for a server a test already killed by signal', { timeout: 10_000 }, async () => {
    const server = await startNatsServer(path.join(dir, 'unused.conf'), { bin: stubborn });
    started.push(server);
    server.proc.kill('SIGKILL');
    await new Promise((res) => server.proc.once('exit', res));
    await server.stop();
  });
});

describe('writeServerConfig', () => {
  it('omits the nats-auth.conf include for an unauthenticated suite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-helper-conf-'));
    try {
      assert.match(fs.readFileSync(writeServerConfig(dir, 4999), 'utf8'), /include "nats-auth\.conf"/);
      const open = fs.readFileSync(writeServerConfig(dir, 4999, { auth: false }), 'utf8');
      assert.doesNotMatch(open, /include/);
      assert.match(open, /^listen: 127\.0\.0\.1:4999$/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// tests#15: five suites and the census each ran their own `which nats-server`,
// so a NATS_SERVER_BIN-only machine had the census call the tier skipped while
// it ran, and fixed ports and unawaited kills drifted per copy.
it('no test file looks up nats-server itself; all go through helpers/nats-server.mjs', () => {
  const offenders = fs.readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(js|mjs)$/.test(f) && f !== path.basename(fileURLToPath(import.meta.url)))
    .filter((f) => /which nats-server/.test(fs.readFileSync(path.join(TEST_DIR, f), 'utf8')));
  assert.deepEqual(offenders, []);
});
