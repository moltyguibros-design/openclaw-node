import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

test('only bin/lane-watchdog.js exists: the units run that copy, a workspace-bin duplicate drifts', () => {
  assert.equal(fs.existsSync(path.join(REPO, 'workspace-bin', 'lane-watchdog.js')), false, 'the service-run copy is bin/lane-watchdog.js');
  assert.match(read('services/launchd/ai.openclaw.lane-watchdog.plist'), /\$\{OPENCLAW_REPO_DIR\}\/bin\/lane-watchdog\.js/);
  assert.match(read('services/systemd/openclaw-lane-watchdog.service'), /\$\{OPENCLAW_REPO_DIR\}\/bin\/lane-watchdog\.js/);
});

test('shutdown closes the fs.watch watchers instead of unwatchFile, which only stops fs.watchFile pollers', () => {
  const src = read('bin/lane-watchdog.js');
  assert.match(src, /fs\.watch\(filePath/);
  assert.doesNotMatch(src, /fs\.unwatchFile/);
  assert.match(src, /if \(logWatcher\) logWatcher\.close\(\);/);
  assert.match(src, /if \(errWatcher\) errWatcher\.close\(\);/);
});

test('log lines go to stdout only, never into the retired ~/openclaw/shared folder', () => {
  assert.doesNotMatch(read('bin/lane-watchdog.js'), /openclaw\/shared|appendFileSync/);
});

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-watchdog-'));
process.env.HOME = tmpHome;
const require = createRequire(import.meta.url);
const { tailLog, GATEWAY_ERR_LOG } = require('../bin/lane-watchdog.js');
after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

const waitFor = async (cond, ms = 2000) => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
};

test('the default err log matches the file the platform gateway unit writes', () => {
  assert.match(read('services/launchd/ai.openclaw.gateway.plist'), /logs\/gateway\.err\.log</);
  assert.match(read('services/systemd/openclaw-gateway.service'), /StandardError=append:\$\{OPENCLAW_ROOT\}\/logs\/gateway\.err$/m);
  const suffix = process.platform === 'darwin' ? '/.openclaw/logs/gateway.err.log' : '/.openclaw/logs/gateway.err';
  assert.ok(GATEWAY_ERR_LOG.endsWith(suffix), GATEWAY_ERR_LOG);
});

test('a missing log is waited for, then tailed from its start once it appears', async () => {
  const file = path.join(tmpHome, 'late.log');
  const lines = [];
  const t = tailLog(file, 'late.log', (l) => lines.push(l), { pollMs: 20 });
  try {
    await new Promise((r) => setTimeout(r, 60));
    fs.writeFileSync(file, 'first\nsecond\n');
    assert.ok(await waitFor(() => lines.length >= 2), `got ${JSON.stringify(lines)}`);
    assert.deepEqual(lines, ['first', 'second']);
  } finally {
    t.close();
  }
});

test('a partial line is carried into the next read and overlapping checks parse each line once', async () => {
  const file = path.join(tmpHome, 'live.log');
  fs.writeFileSync(file, 'old line before start\n');
  const lines = [];
  const t = tailLog(file, 'live.log', (l) => lines.push(l), { pollMs: 20 });
  try {
    fs.appendFileSync(file, 'lane wait exc');
    for (let i = 0; i < 5; i++) t.check();
    await new Promise((r) => setTimeout(r, 60));
    fs.appendFileSync(file, 'eeded: lane=x waitedMs=1\nnext\n');
    for (let i = 0; i < 5; i++) t.check();
    assert.ok(await waitFor(() => lines.length >= 2), `got ${JSON.stringify(lines)}`);
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(lines, ['lane wait exceeded: lane=x waitedMs=1', 'next']);
  } finally {
    t.close();
  }
});
