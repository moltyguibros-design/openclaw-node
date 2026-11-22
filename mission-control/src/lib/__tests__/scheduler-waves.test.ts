import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({ getNats: async () => null, sc: { encode: (s: string) => s } }));
vi.mock("@/lib/gateway-notify", () => ({ gatewayNotify: async () => true }));

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

async function seed(rows: Record<string, unknown>[], deps: [string, string][]) {
  const { getDb } = await import("@/lib/db");
  const { tasks, dependencies } = await import("@/lib/db/schema");
  const now = new Date().toISOString();
  const base = { needsApproval: 0, triggerKind: "none", kanbanColumn: "ready", updatedAt: now, createdAt: now };
  getDb().insert(tasks).values(rows.map((r) => ({ ...base, title: String(r.id), ...r }) as typeof tasks.$inferInsert)).run();
  for (const [sourceId, targetId] of deps) getDb().insert(dependencies).values({ sourceId, targetId }).run();
}

// computeWaves only counted predecessors inside the dispatchable set, so a task behind a running one landed in wave 0.
test("a task behind a predecessor that is not done and not dispatchable is blocked, not in a wave", async () => {
  await seed(
    [
      { id: "A", status: "running", owner: "agent", kanbanColumn: "in_progress" },
      { id: "B", status: "queued" },
      { id: "C", status: "ready" },
    ],
    [["A", "B"], ["B", "C"]],
  );
  const { GET } = await import("@/app/api/scheduler/waves/route");

  const body = await (await GET()).json();

  expect(body.waves.flatMap((w: { taskIds: string[] }) => w.taskIds)).toEqual([]);
  expect([...body.blocked].sort()).toEqual(["B", "C"]);
  expect(body.totalDispatchable).toBe(2);
});

test("dispatchable chains still form successive waves", async () => {
  await seed([{ id: "D", status: "ready" }, { id: "E", status: "ready" }], [["D", "E"]]);
  const { GET } = await import("@/app/api/scheduler/waves/route");

  const body = await (await GET()).json();

  expect(body.waves).toEqual([{ index: 0, taskIds: ["D"] }, { index: 1, taskIds: ["E"] }]);
  expect(body.blocked).toEqual([]);
});

test("schedulerTick dispatches only a task whose predecessors are done and reports the same waves", async () => {
  await seed(
    [
      { id: "A", status: "waiting-user" },
      { id: "B", status: "ready", autoPriority: 9 },
      { id: "D", status: "ready" },
      { id: "E", status: "ready" },
    ],
    [["A", "B"], ["D", "E"]],
  );
  const { schedulerTick } = await import("@/lib/scheduler");

  const result = schedulerTick();

  expect(result.dispatched).toEqual(["D"]);
  expect(result.waves).toEqual([{ index: 0, taskIds: ["D"] }, { index: 1, taskIds: ["E"] }]);
});
