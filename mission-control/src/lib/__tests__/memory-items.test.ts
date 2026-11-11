import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({ getNats: async () => null }));

test("listing memory items honours the category filter", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-items-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  let db: Database.Database | undefined;
  try {
    const { getRawDb } = await import("@/lib/db");
    db = getRawDb();
    const insert = db.prepare("INSERT INTO memory_items (fact_text, category) VALUES (?, ?)");
    insert.run("a", "work");
    insert.run("b", "personal");

    const { getItemsWithSource } = await import("@/lib/memory/extract");
    const work = getItemsWithSource(50, 0, "work") as { fact_text: string; category: string }[];
    expect(work.map(r => [r.fact_text, r.category])).toEqual([["a", "work"]]);
    expect(getItemsWithSource(50, 0)).toHaveLength(2);

    const { GET } = await import("@/app/api/memory/items/route");
    const res = await GET(new NextRequest("http://localhost/api/memory/items?category=work"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].category).toBe("work");
  } finally {
    db?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the diagnostics and flush counts leave out superseded facts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-items-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  let db: Database.Database | undefined;
  try {
    const { getRawDb } = await import("@/lib/db");
    db = getRawDb();
    const insert = db.prepare("INSERT INTO memory_items (fact_text, category) VALUES (?, ?)");
    const current = Number(insert.run("a", "work").lastInsertRowid);
    insert.run("b", "personal");
    db.prepare("INSERT INTO memory_items (fact_text, category, superseded_by, valid_to) VALUES ('old', 'work', ?, datetime('now'))").run(current);

    const flush = await (await import("@/app/api/memory/flush/route")).GET();
    expect((await flush.json()).totalActiveItems).toBe(2);

    const diagnostics = await (await import("@/app/api/diagnostics/route")).GET();
    expect((await diagnostics.json()).memory.items).toBe(2);
  } finally {
    db?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
