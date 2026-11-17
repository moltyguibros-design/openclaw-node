#!/usr/bin/env node
/**
 * llm-run.test.js — the shared agent-CLI runner: process-group deadline,
 * outcome classification and shell-convention exit status, and how
 * runProvider applies a provider's argv, environment, cwd and parser.
 *
 * Run: node --test test/llm-run.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { runCli, runProvider, classifyRun } = require('../lib/llm-run');
const { PROVIDERS, parseClaudeJsonResult } = require('../lib/llm-providers');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-run-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const node = (code, opts = {}) => runCli({ binary: process.execPath, args: ['-e', code], timeoutMs: 10000, ...opts });

// An orphan nobody reaps stays a zombie, which kill(pid, 0) still finds.
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return true; }
}

describe('runCli outcome', () => {
  it('ok: exit 0 with output', async () => {
    const run = await node("process.stdout.write('answer')");
    assert.equal(run.outcome, 'ok');
    assert.equal(run.exitStatus, 0);
    assert.equal(run.stdout, 'answer');
  });

  it('empty: exit 0 with nothing but whitespace on stdout', async () => {
    const run = await node("process.stdout.write('  \\n'); process.stderr.write('logged in?')");
    assert.equal(run.outcome, 'empty');
    assert.equal(run.exitCode, 0);
  });

  it('nonzero: the CLI\'s own code is the exit status', async () => {
    const run = await node("process.stderr.write('quota exceeded'); process.exit(3)");
    assert.equal(run.outcome, 'nonzero');
    assert.equal(run.exitStatus, 3);
    assert.equal(run.stderr, 'quota exceeded');
  });

  it('spawn_failed: a missing binary is 127, not a hang or a throw', async () => {
    const run = await runCli({ binary: path.join(TMP, 'no-such-cli'), args: [], timeoutMs: 10000 });
    assert.equal(run.outcome, 'spawn_failed');
    assert.equal(run.exitStatus, 127);
    assert.match(run.stderr, /ENOENT/);
  });

  it('signaled: killed by a signal it was not sent by the deadline', async () => {
    const run = await node("process.kill(process.pid, 'SIGKILL')");
    assert.equal(run.outcome, 'signaled');
    assert.equal(run.signal, 'SIGKILL');
    assert.equal(run.exitStatus, 137);
  });

  // mesh-core~2#24: verdicts and reflections are read from the end, so a capped
  // capture keeps both ends, marks the cut, and says it was truncated.
  it('caps captured output to its head and tail, marks the dropped middle and reports truncated', async () => {
    const run = await node("process.stdout.write('H'.repeat(100) + 'x'.repeat(5000) + 'T'.repeat(100))", { outputHead: 100, outputTail: 100 });
    assert.equal(run.truncated, true);
    assert.ok(run.stdout.startsWith('H'.repeat(100)), run.stdout.slice(0, 120));
    assert.ok(run.stdout.endsWith('T'.repeat(100)), run.stdout.slice(-120));
    assert.match(run.stdout, /output truncated: 5000 characters dropped/);
    const small = await node("process.stdout.write('answer')");
    assert.equal(small.truncated, false);
  });
});

describe('runCli abort', () => {
  it('an abort signal stops the whole process group, children included', async () => {
    const pidFile = path.join(TMP, 'abort-grandchild.pid');
    const code = `
      const { spawn } = require('child_process');
      const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
      setInterval(() => {}, 1000);`;
    const ac = new AbortController();
    const running = node(code, { signal: ac.signal, killGraceMs: 200 });
    while (!fs.existsSync(pidFile)) await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    const run = await running;
    assert.equal(run.timedOut, false);
    assert.notEqual(run.exitCode, 0);
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(alive(grandchild), false, 'the grandchild in the group was stopped too');
  });

  it('a signal aborted before the spawn stops the run at once', async () => {
    const ac = new AbortController();
    ac.abort();
    const started = Date.now();
    const run = await node('setInterval(() => {}, 1000)', { signal: ac.signal, killGraceMs: 200 });
    assert.ok(Date.now() - started < 5000);
    assert.notEqual(run.exitCode, 0);
  });
});

describe('runCli deadline', () => {
  it('kills the whole process group, children included, and reports 124', async () => {
    const pidFile = path.join(TMP, 'grandchild.pid');
    const code = `
      const { spawn } = require('child_process');
      const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
      setInterval(() => {}, 1000);`;
    const run = await node(code, { timeoutMs: 500, killGraceMs: 200 });
    assert.equal(run.outcome, 'timeout');
    assert.equal(run.timedOut, true);
    assert.equal(run.exitStatus, 124);
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(alive(grandchild), false, 'the CLI\'s own child died with it');
  });

  it('a CLI that traps SIGTERM and exits 0 is still a timeout', async () => {
    const run = await node("process.on('SIGTERM', () => process.exit(0)); process.stdout.write('partial'); setInterval(() => {}, 1000)", { timeoutMs: 300 });
    assert.equal(run.exitCode, 0);
    assert.equal(run.outcome, 'timeout');
    assert.equal(run.exitStatus, 124);
  });

  it('a CLI that ignores SIGTERM is SIGKILLed after the grace', async () => {
    const started = Date.now();
    const run = await node("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", { timeoutMs: 300, killGraceMs: 200 });
    assert.equal(run.outcome, 'timeout');
    assert.equal(run.signal, 'SIGKILL');
    assert.ok(Date.now() - started < 5000);
  });
});

describe('classifyRun', () => {
  it('a spawn error wins over everything, then the deadline', () => {
    assert.equal(classifyRun({ spawnError: 'ENOENT', timedOut: true, exitCode: 127 }), 'spawn_failed');
    assert.equal(classifyRun({ timedOut: true, exitCode: 0, stdout: 'x' }), 'timeout');
  });
});

describe('runProvider', () => {
  const stub = (overrides) => ({ name: 'stub', binary: process.execPath, cleanEnv: (env) => ({ ...env }), ...overrides });

  it('classifies on the provider\'s parsed answer, not its raw record', async () => {
    const record = JSON.stringify({ type: 'result', result: '', total_cost_usd: 0.01, usage: {} });
    const run = await runProvider(stub({
      parseOutput: parseClaudeJsonResult,
      buildArgs: () => ['-e', `process.stdout.write(${JSON.stringify(record)})`],
    }), { prompt: 'p', timeoutMs: 10000, cwd: TMP });
    assert.equal(run.stdout, '');
    assert.equal(run.outcome, 'empty');
    assert.equal(run.cost.estimatedCostUsd, 0.01);
  });

  it('passes the prompt, model, task and dirs to buildArgs and applies cleanEnv', async () => {
    let seen;
    const run = await runProvider(stub({
      buildArgs(...a) { seen = a; return ['-e', 'process.stdout.write(process.env.STUB_MARK + " " + process.cwd())']; },
      cleanEnv: (env) => ({ ...env, STUB_MARK: 'cleaned' }),
    }), { prompt: 'p', model: 'm', task: { task_id: 'T' }, targetDir: '/target', workspaceDir: '/ws', timeoutMs: 10000, cwd: TMP });
    assert.deepEqual(seen, ['p', 'm', { task_id: 'T' }, '/target', '/ws']);
    assert.equal(run.stdout, `cleaned ${fs.realpathSync(TMP)}`);
    assert.equal(run.provider, 'stub');
    assert.equal(run.model, 'm');
  });

  it('a provider that works on its cwd (aider) runs inside the target, not the caller\'s work dir', async () => {
    const target = fs.mkdtempSync(path.join(TMP, 'target-'));
    const run = await runProvider({
      ...PROVIDERS.aider,
      binary: process.execPath,
      buildArgs: () => ['-e', 'process.stdout.write(process.cwd())'],
    }, { prompt: 'p', targetDir: target, timeoutMs: 10000, cwd: TMP });
    assert.equal(run.stdout, fs.realpathSync(target));
  });

  it('onSpawn sees the child and the argv that ran', async () => {
    let info;
    await runProvider(stub({ buildArgs: () => ['-e', "process.stdout.write('x')"] }), {
      prompt: 'p', timeoutMs: 10000, cwd: TMP,
      onSpawn(child, i) { info = { pid: child.pid, ...i }; },
    });
    assert.ok(info.pid > 0);
    assert.deepEqual(info.args, ['-e', "process.stdout.write('x')"]);
    assert.equal(info.cwd, TMP);
  });
});
