/**
 * store-schema-guard.test.js — a rollback refuses to put code older than the
 * memory store's schema in front of it.
 *
 * Old code carries no newer-schema check (extraction-store refuses only from
 * the version that added EXTRACTION_SCHEMA_VERSION), so the v7 code ran on a
 * v8 state.db: it took no backup, counted themes the inflated way again, and
 * v8's one-time reset never re-ran after roll-forward.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { schemaRollbackRefusal, targetSchemaVersion, newestMigrationBackup } = require('../lib/store-schema-guard');

describe('schemaRollbackRefusal', () => {
  let tmp, repo, dbPath, preConstant, v7, current, noStore;
  const git = (...args) => execFileSync('git', args, {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
  }).trim();
  const commit = (content, message) => {
    if (content === null) fs.rmSync(path.join(repo, 'lib/extraction-store.mjs'), { force: true });
    else fs.writeFileSync(path.join(repo, 'lib/extraction-store.mjs'), content);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const storeAt = (version) => {
    const db = new Database(dbPath);
    db.pragma(`user_version = ${version}`);
    db.close();
  };

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-guard-'));
    repo = path.join(tmp, 'repo');
    dbPath = path.join(tmp, 'home', '.openclaw', 'state.db');
    fs.mkdirSync(path.join(repo, 'lib'), { recursive: true });
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    git('init', '-q', '-b', 'main');
    noStore = commit(null, 'before the extraction store');
    v7 = commit('if (getVersion(db) < 6) setVersion(db, 6);\nif (getVersion(db) < 7) setVersion(db, 7);\n', 'v7');
    preConstant = commit('setVersion(db, 7);\nsetVersion(db, 8);\n', 'v8 before the constant');
    current = commit('export const EXTRACTION_SCHEMA_VERSION = 9;\nsetVersion(db, 8);\n', 'v9');
  });
  after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads the target schema from the constant, else the last setVersion, else none', () => {
    assert.equal(targetSchemaVersion(repo, current), 9);
    assert.equal(targetSchemaVersion(repo, preConstant), 8);
    assert.equal(targetSchemaVersion(repo, v7), 7);
    assert.equal(targetSchemaVersion(repo, noStore), null);
  });

  it('allows a target that can open the store, and a node with no store', () => {
    assert.equal(schemaRollbackRefusal({ repoDir: repo, toSha: preConstant, dbPath }), null, 'no state.db yet');
    storeAt(8);
    assert.equal(schemaRollbackRefusal({ repoDir: repo, toSha: preConstant, dbPath }), null);
    assert.equal(schemaRollbackRefusal({ repoDir: repo, toSha: noStore, dbPath }), null);
  });

  it('refuses a target older than the store, naming the newest backup that target can open', () => {
    storeAt(8);
    const dir = path.join(path.dirname(dbPath), 'backups', 'migration');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['state.db-v6-20261101T000000000Z.db', 'state.db-v7-20261101T000000000Z.db',
      'state.db-v7-20261102T000000000Z.db', 'state.db-v8-20261103T000000000Z.db']) {
      fs.writeFileSync(path.join(dir, f), '');
    }
    assert.equal(newestMigrationBackup(dbPath, 7), path.join(dir, 'state.db-v7-20261102T000000000Z.db'));
    const refusal = schemaRollbackRefusal({ repoDir: repo, toSha: v7, dbPath });
    assert.match(refusal, /state\.db is at memory-store schema v8, but .* code expects v7 or older/);
    assert.match(refusal, /restore .*state\.db-v7-20261102T000000000Z\.db/);
    fs.rmSync(dir, { recursive: true });
    assert.match(schemaRollbackRefusal({ repoDir: repo, toSha: v7, dbPath }), /no backup that code can open in /);
  });

  it('a store it cannot read throws, unless the target has no extraction store to compare', () => {
    fs.rmSync(dbPath, { force: true });
    fs.mkdirSync(dbPath);
    try {
      assert.throws(() => schemaRollbackRefusal({ repoDir: repo, toSha: v7, dbPath }), /cannot read the memory-store schema of /);
      assert.equal(schemaRollbackRefusal({ repoDir: repo, toSha: noStore, dbPath }), null);
    } finally {
      fs.rmSync(dbPath, { recursive: true });
    }
  });
});
