import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-batch-'));
const dbPath = path.join(dir, 'mission-control.db');
process.env.OPENCLAW_OBS_DB = dbPath;
process.env.OPENCLAW_TRACE_MODE = 'smart';
const { createTracer } = require('../lib/tracer.js');
const obsDb = require('../lib/obs-db.js');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const count = (fn) => {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare('SELECT COUNT(*) AS n FROM observability_events WHERE function = ?').get(fn).n; }
  finally { db.close(); }
};

test('smart mode still persists every info log line, in a batch rather than inline', () => {
  const tracer = createTracer('batch-test');
  tracer.emit('warmup');
  obsDb.flushEvents();
  for (let i = 0; i < 50; i++) tracer.log('info', `line ${i}`);
  assert.equal(count('log.info'), 0, 'emit must not write synchronously');
  obsDb.flushEvents();
  assert.equal(count('log.info'), 50, 'every line is kept (operator choice: keep the full record)');
});

test('a log line does not wait on another writer holding the database lock', () => {
  const tracer = createTracer('batch-test');
  const holder = new Database(dbPath);
  holder.exec('BEGIN IMMEDIATE');
  try {
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) tracer.log('info', `locked ${i}`);
    assert.ok(Date.now() - t0 < 1000, `emit blocked for ${Date.now() - t0}ms`);
  } finally {
    holder.exec('COMMIT');
    holder.close();
  }
  obsDb.flushEvents();
  assert.equal(count('log.info'), 55);
});

test('queued lines are written when the process exits', () => {
  const r = spawnSync(process.execPath, ['-e', `
    const { createTracer } = require(${JSON.stringify(path.resolve('lib/tracer.js'))});
    createTracer('exit-test').log('info', 'last words');
    process.exit(0);
  `], { env: { ...process.env, OPENCLAW_OBS_DB: dbPath }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const db = new Database(dbPath, { readonly: true });
  const n = db.prepare("SELECT COUNT(*) AS n FROM observability_events WHERE module = 'exit-test'").get().n;
  db.close();
  assert.equal(n, 1);
});
