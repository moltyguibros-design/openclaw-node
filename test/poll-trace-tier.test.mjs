/**
 * poll-trace-tier.test.mjs — the memory daemon's per-tick activity check and
 * the mesh bridge's per-poll dispatch check were traced at tier 1, which smart
 * mode always persists, so "nothing to do" rows refilled the observability
 * feed every 10-30 s. They are now tier 2 'compute': kept only when slow or
 * failing.
 *
 * Run: node --test test/poll-trace-tier.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poll-trace-'));
const dbPath = path.join(root, 'mission-control.db');
process.env.HOME = root;
process.env.OPENCLAW_WORKSPACE = path.join(root, 'workspace');
process.env.OPENCLAW_OBS_DB = dbPath;
process.env.OPENCLAW_TRACE_MODE = 'smart';
process.env.OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART = '1';
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

const obsDb = require('../lib/obs-db.js');
require('../lib/tracer.js').createTracer('warmup').emit('warmup');
obsDb.flushEvents();

const { detectActivity } = await import(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin', 'memory-daemon.mjs'));
const bridge = require('../bin/mesh-bridge.js').__test;
const { ACTIVE_TASKS_PATH } = require('../lib/kanban-io');

const rows = (fn) => {
  obsDb.flushEvents();
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT category FROM observability_events WHERE function = ?').all(fn); }
  finally { db.close(); }
};

test('fast detectActivity ticks write no trace rows; a failing one writes an error row', () => {
  const sessions = path.join(root, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  for (let i = 0; i < 10; i++) detectActivity([{ name: 'test', path: sessions }], 60_000);
  assert.deepEqual(rows('detectActivity'), []);
  assert.throws(() => detectActivity(null, 60_000));
  assert.deepEqual(rows('detectActivity'), [{ category: 'error' }]);
});

test('fast findDispatchable polls write no trace rows', () => {
  fs.mkdirSync(path.dirname(ACTIVE_TASKS_PATH), { recursive: true });
  fs.writeFileSync(ACTIVE_TASKS_PATH, '# Fixture\n\n## Live Tasks\n\n- task_id: T-1\n  title: local card\n  status: queued\n  execution: local\n');
  for (let i = 0; i < 10; i++) assert.equal(bridge.findDispatchable(), null);
  assert.deepEqual(rows('findDispatchable'), []);
});

test('real transitions stay tier 1', () => {
  const daemon = fs.readFileSync(new URL('../workspace-bin/memory-daemon.mjs', import.meta.url), 'utf8');
  for (const fn of ['runPhase0Bootstrap', 'handleTransitions']) {
    assert.match(daemon, new RegExp(`${fn} = tracer\\.wrapAsync\\('${fn}', ${fn}, \\{ tier: 1`), fn);
  }
  const bridgeSrc = fs.readFileSync(new URL('../bin/mesh-bridge.js', import.meta.url), 'utf8');
  for (const fn of ['dispatchTask', 'handleEvent']) {
    assert.match(bridgeSrc, new RegExp(`${fn} = tracer\\.wrap(Async)?\\('${fn}', ${fn}, \\{ tier: 1, category: 'state_transition'`), fn);
  }
});
