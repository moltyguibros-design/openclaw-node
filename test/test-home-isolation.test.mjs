/**
 * test-home-isolation.test.mjs — suites whose code paths write under
 * ~/.openclaw (the Mission Control observability DB, the injection log) keep
 * those writes off the real HOME: run alone with an empty HOME, they leave it
 * empty. Without this a plain `npm test` on a node put fake trace rows into
 * the production Mission Control DB.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpDir } from './helpers/tmp-dir.cjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_DIR, '..');

function runSuite(suite, home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, ...extraEnv };
  for (const k of ['OPENCLAW_OBS_DB', 'OPENCLAW_WORKSPACE', 'INJECTION_LOG_DISABLED', 'INJECTION_LOG_PATH', 'NODE_TEST_CONTEXT']) delete env[k];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', join(TEST_DIR, suite)], { cwd: ROOT, env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (status) => resolve({ status, out }));
  });
}

for (const suite of [
  'mesh-plans.test.js',
  'mesh-tasks-status.test.js',
  'nats-resolve.test.js',
  'node-init-mesh-code.test.mjs',
  'mesh-memory-bridge.test.mjs',
]) {
  test(`${suite} leaves an empty HOME empty`, { timeout: 120_000 }, async () => {
    const home = tmpDir('home-iso-');
    const r = await runSuite(suite, home);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(readdirSync(home, { recursive: true }), []);
  });
}

for (const suite of ['memory-injector.test.mjs', 'memory-inject-server.test.mjs']) {
  test(`${suite} sends no request to the LLM and leaves an empty HOME empty`, { timeout: 120_000 }, async (t) => {
    let llmRequests = 0;
    const llm = createServer((req, res) => { llmRequests++; res.writeHead(503).end(); });
    await new Promise((resolve) => llm.listen(0, '127.0.0.1', resolve));
    t.after(() => llm.close());
    const home = tmpDir('home-iso-');
    const r = await runSuite(suite, home, { LLM_BASE_URL: `http://127.0.0.1:${llm.address().port}` });
    assert.equal(r.status, 0, r.out);
    assert.equal(llmRequests, 0);
    assert.deepEqual(readdirSync(home, { recursive: true }), []);
  });
}
