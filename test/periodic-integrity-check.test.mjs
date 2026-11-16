/**
 * periodic-integrity-check.test.mjs — the daemon's periodic children run
 * PRAGMA quick_check, not the full-file integrity_check.
 *
 * openStore scans the whole file unless told not to. knowledge-index-job (every
 * 10 min) and flush-worker (every 10 min while a session is live, and on every
 * flush) opened .knowledge.db / state.db / extraction.db with the scan, so the
 * largest stores were read end to end before each job looked for work. The
 * daemon still runs the full scan when it opens them at boot.
 *
 * Observable without a spy: two indexes with their b-trees swapped leave a store
 * whose index content no longer matches its table. integrity_check reports it;
 * quick_check skips that cross-check, so a job on the full scan throws and one
 * on quick_check runs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { SessionStore } from '../lib/session-store.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { initDatabase } from '../lib/mcp-knowledge/core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const Database = createRequire(join(ROOT, 'package.json'))('better-sqlite3');

function failIntegrityCheck(dbPath) {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE scan_a (n INTEGER); CREATE INDEX scan_a_n ON scan_a(n);
           CREATE TABLE scan_b (n INTEGER); CREATE INDEX scan_b_n ON scan_b(n);
           INSERT INTO scan_a VALUES (1); INSERT INTO scan_b VALUES (2);`);
  const root = (name) => db.prepare('SELECT rootpage FROM sqlite_schema WHERE name = ?').get(name).rootpage;
  const [a, b] = [root('scan_a_n'), root('scan_b_n')];
  db.unsafeMode(true);
  db.pragma('writable_schema = ON');
  db.prepare("UPDATE sqlite_schema SET rootpage = ? WHERE name = 'scan_a_n'").run(b);
  db.prepare("UPDATE sqlite_schema SET rootpage = ? WHERE name = 'scan_b_n'").run(a);
  db.pragma('writable_schema = OFF');
  db.close();
  const check = new Database(dbPath);
  assert.notEqual(check.pragma('integrity_check')[0].integrity_check, 'ok');
  assert.equal(check.pragma('quick_check')[0].quick_check, 'ok');
  check.close();
}

function tmp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'periodic-ic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('periodic jobs open the stores with quick_check, not the full scan', () => {
  it("the store openers take integrityCheck:'quick' and still run the full scan by default", (t) => {
    const dir = tmp(t);
    const state = join(dir, 'state.db');
    const extraction = join(dir, 'extraction.db');
    const knowledge = join(dir, 'knowledge.db');
    new SessionStore({ dbPath: state }).close();
    createExtractionStore({ dbPath: extraction }).close();
    initDatabase(knowledge).close();
    for (const p of [state, extraction, knowledge]) failIntegrityCheck(p);

    assert.throws(() => new SessionStore({ dbPath: state }), /integrity check failed/);
    assert.throws(() => createExtractionStore({ dbPath: extraction }), /integrity check failed/);
    assert.throws(() => initDatabase(knowledge), /integrity check failed/);
    new SessionStore({ dbPath: state, integrityCheck: 'quick' }).close();
    createExtractionStore({ dbPath: extraction, integrityCheck: 'quick' }).close();
    initDatabase(knowledge, { integrityCheck: 'quick' }).close();
  });

  it('knowledge-index-job runs on stores only the full scan would refuse', (t) => {
    const dir = tmp(t);
    const state = join(dir, 'state.db');
    const knowledge = join(dir, 'knowledge.db');
    new SessionStore({ dbPath: state }).close();
    initDatabase(knowledge).close();
    failIntegrityCheck(knowledge);
    failIntegrityCheck(state);
    const res = spawnSync(process.execPath, [join(ROOT, 'workspace-bin', 'knowledge-index-job.mjs'), state, knowledge],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(JSON.parse(res.stdout.trim().split('\n').pop()), { indexed: 0, chunks: 0 });
  });

  it("flush-worker's session import runs on a state.db only the full scan would refuse", (t) => {
    const home = tmp(t);
    mkdirSync(join(home, '.openclaw'));
    const state = join(home, '.openclaw', 'state.db');
    new SessionStore({ dbPath: state }).close();
    failIntegrityCheck(state);
    const jsonl = join(home, 'sess-1.jsonl');
    writeFileSync(jsonl, '');
    // A worker's os.homedir() reads the process environment, so HOME is set on a child process.
    const parent = `
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL(${JSON.stringify(pathToFileURL(join(ROOT, 'workspace-bin', 'flush-worker.mjs')).href)}),
        { execArgv: [], workerData: { kind: 'import', jsonlPath: ${JSON.stringify(jsonl)}, source: 'test' } });
      w.once('message', (m) => { console.log(JSON.stringify(m)); process.exit(0); });
      w.once('error', (e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(0); });
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', parent],
      { cwd: ROOT, encoding: 'utf8', timeout: 60_000, env: { ...process.env, HOME: home } });
    const msg = JSON.parse(res.stdout.trim().split('\n').pop());
    assert.deepEqual({ ok: msg.ok, result: msg.result }, { ok: true, result: { sessionId: 'sess-1', messageCount: 0, imported: false } }, res.stderr);
  });
});
