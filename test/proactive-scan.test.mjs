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

function scan(bin, cwd, workspace) {
  const env = { ...process.env };
  delete env.OPENCLAW_WORKSPACE;
  if (workspace) env.OPENCLAW_WORKSPACE = workspace;
  return spawnSync('bash', [bin, '--dry-run'], { cwd, env, encoding: 'utf8' });
}

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

test('OPENCLAW_WORKSPACE overrides the script location', t => {
  const { root, ws, bin } = fixture(t);
  const elsewhere = path.join(root, 'elsewhere', 'bin', 'proactive-scan');
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.copyFileSync(bin, elsewhere);
  const r = scan(elsewhere, root, ws);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /circuit_recovery/);
});
