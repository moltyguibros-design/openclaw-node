import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/trust-registry', import.meta.url));

function fixture(t, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-registry-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = path.join(root, 'ws');
  fs.mkdirSync(path.join(ws, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(ws, '.tmp'), { recursive: true });
  const bin = path.join(ws, 'bin', 'trust-registry');
  fs.copyFileSync(script, bin);
  fs.chmodSync(bin, 0o755);
  const file = path.join(ws, '.tmp', 'trust-registry.json');
  fs.writeFileSync(file, JSON.stringify(registry));
  const run = (...args) => spawnSync('python3', [bin, ...args], {
    env: { ...process.env, HOME: root }, encoding: 'utf8',
  });
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { root, ws, bin, file, run, read };
}

test('a half-open probe that never reported is replaced after the cooldown, and the new probe is exclusive', t => {
  const { run, read } = fixture(t, {
    souls: { s1: { circuit_state: 'half_open', last_probe_at: '2020-01-01T00:00:00', cooldown_minutes: 30 } },
    delegations: [],
  });
  const first = run('check', 's1');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /new probe allowed/);
  const saved = read().souls.s1;
  assert.equal(saved.circuit_state, 'half_open');
  assert.notEqual(saved.last_probe_at, '2020-01-01T00:00:00');

  const second = run('check', 's1');
  assert.equal(second.status, 1, second.stdout + second.stderr);
  assert.match(second.stdout, /probe in progress/);
});

test('a half-open soul without last_probe_at allows a probe', t => {
  const { run, read } = fixture(t, {
    souls: { s1: { circuit_state: 'half_open', cooldown_minutes: 30 } },
    delegations: [],
  });
  const r = run('check', 's1');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /new probe allowed/);
  assert.ok(read().souls.s1.last_probe_at);
});

test('update waits for the registry lock held by another writer', async t => {
  const { ws, bin, run, read } = fixture(t, { souls: {}, delegations: [] });
  const holder = spawn('python3', ['-c', [
    'import fcntl, time',
    `fh = open(${JSON.stringify(path.join(ws, '.tmp', 'trust-registry.lock'))}, "a")`,
    'fcntl.flock(fh, fcntl.LOCK_EX)',
    'print("locked", flush=True)',
    'time.sleep(1.0)',
  ].join('\n')]);
  t.after(() => holder.kill());
  await new Promise((resolve, reject) => {
    holder.stdout.on('data', d => { if (String(d).includes('locked')) resolve(); });
    holder.on('error', reject);
    holder.on('exit', () => reject(new Error('lock holder exited before locking')));
  });
  const started = Date.now();
  const status = await new Promise(resolve => {
    spawn('python3', [bin, 'update', 's1', '--result', 'success']).on('exit', resolve);
  });
  const elapsed = Date.now() - started;
  assert.equal(status, 0);
  assert.ok(elapsed >= 800, `update finished in ${elapsed}ms while the lock was held`);
  assert.equal(read().souls.s1.tasks_total, 1);
  assert.equal(run('check', 's1').status, 0);
});

test('a reader never sees a half-written registry while it is being saved', t => {
  const delegations = Array.from({ length: 500 }, (_, i) => ({ soul_id: 's1', result: 'success', turns: i, task: 'x'.repeat(150) }));
  const { root, bin, file } = fixture(t, { souls: { s1: { tasks_total: 1 } }, delegations });
  const done = path.join(root, 'writer-done');
  const writer = spawn('python3', ['-c', [
    'import importlib.util',
    'from importlib.machinery import SourceFileLoader',
    `loader = SourceFileLoader("trust_registry", ${JSON.stringify(bin)})`,
    'tr = importlib.util.module_from_spec(importlib.util.spec_from_loader("trust_registry", loader))',
    'loader.exec_module(tr)',
    'data = tr.load_registry()',
    'for _ in range(400): tr.save_registry(data)',
    `open(${JSON.stringify(done)}, "w").close()`,
  ].join('\n')], { stdio: 'inherit' });
  t.after(() => writer.kill());
  const deadline = Date.now() + 30_000;
  let reads = 0;
  let failures = 0;
  while (!fs.existsSync(done) && Date.now() < deadline) {
    reads++;
    try { JSON.parse(fs.readFileSync(file, 'utf8')); } catch { failures++; }
  }
  assert.ok(fs.existsSync(done), 'writer did not finish');
  assert.ok(reads > 0);
  assert.equal(failures, 0, `${failures} of ${reads} reads saw a torn registry`);
});

test('an update repeating a recorded --delegation-id is ignored', t => {
  const { run, read } = fixture(t, { souls: {}, delegations: [] });
  for (let i = 0; i < 2; i++) {
    const r = run('update', 's1', '--result', 'failure', '--delegation-id', 'toolu_a');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  assert.equal(run('update', 's1', '--result', 'failure', '--delegation-id', 'toolu_b').status, 0);
  const reg = read();
  assert.equal(reg.souls.s1.tasks_failed, 2);
  assert.equal(reg.souls.s1.consecutive_failures, 2);
  assert.deepEqual(reg.delegations.map(d => d.delegation_id), ['toolu_a', 'toolu_b']);
});

// An --apply audit can see a session at its end and again at the next bootstrap;
// without an id each delegation counted twice, so two real failures opened
// the circuit (>= 3) instead of three.
test('auditing the same transcript twice records each delegation once', t => {
  const { root, ws, read } = fixture(t, { souls: {}, delegations: [] });
  const jsonl = path.join(root, 'session.jsonl');
  const lines = [];
  for (const id of ['toolu_1', 'toolu_2']) {
    lines.push({ message: { content: [{ type: 'tool_use', name: 'Task', id, input: { subagent_type: 'coder', description: id } }] } });
    lines.push({ message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Error: build failed badly' }] } });
  }
  fs.writeFileSync(jsonl, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const audit = fileURLToPath(new URL('../workspace-bin/subagent-audit.mjs', import.meta.url));
  for (let i = 0; i < 2; i++) {
    const r = spawnSync(process.execPath, [audit, '--apply', jsonl], {
      env: { ...process.env, HOME: root, OPENCLAW_WORKSPACE: ws }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  const soul = read().souls.coder;
  assert.equal(soul.tasks_total, 2);
  assert.equal(soul.consecutive_failures, 2);
  assert.notEqual(soul.circuit_state, 'open');
});
