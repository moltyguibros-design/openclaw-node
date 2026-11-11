import { expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("consolidation archives each duplicate once, in one transaction, with one prepared UPDATE", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-consolidate-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  let db: Database.Database | undefined;
  const prepare = vi.spyOn(Database.prototype, "prepare");
  const transaction = vi.spyOn(Database.prototype, "transaction");
  try {
    const { getRawDb } = await import("@/lib/db");
    db = getRawDb();
    const insert = db.prepare(
      "INSERT INTO memory_items (fact_text, confidence, category, created_at) VALUES (?, ?, 'general', ?)"
    );
    const newest = Number(insert.run("alpha bravo charlie delta", 50, "2026-01-03 00:00:00").lastInsertRowid);
    const middle = Number(insert.run("alpha bravo charlie delta", 90, "2026-01-02 00:00:00").lastInsertRowid);
    const oldest = Number(insert.run("alpha bravo charlie delta", 95, "2026-01-01 00:00:00").lastInsertRowid);
    prepare.mockClear();
    transaction.mockClear();

    const { POST } = await import("@/app/api/memory/consolidate/route");
    const body = await (await POST()).json();

    expect(body.merged).toBe(2);
    expect(body.totalActive).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM memory_audit WHERE operation = 'consolidate'").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT id FROM memory_items WHERE status = 'active'").all()).toEqual([{ id: oldest }]);
    expect(db.prepare("SELECT id, superseded_by FROM memory_items WHERE status = 'archived' ORDER BY id").all()).toEqual([
      { id: newest, superseded_by: middle },
      { id: middle, superseded_by: oldest },
    ]);
    expect(prepare.mock.calls.filter(([sql]) => /^UPDATE memory_items SET status = 'archived'/.test(sql))).toHaveLength(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  } finally {
    prepare.mockRestore();
    transaction.mockRestore();
    db?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
