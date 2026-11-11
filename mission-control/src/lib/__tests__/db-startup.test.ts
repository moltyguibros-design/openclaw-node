import { expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("a healthy SQLite database starts without a recovery REINDEX", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-startup-"));
  const dbPath = path.join(root, "mission-control.db");
  const fixture = new Database(dbPath);
  fixture.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('keep');");
  fixture.close();
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  const exec = vi.spyOn(Database.prototype, "exec");
  let db: Database.Database | undefined;
  try {
    const { getRawDb, dbHealth } = await import("@/lib/db");
    db = getRawDb();
    expect(dbHealth().ok).toBe(true);
    expect(db.prepare("SELECT value FROM preserved").get()).toEqual({ value: "keep" });
    expect(exec.mock.calls.some(([sql]) => /^REINDEX\b/i.test(sql.trim()))).toBe(false);
  } finally {
    db?.close();
    exec.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each(["integrity failure", "pragma throws"])("database startup refuses %s without repairing or caching the failed database", async failure => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-startup-failed-"));
  const dbPath = path.join(root, "mission-control.db");
  const fixture = new Database(dbPath);
  fixture.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('keep');");
  fixture.close();
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  const original = Database.prototype.pragma;
  const pragma = vi.spyOn(Database.prototype, "pragma").mockImplementation(function (this: Database.Database, source, options) {
    if (source === "quick_check") {
      if (failure === "pragma throws") throw Object.assign(new Error("database disk image is malformed"), { code: "SQLITE_CORRUPT" });
      return "*** in database main *** corruption";
    }
    return original.call(this, source, options);
  });
  const exec = vi.spyOn(Database.prototype, "exec");
  const close = vi.spyOn(Database.prototype, "close");
  try {
    const { getRawDb, dbHealth } = await import("@/lib/db");
    expect(() => getRawDb()).toThrow();
    expect(dbHealth().ok).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(pragma.mock.calls.filter(([source]) => source === "quick_check")).toHaveLength(1);
    expect(exec).not.toHaveBeenCalled();
    const verify = new Database(dbPath);
    expect(verify.prepare("SELECT value FROM preserved").get()).toEqual({ value: "keep" });
    expect(verify.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'tasks'").get()).toEqual({ n: 0 });
    verify.close();
  } finally {
    pragma.mockRestore();
    exec.mockRestore();
    close.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("startup retries after a real migration write lock is released", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-startup-busy-"));
  const dbPath = path.join(root, "mission-control.db");
  const writer = new Database(dbPath);
  writer.pragma("journal_mode = WAL");
  writer.exec("CREATE TABLE preserved (value TEXT); INSERT INTO preserved VALUES ('keep'); BEGIN IMMEDIATE;");
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  let db: Database.Database | undefined;
  try {
    const { getRawDb, dbHealth } = await import("@/lib/db");
    expect(() => getRawDb()).toThrowError(expect.objectContaining({ code: "SQLITE_BUSY" }));
    writer.exec("ROLLBACK");
    db = getRawDb();
    expect(dbHealth().ok).toBe(true);
    expect(db.prepare("SELECT value FROM preserved").get()).toEqual({ value: "keep" });
  } finally {
    db?.close();
    writer.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);

test.each([false, true])("a populated pre-migration memory_items/cluster_members schema upgrades (FTS triggers present: %s)", async withFts => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-startup-legacy-"));
  const dbPath = path.join(root, "mission-control.db");
  const fixture = new Database(dbPath);
  fixture.exec(`
    CREATE TABLE memory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fact_text TEXT NOT NULL, confidence INTEGER,
      source_doc_id INTEGER, category TEXT, status TEXT, gate_decision TEXT, gate_reason TEXT,
      extraction_source TEXT, last_accessed TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE cluster_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cluster_id TEXT NOT NULL, node_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker', joined_at TEXT, UNIQUE(cluster_id, node_id)
    );
    INSERT INTO cluster_members (cluster_id, node_id, joined_at) VALUES ('c1', 'n1', '2026-02-02');
  `);
  if (withFts) {
    fixture.exec(`
      CREATE VIRTUAL TABLE memory_items_fts USING fts5(fact_text, category, content='memory_items', content_rowid='id');
      CREATE TRIGGER memory_items_ai AFTER INSERT ON memory_items BEGIN
        INSERT INTO memory_items_fts(rowid, fact_text, category) VALUES (new.id, new.fact_text, new.category);
      END;
      CREATE TRIGGER memory_items_au AFTER UPDATE ON memory_items BEGIN
        INSERT INTO memory_items_fts(memory_items_fts, rowid, fact_text, category) VALUES ('delete', old.id, old.fact_text, old.category);
        INSERT INTO memory_items_fts(rowid, fact_text, category) VALUES (new.id, new.fact_text, new.category);
      END;
    `);
  }
  fixture.exec("INSERT INTO memory_items (fact_text, created_at) VALUES ('kept', '2026-01-01 00:00:00')");
  fixture.close();
  vi.stubEnv("DB_PATH", dbPath);
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  let db: Database.Database | undefined;
  try {
    const { getRawDb, dbHealth } = await import("@/lib/db");
    db = getRawDb();
    expect(dbHealth().ok).toBe(true);
    expect(db.prepare("SELECT valid_from FROM memory_items").get()).toEqual({ valid_from: "2026-01-01 00:00:00" });
    expect(db.prepare("SELECT created_at FROM cluster_members").get()).toEqual({ created_at: "2026-02-02" });
    if (withFts) {
      expect(db.prepare("SELECT rowid FROM memory_items_fts WHERE memory_items_fts MATCH 'kept'").all()).toEqual([{ rowid: 1 }]);
    }
  } finally {
    db?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
