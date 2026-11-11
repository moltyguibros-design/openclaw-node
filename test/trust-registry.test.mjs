import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
