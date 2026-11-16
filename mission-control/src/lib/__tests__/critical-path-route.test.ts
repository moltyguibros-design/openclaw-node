import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-critical-path-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

async function insertTask(row: Record<string, unknown>) {
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const now = new Date().toISOString();
  getDb().insert(tasks).values({ title: String(row.id), status: "queued", kanbanColumn: "backlog", updatedAt: now, createdAt: now, ...row } as typeof tasks.$inferInsert).run();
}

async function link(source: string, target: string) {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().prepare("INSERT INTO dependencies (source_id, target_id) VALUES (?, ?)").run(source, target);
}

describe("GET /api/critical-path", () => {
  // A 90-day project row and an unlinked 60-day task used to set the project
  // duration, so the real 15-day chain A->B->C carried 75 days of float and
  // the route returned the project itself as the critical path.
  it("computes over dependency endpoints only, not the date-spanning container", async () => {
    await insertTask({ id: "P", type: "project", startDate: "2026-01-01", endDate: "2026-04-01" });
    await insertTask({ id: "A", type: "task", parentId: "P", startDate: "2026-01-01", endDate: "2026-01-06" });
    await insertTask({ id: "B", type: "task", parentId: "P", startDate: "2026-01-06", endDate: "2026-01-11" });
    await insertTask({ id: "C", type: "task", parentId: "P", startDate: "2026-01-11", endDate: "2026-01-16" });
    await insertTask({ id: "D", type: "task", parentId: "P", startDate: "2026-01-01", endDate: "2026-02-01" });
    await insertTask({ id: "X", type: "task", parentId: "P", startDate: "2026-01-01", endDate: "2026-03-02" });
    await link("A", "B");
    await link("B", "C");
    await link("A", "D");
    const { GET } = await import("@/app/api/critical-path/route");

    const res = await GET(new NextRequest("http://x/api/critical-path?projectId=P"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ criticalPath: ["A", "D"], totalDuration: 36 });
  });
});
