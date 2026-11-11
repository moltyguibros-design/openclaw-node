import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/soul-prompt', import.meta.url));
const trustRegistry = fileURLToPath(new URL('../workspace-bin/trust-registry', import.meta.url));

function run(t, registry, { soulId = 'probe', registryJson } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-prompt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'home/.openclaw/souls', soulId), { recursive: true });
  fs.mkdirSync(path.join(root, 'ws/bin'), { recursive: true });
  fs.copyFileSync(script, path.join(root, 'ws/bin/soul-prompt'));
  if (registry === 'real') fs.copyFileSync(trustRegistry, path.join(root, 'ws/bin/trust-registry'));
  else if (registry) fs.writeFileSync(path.join(root, 'ws/bin/trust-registry'), registry, { mode: 0o755 });
  if (registryJson) {
    fs.mkdirSync(path.join(root, 'ws/.tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ws/.tmp/trust-registry.json'), JSON.stringify(registryJson));
  }
  const r = spawnSync('bash', [path.join(root, 'ws/bin/soul-prompt'), soulId], {
    env: { ...process.env, HOME: path.join(root, 'home'), TMPDIR: root }, encoding: 'utf8',
  });
  return { ...r, wsBin: path.join(root, 'ws/bin') };
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

test("the trust line uses trust-registry's clamped score", t => {
  const r = run(t, 'real', {
    registryJson: { souls: { probe: { tasks_total: 30, tasks_succeeded: 30, tasks_verified: 30, avg_turns: -5 } }, delegations: [] },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Trust: 1.000 | Tier: expert | Autonomy: full | Track record: 30/30'), r.stdout);
  assert.ok(!fs.existsSync(path.join(r.wsBin, '__pycache__')));
});

test('a soul id with a quote still gets its own record', t => {
  const r = run(t, 'real', {
    soulId: "pro'be",
    registryJson: { souls: { "pro'be": { tasks_total: 5, tasks_succeeded: 5, tasks_verified: 0, avg_turns: 4 } }, delegations: [] },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Tier: developing'), r.stdout);
  assert.ok(r.stdout.includes('Track record: 5/5'), r.stdout);
});
