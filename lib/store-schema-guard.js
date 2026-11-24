/**
 * store-schema-guard.js — a rollback never puts code older than the memory
 * store's schema in front of it.
 *
 * Code carries a newer-schema refusal only from the version that added it
 * (extraction-store EXTRACTION_SCHEMA_VERSION), so older code opens a migrated
 * state.db without a word. The rollback paths ask here before they check out
 * an older tree: mesh-deploy --rollback for this node, and the deploy listener
 * for its failed-deploy rollback and for any trigger to a sha its tree is not
 * behind — which is how the lead's --rollback reaches the other nodes, whose
 * stores only their own listener can read.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * The schema the extraction store at <sha> migrates to: its exported constant,
 * or, in history older than the constant, the last version it sets. Null when
 * that tree has no extraction store.
 */
function targetSchemaVersion(repoDir, sha) {
  let src;
  try {
    src = execFileSync('git', ['show', `${sha}:lib/extraction-store.mjs`], {
      cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const constant = src.match(/^export const EXTRACTION_SCHEMA_VERSION = (\d+);/m);
  if (constant) return Number(constant[1]);
  return Math.max(0, ...[...src.matchAll(/setVersion\(db, (\d+)\)/g)].map(m => Number(m[1])));
}

// Throws when the store exists but cannot be read (no loadable better-sqlite3
// after a failed `npm ci`, a damaged file): the caller decides what that means.
function storeSchemaVersion(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      return db.pragma('user_version', { simple: true });
    } finally {
      db.close();
    }
  } catch (err) {
    throw new Error(`cannot read the memory-store schema of ${dbPath}: ${err.message}`);
  }
}

/**
 * The newest migration backup (backups/migration/<db>-v<N>-<stamp>.db, taken by
 * extraction-store before each upgrade) that code at schema <= maxVersion can open.
 */
function newestMigrationBackup(dbPath, maxVersion) {
  const dir = path.join(path.dirname(path.resolve(dbPath)), 'backups', 'migration');
  const base = path.basename(dbPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${base}-v(\\d+)-(\\d{8}T\\d{9}Z)\\.db$`);
  let files;
  try { files = fs.readdirSync(dir); } catch { return null; }
  const usable = files.map(f => [f, pattern.exec(f)])
    .filter(([, m]) => m && Number(m[1]) <= maxVersion)
    .sort(([, a], [, b]) => Number(a[1]) - Number(b[1]) || a[2].localeCompare(b[2]));
  return usable.length ? path.join(dir, usable.at(-1)[0]) : null;
}

/**
 * Null when the code at toSha can open the store at dbPath; else why not, and
 * what to restore. Throws when the store's schema cannot be read.
 */
function schemaRollbackRefusal({ repoDir, toSha, dbPath }) {
  const target = targetSchemaVersion(repoDir, toSha);
  if (target === null) return null;
  const current = storeSchemaVersion(dbPath);
  if (current === null || current <= target) return null;
  const backup = newestMigrationBackup(dbPath, target);
  return `${dbPath} is at memory-store schema v${current}, but ${toSha.slice(0, 7)}'s code expects v${target} or older — ` +
    (backup
      ? `restore ${backup} (taken before the upgrade) over it first`
      : `no backup that code can open in ${path.join(path.dirname(path.resolve(dbPath)), 'backups', 'migration')}`);
}

module.exports = { schemaRollbackRefusal, targetSchemaVersion, storeSchemaVersion, newestMigrationBackup };
