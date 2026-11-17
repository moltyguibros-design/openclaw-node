import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sched-waves-"));
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

test("GET /api/scheduler/waves leaves out mesh tasks, like schedulerTick", async () => {
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const now = new Date().toISOString();
  const base = { status: "ready", needsApproval: 0, triggerKind: "none", kanbanColumn: "ready", updatedAt: now, createdAt: now };
  getDb().insert(tasks).values([
    { ...base, id: "L1", title: "local", execution: null },
    { ...base, id: "M1", title: "mesh", execution: "mesh" },
  ]).run();
  const { GET } = await import("@/app/api/scheduler/waves/route");

  const body = await (await GET()).json();

  expect(body.totalDispatchable).toBe(1);
  expect(body.waves.flatMap((w: { taskIds: string[] }) => w.taskIds)).toEqual(["L1"]);
});
