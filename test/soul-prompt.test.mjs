import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/soul-prompt', import.meta.url));
const trustRegistry = fileURLToPath(new URL('../workspace-bin/trust-registry', import.meta.url));

const asJson = v => (typeof v === 'string' ? v : JSON.stringify(v));
const lastLine = s => s.trim().split('\n').at(-1);

function run(t, registry, { soulId = 'probe', registryJson, caps, genes } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-prompt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const soulDir = path.join(root, 'home/.openclaw/souls', soulId);
  fs.mkdirSync(soulDir, { recursive: true });
  if (caps !== undefined) fs.writeFileSync(path.join(soulDir, 'capabilities.json'), asJson(caps));
  if (genes !== undefined) {
    fs.mkdirSync(path.join(soulDir, 'evolution'));
    fs.writeFileSync(path.join(soulDir, 'evolution/genes.json'), asJson(genes));
  }
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
  return { ...r, wsBin: path.join(root, 'ws/bin'), root };
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

const restrictedCaps = { tools: ['Read'], permissions: { restrictedActions: ['git push', 'deploy'] } };

test('a gene without an id keeps the restricted actions and the subagent type', t => {
  const r = run(t, null, { caps: restrictedCaps, genes: { genes: [{ category: 'x' }] } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('## Restricted Actions (DO NOT execute these)'), r.stdout);
  assert.ok(r.stdout.includes('- git push'), r.stdout);
  assert.ok(r.stdout.includes('## ?'), r.stdout);
  assert.equal(lastLine(r.stderr), 'Explore');
});

test('a soul id with a quote keeps its constraints and subagent type', t => {
  const r = run(t, null, { soulId: "pro'be", caps: restrictedCaps });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Restricted Actions'), r.stdout);
  assert.equal(lastLine(r.stderr), 'Explore');
});

test('an unreadable capabilities.json is reported instead of silently dropped', t => {
  const r = run(t, null, { caps: '{not json', genes: { genes: [{ id: 'g1' }] } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('Unavailable: capabilities.json unreadable'), r.stdout);
  assert.ok(r.stdout.includes('## g1'), r.stdout);
  assert.equal(lastLine(r.stderr), 'general-purpose');
  assert.deepEqual(fs.readdirSync(r.root).filter(f => f.startsWith('soul-prompt-meta')), []);
});
