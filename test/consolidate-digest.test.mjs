/**
 * consolidate-digest.test.mjs — which daily and weekly digests a consolidation
 * cycle writes. A session note is filed under its session's start date, so a
 * note written later (a backfilled session, one that crossed UTC midnight)
 * belongs in a past day's digest and that day's ISO week.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { tmpDir } from './helpers/tmp-dir.cjs';
import { runConsolidationCycle } from '../bin/consolidate.mjs';
import { backfillDigests, generateDailyDigest, isoWeekEnd } from '../lib/obsidian-digest.mjs';

const DAY = 86400000;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

function sessionDb(sessions, file = ':memory:') {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL,
      canonical_name TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, mention_count INTEGER NOT NULL DEFAULT 1,
      embedding BLOB, salience REAL DEFAULT 0.5, last_recalled TEXT, source_type TEXT DEFAULT 'local', source_node TEXT, source_event_id TEXT);
    CREATE TABLE themes (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, hierarchy_path TEXT,
      parent_id INTEGER REFERENCES themes(id), first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, mention_count INTEGER NOT NULL DEFAULT 1,
      source_type TEXT DEFAULT 'local', source_node TEXT, source_event_id TEXT);
    CREATE TABLE mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, entity_id INTEGER NOT NULL REFERENCES entities(id),
      session_id TEXT NOT NULL, turn_index INTEGER, salience REAL NOT NULL DEFAULT 0.5, created_at TEXT NOT NULL,
      source_type TEXT DEFAULT 'local', source_node TEXT, source_event_id TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, decision TEXT NOT NULL,
      rationale TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5, superseded_by INTEGER, created_at TEXT NOT NULL,
      salience REAL DEFAULT 0.5, last_recalled TEXT, source_type TEXT DEFAULT 'local', source_node TEXT, source_event_id TEXT);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, start_time TEXT, end_time TEXT, summary TEXT, message_count INTEGER);
  `);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO entities (name, type, first_seen, last_seen) VALUES ('digest-topic', 'concept', ?, ?)`).run(now, now);
  for (const { id, start } of sessions) {
    db.prepare(`INSERT INTO sessions (id, source, start_time, message_count) VALUES (?, 'test', ?, 4)`).run(id, start);
    db.prepare(`INSERT INTO mentions (entity_id, session_id, created_at) VALUES (1, ?, ?)`).run(id, now);
  }
  return db;
}

const sessionNote = (vault, shortId) => readdirSync(join(vault, 'sessions')).find((f) => f.endsWith(`-${shortId}.md`)).replace(/\.md$/, '');
const digest = (vault, name) => readFileSync(join(vault, 'daily', `${name}.md`), 'utf8');

describe('consolidation cycle digests follow the session notes it writes', () => {
  it('a session that started yesterday, first noted today, is in yesterday\'s digest', async () => {
    const now = Date.now();
    const db = sessionDb([{ id: 'beef0001-1111-2222-3333-444455556666', start: new Date(now - DAY).toISOString() }]);
    const vault = tmpDir('digest-yesterday-');
    await runConsolidationCycle({ vaultPath: vault, db, now });
    const note = sessionNote(vault, 'beef0001');
    assert.ok(digest(vault, day(now - DAY)).includes(`[[sessions/${note}]]`));
    db.close();
  });

  it('a backfilled session from weeks ago gets its day\'s digest and its ended week\'s digest', async () => {
    const now = Date.parse('2026-06-10T12:00:00Z'); // a Wednesday: yesterday's week has not ended
    const start = now - 15 * DAY;
    const db = sessionDb([{ id: 'cafe0002-1111-2222-3333-444455556666', start: new Date(start).toISOString() }]);
    const vault = tmpDir('digest-backfill-');
    const result = await runConsolidationCycle({ vaultPath: vault, db, now });
    const note = sessionNote(vault, 'cafe0002');
    assert.ok(digest(vault, day(start)).includes(`[[sessions/${note}]]`));
    assert.ok(digest(vault, `${isoWeekEnd(day(start))}-weekly`).includes(`[[sessions/${note}]]`));
    assert.equal(result.vaultSurfaces.dailyDigest, 3, 'today, yesterday and the backfilled note\'s day');
    assert.equal(result.vaultSurfaces.weeklyDigest, 2, 'the week that just ended and the backfilled note\'s week');

    const again = await runConsolidationCycle({ vaultPath: vault, db, now: now + 60_000 });
    assert.equal(again.vaultSurfaces.sessionNotes, 0);
    assert.equal(again.vaultSurfaces.dailyDigest, 2, 'nothing backfilled: today and yesterday only');
    assert.equal(again.vaultSurfaces.weeklyDigest, 0);
    db.close();
  });
});

function writeSessionNote(vault, date, shortId) {
  mkdirSync(join(vault, 'sessions'), { recursive: true });
  writeFileSync(join(vault, 'sessions', `${date}-topic-${shortId}.md`),
    `---\ntype: session\ndate: ${date}\nsession_id: ${shortId}\n---\n\n# Session: ${date}\n`);
}

describe('backfillDigests: the one-time catch-up over existing session notes', () => {
  it('writes the daily digest of every session-note date and the weekly digest of every ended week', async () => {
    const vault = tmpDir('digest-catchup-');
    writeSessionNote(vault, '2026-06-01', 'aaaa0001');
    writeSessionNote(vault, '2026-06-03', 'aaaa0002');
    writeSessionNote(vault, '2026-06-10', 'aaaa0003');
    writeSessionNote(vault, '2026-06-19', 'aaaa0004');
    const r = await backfillDigests({ vaultPath: vault, now: Date.parse('2026-06-20T12:00:00Z') });
    assert.deepEqual(r, { daily: 4, weekly: 2 });
    const files = readdirSync(join(vault, 'daily')).sort();
    assert.deepEqual(files, ['2026-06-01.md', '2026-06-03.md', '2026-06-07-weekly.md', '2026-06-10.md', '2026-06-14-weekly.md', '2026-06-19.md'],
      'the week of 2026-06-19 has not ended');
    assert.ok(digest(vault, '2026-06-07-weekly').includes('[[sessions/2026-06-01-topic-aaaa0001]]'));
    assert.ok(digest(vault, '2026-06-07-weekly').includes('[[sessions/2026-06-03-topic-aaaa0002]]'));
  });

  // sessions/ is in the operator's vault, so a hand-written note can carry any date.
  it('skips a session note whose date is not a calendar day instead of aborting the catch-up', async () => {
    const vault = tmpDir('digest-catchup-malformed-');
    writeSessionNote(vault, '2026-11-20', 'ffff0001');
    writeSessionNote(vault, 'Nov 2026', 'ffff0002');
    writeSessionNote(vault, '"2026-02-30"', 'ffff0003');
    writeSessionNote(vault, '"2026-13-01"', 'ffff0004');
    const r = await backfillDigests({ vaultPath: vault, now: Date.parse('2026-11-30T12:00:00Z') });
    assert.deepEqual(r, { daily: 1, weekly: 1 });
    assert.deepEqual(readdirSync(join(vault, 'daily')).sort(), ['2026-11-20.md', '2026-11-22-weekly.md']);
  });

  it('runs as consolidate --backfill-digests without a cycle', () => {
    const dir = tmpDir('digest-cli-');
    const vault = join(dir, 'vault');
    writeSessionNote(vault, '2026-06-01', 'bbbb0001');
    const r = spawnSync(process.execPath, [
      fileURLToPath(new URL('../bin/consolidate.mjs', import.meta.url)),
      '--backfill-digests', '--vault-path', vault, '--db', join(dir, 'state.db'),
    ], { env: { ...process.env, HOME: dir }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Digests backfilled: 1 daily, 1 weekly/);
    assert.ok(existsSync(join(vault, 'daily', '2026-06-01.md')));
    assert.equal(existsSync(join(dir, 'state.db')), false, 'no cycle ran');
  });
});

// The installed timer runs the cycle with no --db or --vault-path, and a
// spawned node (bin/spawn-node.mjs) runs it with only OPENCLAW_HOME=<root>.
describe('the standalone cycle on a node root', () => {
  const CONSOLIDATE = fileURLToPath(new URL('../bin/consolidate.mjs', import.meta.url));
  const cycle = (env) => spawnSync(process.execPath, [CONSOLIDATE, '--no-events'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  const noted = (vault, shortId) => existsSync(join(vault, 'sessions')) && readdirSync(join(vault, 'sessions')).some((f) => f.endsWith(`-${shortId}.md`));

  it('under OPENCLAW_HOME it cycles <root>/state.db into <root>/obsidian-local and leaves ~/.openclaw alone', () => {
    const dir = tmpDir('consolidate-node-root-');
    const home = join(dir, 'home');
    const node = join(dir, 'node');
    mkdirSync(home);
    mkdirSync(node);
    sessionDb([{ id: 'dddd0001-1111-2222-3333-444455556666', start: new Date().toISOString() }], join(node, 'state.db')).close();
    const r = cycle({ HOME: home, OPENCLAW_HOME: node });
    assert.equal(existsSync(join(home, '.openclaw')), false, `the cycle opened the main node's store: ${r.stdout}${r.stderr}`);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(noted(join(node, 'obsidian-local'), 'dddd0001'), 'no session note in the node root vault');
  });

  it('without OPENCLAW_HOME it keeps cycling ~/.openclaw/state.db into ~/.openclaw/obsidian-local', () => {
    const home = join(tmpDir('consolidate-default-root-'), 'home');
    mkdirSync(join(home, '.openclaw'), { recursive: true });
    sessionDb([{ id: 'eeee0001-1111-2222-3333-444455556666', start: new Date().toISOString() }], join(home, '.openclaw', 'state.db')).close();
    const r = cycle({ HOME: home });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(noted(join(home, '.openclaw', 'obsidian-local'), 'eeee0001'), 'no session note in the default vault');
  });
});

describe('a digest built from a preloaded listing', () => {
  it('uses the notes it is given instead of reading the vault again', async () => {
    const vault = tmpDir('digest-preloaded-');
    const sessions = [{ filename: '2026-06-01-only-in-listing-cccc0001.md', frontmatter: { date: '2026-06-01' }, body: '' }];
    await generateDailyDigest({ vaultPath: vault, date: '2026-06-01', notes: { sessions, concepts: [] } });
    assert.ok(digest(vault, '2026-06-01').includes('[[sessions/2026-06-01-only-in-listing-cccc0001]]'));
  });
});
