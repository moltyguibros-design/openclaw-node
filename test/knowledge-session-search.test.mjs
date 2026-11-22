/**
 * The .knowledge.db session-search CLI was bin/session-search.mjs, the same
 * name as workspace-bin/session-search.mjs over state.db. It is now
 * bin/knowledge-session-search.mjs, and its --fts mode reduces a
 * natural-language question to AND-joined keywords: FTS5 cannot parse the
 * raw "?", and the quoted-phrase retry only matched the question verbatim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initDatabase, ftsSafeQuery } from '../lib/mcp-knowledge/core.mjs';

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

test('--fts finds a turn for a natural-language question', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-session-search-'));
  try {
    const dbPath = join(dir, '.knowledge.db');
    const db = initDatabase(dbPath);
    db.prepare('INSERT INTO session_documents (session_id, source_path, content_hash, last_indexed, turn_count) VALUES (?, ?, ?, ?, ?)')
      .run('s-nats', '/fake/s-nats.jsonl', 'h', 0, 1);
    db.prepare('INSERT INTO session_chunks (session_id, turn_index, role, text, snippet) VALUES (?, ?, ?, ?, ?)')
      .run('s-nats', 0, 'user', '[user] how the NATS server is configured with token auth', 'how the NATS server is configured');
    db.close();

    const run = q => spawnSync(process.execPath, [CLI, q, '--fts', '--db', dbPath], { encoding: 'utf8' });
    let r = run('How is NATS configured?');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FTS search: .*\(1 results\)/);
    assert.match(r.stdout, /session=s-nats turn=0 role=user/);

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
