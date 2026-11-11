import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/soul-prompt', import.meta.url));

function run(t, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-prompt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'home/.openclaw/souls/probe'), { recursive: true });
  fs.mkdirSync(path.join(root, 'ws/bin'), { recursive: true });
  fs.copyFileSync(script, path.join(root, 'ws/bin/soul-prompt'));
  if (registry) fs.writeFileSync(path.join(root, 'ws/bin/trust-registry'), registry, { mode: 0o755 });
  return spawnSync('bash', [path.join(root, 'ws/bin/soul-prompt'), 'probe'], {
    env: { ...process.env, HOME: path.join(root, 'home'), TMPDIR: root }, encoding: 'utf8',
  });
}

test('a half-open breaker with a probe allowed is not reported as open', t => {
  const r = run(t, "#!/bin/sh\necho '  probe: HALF_OPEN (cooldown expired, probe allowed)'\nexit 0\n");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('Circuit Breaker Warning'));
});

test('a breaker still in cooldown is reported as open', t => {
  const r = run(t, "#!/bin/sh\necho '  probe: OPEN (12min remaining)'\nexit 1\n");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Circuit Breaker Warning'));
});

test('a missing trust registry produces no breaker warning', t => {
  const r = run(t, null);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('Circuit Breaker Warning'));
  assert.ok(r.stdout.includes('# Completion Protocol'));
});
