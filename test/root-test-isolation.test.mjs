import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('root test runner ignores a configured bus and removes its isolated bus', async () => {
  let contacts = 0;
  const inheritedBus = net.createServer(socket => {
    contacts++;
    socket.destroy();
  });
  await new Promise(resolve => inheritedBus.listen(0, '127.0.0.1', resolve));
  try {
    const address = inheritedBus.address();
    const inheritedUrl = `nats://127.0.0.1:${address.port}`;
    const child = spawn(process.execPath, [join(root, 'test', 'run-root-tests.mjs'), '--probe'], {
      cwd: root,
      env: { ...process.env, OPENCLAW_NATS: inheritedUrl, OPENCLAW_NATS_TOKEN: 'inherited-token' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 0, stderr);
    const probe = JSON.parse(stdout.trim());
    assert.equal(probe.isolated, true);
    assert.notEqual(probe.url, inheritedUrl);
    assert.equal(contacts, 0);
    assert.equal(existsSync(probe.home), false);

    const directEnv = { ...process.env, OPENCLAW_NATS: inheritedUrl, OPENCLAW_NATS_TOKEN: 'inherited-token', OPENCLAW_TEST_MESH_ISOLATED: '' };
    delete directEnv.NODE_TEST_CONTEXT;
    const direct = spawn(process.execPath, ['--test', join(root, 'test', 'distributed-mc.test.js')], {
      cwd: root,
      env: directEnv,
    });
    let directOutput = '';
    for (const stream of [direct.stdout, direct.stderr]) stream.on('data', chunk => { directOutput += chunk; });
    const directCode = await new Promise((resolve, reject) => {
      direct.once('error', reject);
      direct.once('exit', resolve);
    });
    assert.equal(directCode, 0, directOutput);
    assert.match(directOutput, /mesh integration requires the isolated root-test runner/);
    assert.equal(contacts, 0);
  } finally {
    await new Promise(resolve => inheritedBus.close(resolve));
  }
});
