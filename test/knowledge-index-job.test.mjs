import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { SessionStore } from '../lib/session-store.mjs';
import { initDatabase } from '../lib/mcp-knowledge/core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOB = join(ROOT, 'workspace-bin', 'knowledge-index-job.mjs');
const Database = createRequire(join(ROOT, 'package.json'))('better-sqlite3');

function seed(dir, sessionCount) {
  const statePath = join(dir, 'state.db');
  const knowledgePath = join(dir, 'knowledge.db');
  new SessionStore({ dbPath: statePath }).close();

  const state = new Database(statePath);
  const addSession = state.prepare('INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, ?, ?, 2)');
  const addMessage = state.prepare('INSERT INTO messages (session_id, role, content, turn_index) VALUES (?, ?, ?, ?)');
  const knowledge = initDatabase(knowledgePath);
  const addIndexed = knowledge.prepare(
    'INSERT INTO session_documents (session_id, source_path, content_hash, last_indexed, turn_count) VALUES (?, ?, ?, ?, 2)'
  );
  for (let i = 0; i < sessionCount; i++) {
    const id = `s${String(i).padStart(3, '0')}`;
    addSession.run(id, 'test', new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
    addMessage.run(id, 'user', `question ${i}`, 0);
    addMessage.run(id, 'assistant', `answer ${i}`, 1);
    addIndexed.run(id, `session-store://${id}`, 'h', Date.now());
  }
  state.close();
  knowledge.close();
  return { statePath, knowledgePath };
}

function runJob(sessionCount) {
  const dir = mkdtempSync(join(tmpdir(), 'kidx-job-'));
  try {
    const { statePath, knowledgePath } = seed(dir, sessionCount);
    const preload = join(dir, 'count-prepares.mjs');
    writeFileSync(preload, [
      "import { createRequire } from 'node:module';",
      `const Database = createRequire(${JSON.stringify(join(ROOT, 'package.json'))})('better-sqlite3');`,
      'const prepare = Database.prototype.prepare;',
      'let n = 0;',
      'Database.prototype.prepare = function (...args) { n++; return prepare.apply(this, args); };',
      "process.on('exit', () => process.stderr.write(`PREPARES=${n}\\n`));",
      '',
    ].join('\n'));
    const res = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, JOB, statePath, knowledgePath], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const lastLine = res.stdout.trim().split('\n').pop();
    const prepares = /PREPARES=(\d+)/.exec(res.stderr);
    assert.ok(prepares, `no prepare count on stderr: ${res.stderr}`);
    return { result: JSON.parse(lastLine), prepares: Number(prepares[1]) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('knowledge-index-job prepares a fixed number of statements regardless of session count', () => {
  const small = runJob(3);
  const large = runJob(30);
  assert.deepEqual(small.result, { indexed: 0, chunks: 0 });
  assert.deepEqual(large.result, { indexed: 0, chunks: 0 });
  assert.equal(large.prepares, small.prepares,
    `prepares grew with the archive: ${small.prepares} at 3 sessions, ${large.prepares} at 30`);
});
