import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

test('watchdog stays alive without logs and attaches when a gateway log appears', { timeout: 30_000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'lane-watchdog-'));
  const stub = join(home, 'stub');
  mkdirSync(stub);
  writeFileSync(join(stub, 'pgrep'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/lane-watchdog.js', import.meta.url))], {
    env: { HOME: home, PATH: `${stub}:/usr/bin:/bin` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const stopped = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await stopped;
    rmSync(home, { recursive: true, force: true });
  });
  async function waitFor(predicate, timeout) {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (predicate()) return;
      assert.equal(child.exitCode, null, output);
      await delay(30);
    }
    assert.fail(output);
  }
  await waitFor(() => output.includes('Lane watchdog active'), 3000);
  await delay(300);
  assert.equal(child.exitCode, null, 'missing files must not cause the service to exit');
  writeFileSync(join(home, '.openclaw/logs/gateway.log'), 'owned fixture log\n');
  await waitFor(() => output.includes('Tailing gateway.log'), 20_000);
  assert.doesNotMatch(output, /INTERVENTION|SIGUSR1 sent/);
  child.kill('SIGTERM');
  assert.deepEqual(await stopped, { code: 0, signal: null });
});
