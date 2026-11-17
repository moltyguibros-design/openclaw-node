/**
 * fed-chaos.test.mjs — the step 3.5 chaos harness runs from any checkout, kills
 * only what it started, and really runs its task daemon on a short step budget.
 *
 * It hard-coded one machine's checkout path, killed every bin/mesh-agent.js on
 * the machine (`pkill -9 -f`, and a `pgrep … | head -1` for "one member"),
 * claimed to set MESH_CIRCLING_STEP_TIMEOUT_MS without doing it (the service
 * units pin 30 min, so the C1 timeout cell could never resolve in budget), and
 * loaded nats through a node_modules path. Its two retired siblings
 * (grappe-benchmark, fed-benchmark-driver) are deleted.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REPO, CHAOS_STEP_TIMEOUT_MS, createProcessPool, daemonEnv, agentEnv } from '../bin/fed-chaos.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bin', 'fed-chaos.mjs'), 'utf8');

describe('fed-chaos harness', () => {
  it('runs from the checkout it lives in and loads nats by package name', () => {
    assert.equal(REPO, ROOT);
    assert.doesNotMatch(SRC, /\/Users\//);
    assert.doesNotMatch(SRC, /node_modules\/nats/);
  });

  it('its task daemon gets the short circling step budget; agents are mock workers', () => {
    assert.equal(daemonEnv({}).MESH_CIRCLING_STEP_TIMEOUT_MS, CHAOS_STEP_TIMEOUT_MS);
    assert.ok(Number(CHAOS_STEP_TIMEOUT_MS) < 60_000);
    const env = agentEnv('alpha', { CLAUDECODE: '1' });
    assert.equal(env.MESH_LLM_PROVIDER, 'shell');
    assert.equal(env.OPENCLAW_NODE_ID, 'alpha');
    assert.ok(!('CLAUDECODE' in env));
  });

  it('kills only the process groups it started, never by name', () => {
    assert.doesNotMatch(SRC, /\bpkill\b|\bpgrep\b/);
    const killed = [];
    let next = 100;
    const pool = createProcessPool({
      spawnFn: (cmd, args, opts) => { assert.equal(opts.detached, true); return { pid: next++, unref() {} }; },
      killFn: (pid, sig) => killed.push([pid, sig]),
    });
    const log = path.join(fs.mkdtempSync(path.join(ROOT, '.tmp-fed-chaos-')), 'x.log');
    try {
      pool.start('daemon', 'bin/mesh-task-daemon.js', {}, log);
      pool.start('agent:alpha', 'bin/mesh-agent.js', {}, log);
      pool.start('agent:bravo', 'bin/mesh-agent.js', {}, log);
      pool.kill('agent:bravo');
      pool.killMatching('agent:');
      assert.deepEqual(killed, [[-102, 'SIGKILL'], [-101, 'SIGKILL']]);
      assert.deepEqual(pool.names(), ['daemon']);
      assert.equal(pool.kill('agent:alpha'), false, 'a name it no longer holds kills nothing');
    } finally {
      fs.rmSync(path.dirname(log), { recursive: true, force: true });
    }
  });

  it('a real kill leaves an unrelated mesh-agent.js process running', async () => {
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'bin/mesh-agent.js'], { stdio: 'ignore' });
    const pool = createProcessPool({
      spawnFn: () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }),
    });
    const dir = fs.mkdtempSync(path.join(ROOT, '.tmp-fed-chaos-'));
    try {
      const pid = pool.start('agent:alpha', 'bin/mesh-agent.js', {}, path.join(dir, 'x.log'));
      pool.killMatching('agent:');
      await new Promise(r => setTimeout(r, 200));
      assert.throws(() => process.kill(pid, 0), 'the started agent survived');
      assert.doesNotThrow(() => process.kill(bystander.pid, 0), 'an agent the harness did not start was killed');
    } finally {
      bystander.kill('SIGKILL');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the retired benchmark tools are gone', () => {
    for (const f of ['grappe-benchmark.mjs', 'fed-benchmark-driver.mjs']) {
      assert.ok(!fs.existsSync(path.join(ROOT, 'bin', f)), `${f} still ships`);
    }
  });
});
