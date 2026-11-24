/**
 * The .knowledge.db session-search CLI was bin/session-search.mjs, the same
 * name as workspace-bin/session-search.mjs over state.db. It is now
 * bin/knowledge-session-search.mjs, and its --fts mode and the hybrid FTS leg
 * reduce a natural-language question to AND-joined keywords: FTS5 cannot parse
 * the raw "?", and the quoted-phrase retry only matched the question verbatim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDatabase, ftsSafeQuery, hybridSearchSessions } from '../lib/mcp-knowledge/core.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'knowledge-session-search.mjs');

test('the knowledge-db CLI no longer shares its name with the state.db session-search', () => {
  assert.ok(existsSync(CLI));
  assert.ok(!existsSync(join(ROOT, 'bin', 'session-search.mjs')));
});

test('ftsSafeQuery keeps only keywords of three or more characters', () => {
  assert.equal(ftsSafeQuery('How is NATS configured?'), 'how AND nats AND configured');
  assert.equal(ftsSafeQuery('"a" is ?'), null);
});

test('ftsSafeQuery keeps accented letters inside their words', () => {
  assert.equal(ftsSafeQuery('serveur configuré café'), 'serveur AND configuré AND café');
  assert.equal(ftsSafeQuery('serveur configure\u0301'), 'serveur AND configure\u0301');
});

function seedSessionDb(dbPath) {
  const db = initDatabase(dbPath);
  const doc = db.prepare('INSERT INTO session_documents (session_id, source_path, content_hash, last_indexed, turn_count) VALUES (?, ?, ?, ?, ?)');
  const chunk = db.prepare('INSERT INTO session_chunks (session_id, turn_index, role, text, snippet) VALUES (?, ?, ?, ?, ?)');
  doc.run('s-nats', '/fake/s-nats.jsonl', 'h', 0, 1);
  chunk.run('s-nats', 0, 'user', '[user] how the NATS server is configured with token auth', 'how the NATS server is configured');
  doc.run('s-fr', '/fake/s-fr.jsonl', 'h', 0, 1);
  chunk.run('s-fr', 0, 'user', '[user] le serveur est configuré avec un jeton', 'le serveur est configuré');
  return db;
}

test('--fts finds a turn for a natural-language question', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-session-search-'));
  try {
    const dbPath = join(dir, '.knowledge.db');
    seedSessionDb(dbPath).close();

    const run = q => spawnSync(process.execPath, [CLI, q, '--fts', '--db', dbPath], { encoding: 'utf8' });
    let r = run('How is NATS configured?');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FTS search: .*\(1 results\)/);
    assert.match(r.stdout, /session=s-nats turn=0 role=user/);

    r = run('serveur configuré');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FTS search: .*\(1 results\)/);
    assert.match(r.stdout, /session=s-fr turn=0 role=user/);

    r = run('is ?');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No results found\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the workspace DB, not <cwd>/.knowledge.db', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'session-search-cwd-'));
  const home = mkdtempSync(join(tmpdir(), 'session-search-home-'));
  try {
    const env = { ...process.env, HOME: home };
    delete env.KNOWLEDGE_DB;
    delete env.KNOWLEDGE_ROOT;
    const r = spawnSync(process.execPath, [CLI, 'nats', '--fts'], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(cwd, '.knowledge.db')), false);
    assert.equal(existsSync(join(home, '.openclaw', 'workspace', '.knowledge.db')), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('the hybrid FTS leg sanitizes a natural-language question', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-session-search-'));
  const db = seedSessionDb(join(dir, '.knowledge.db'));
  try {
    const results = await hybridSearchSessions(db, 'How is NATS configured?', 10);
    assert.deepEqual(results.map(r => r.session_id), ['s-nats']);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
