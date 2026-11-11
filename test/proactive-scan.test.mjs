import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/proactive-scan', import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proactive-scan-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = path.join(root, 'ws');
  fs.mkdirSync(path.join(ws, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(ws, '.tmp'), { recursive: true });
  const bin = path.join(ws, 'bin', 'proactive-scan');
  fs.copyFileSync(script, bin);
  fs.chmodSync(bin, 0o755);
  fs.writeFileSync(path.join(ws, '.tmp', 'trust-registry.json'), JSON.stringify({
    souls: { s1: { circuit_state: 'open', circuit_opened_at: '2020-01-01T00:00:00', cooldown_minutes: 30 } },
  }));
  return { root, ws, bin };
}

function scan(bin, cwd, workspace, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.OPENCLAW_WORKSPACE;
  if (workspace) env.OPENCLAW_WORKSPACE = workspace;
  return spawnSync('bash', [bin, '--dry-run'], { cwd, env, encoding: 'utf8' });
}

function scanRunningTask(t, updatedAt, tz) {
  const { ws, bin } = fixture(t);
  fs.mkdirSync(path.join(ws, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'memory', 'active-tasks.md'),
    `- task_id: T1\n  title: "t"\n  status: running\n  updated_at: ${updatedAt}\n`);
  const r = scan(bin, ws, undefined, { TZ: tz });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

test('an ISO-UTC updated_at an hour old is stale in a negative-offset zone', t => {
  const out = scanRunningTask(t, new Date(Date.now() - 3600_000).toISOString(), 'America/Montreal');
  assert.match(out, /stale_task/);
  assert.match(out, /Task T1 \(t\) running for 6[01]min/);
});

test('an ISO-UTC updated_at without fractional seconds is parsed', t => {
  assert.match(scanRunningTask(t, '2020-01-01T00:00:00Z', 'America/Montreal'), /stale_task/);
});

test('an ISO-UTC updated_at five minutes old is not stale in a positive-offset zone', t => {
  assert.doesNotMatch(scanRunningTask(t, new Date(Date.now() - 5 * 60_000).toISOString(), 'Asia/Tokyo'), /stale_task/);
});

test('a Montreal wall-time updated_at is still parsed', t => {
  assert.match(scanRunningTask(t, '2020-01-01 09:15 America/Montreal', 'America/Montreal'), /stale_task/);
});

test('without OPENCLAW_WORKSPACE the scan reads the workspace that holds the script, run from the workspace', t => {
  const { ws, bin } = fixture(t);
  const r = scan(bin, ws);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /circuit_recovery/);
});

test('without OPENCLAW_WORKSPACE the workspace does not depend on the cwd', t => {
  const { bin } = fixture(t);
  const r = scan(bin, os.tmpdir());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /circuit_recovery/);
});

test('a half-open soul whose probe never reported is surfaced for recovery', t => {
  const { ws, bin } = fixture(t);
  fs.writeFileSync(path.join(ws, '.tmp', 'trust-registry.json'), JSON.stringify({
    souls: { s2: { circuit_state: 'half_open', last_probe_at: '2020-01-01T00:00:00', cooldown_minutes: 30 } },
  }));
  const r = scan(bin, ws);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Soul s2 probe never reported/);
});

test('OPENCLAW_WORKSPACE overrides the script location', t => {
  const { root, ws, bin } = fixture(t);
  const elsewhere = path.join(root, 'elsewhere', 'bin', 'proactive-scan');
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.copyFileSync(bin, elsewhere);
  const r = scan(elsewhere, root, ws);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /circuit_recovery/);
});
