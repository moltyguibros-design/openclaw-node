import { expect, test, vi } from "vitest";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("a superseded fact leaves the active lists, search and counts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-supersede-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  let db: Database.Database | undefined;
  try {
    const { getRawDb } = await import("@/lib/db");
    db = getRawDb();
    const { storeExtractedFacts, getActiveItems, getItemsWithSource, searchItems, getExtractionStats } =
      await import("@/lib/memory/extract");
    const gate = { accepted: true, reason: "t" };
    const older = "MissionControl dashboard runs on port 3000 locally";
    const newer = "MissionControl dashboard runs on port 3100 locally";
    storeExtractedFacts([{ factText: older, category: "technical", confidence: 80, gate }]);
    storeExtractedFacts([{ factText: newer, category: "technical", confidence: 80, gate }]);

    const rows = db.prepare("SELECT id, fact_text, superseded_by, valid_to FROM memory_items ORDER BY id").all() as
      { id: number; fact_text: string; superseded_by: number | null; valid_to: string | null }[];
    expect(rows).toHaveLength(2);
    expect(rows[0].superseded_by).toBe(rows[1].id);
    expect(rows[0].valid_to).not.toBeNull();

    expect(getActiveItems("technical").map(i => i.factText)).toEqual([newer]);
    expect(getActiveItems().map(i => i.factText)).toEqual([newer]);
    expect((getItemsWithSource() as { fact_text: string }[]).map(r => r.fact_text)).toEqual([newer]);
    expect((searchItems("MissionControl") as { fact_text: string }[]).map(r => r.fact_text)).toEqual([newer]);
    expect((searchItems("MissionControl", "technical") as { fact_text: string }[]).map(r => r.fact_text)).toEqual([newer]);
    const stats = getExtractionStats();
    expect(stats.active).toBe(1);
    expect(stats.byCategory).toEqual([{ category: "technical", count: 1 }]);
  } finally {
    db?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
