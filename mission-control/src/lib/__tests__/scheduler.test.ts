import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({ getNats: async () => null, sc: { encode: (s: string) => s } }));
vi.mock("@/lib/gateway-notify", () => ({ gatewayNotify: async () => true }));

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scheduler-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.stubEnv("TZ", "America/Montreal");
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(async () => {
  vi.useRealTimers();
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

async function load() {
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const scheduler = await import("@/lib/scheduler");
  const db = getDb();
  const insert = (row: Partial<typeof tasks.$inferInsert> & { id: string }) => {
    const now = new Date().toISOString();
    db.insert(tasks)
      .values({ title: row.id, status: "queued", kanbanColumn: "backlog", needsApproval: 1, updatedAt: now, createdAt: now, ...row })
      .run();
  };
  const status = (id: string) => db.select().from(tasks).where(eq(tasks.id, id)).get()?.status;
  const setStatus = (id: string, s: string) => db.update(tasks).set({ status: s }).where(eq(tasks.id, id)).run();
  return { ...scheduler, insert, status, setStatus };
}

test("a zone-less datetime-local trigger fires at that local wall-clock time, not that UTC time", async () => {
  expect(new Date(2026, 10, 11, 14, 30).toISOString()).toBe("2026-11-11T19:30:00.000Z");
  vi.setSystemTime(new Date("2026-11-11T14:30:00.000Z"));
  const { insert, schedulerTick, schedulerStatus, status } = await load();
  insert({ id: "T-at", triggerKind: "at", triggerAt: "2026-11-11T14:30" });

  expect(schedulerTick().triggered).not.toContain("T-at");
  expect(status("T-at")).toBe("queued");

  vi.setSystemTime(new Date("2026-11-11T15:30:00.000Z"));
  expect(schedulerStatus(30).overdue).toBe(0);
  expect(schedulerTick().triggered).not.toContain("T-at");

  vi.setSystemTime(new Date("2026-11-11T19:30:00.000Z"));
  expect(schedulerTick().triggered).toContain("T-at");
  expect(status("T-at")).toBe("ready");
});

test("a recurring cron task recreated inside its slot's window waits for the next occurrence", async () => {
  vi.setSystemTime(new Date("2026-11-11T15:01:00.000Z"));
  const { insert, schedulerTick, setStatus } = await load();
  insert({
    id: "T-cron",
    triggerKind: "cron",
    triggerCron: "0 10 * * *",
    triggerTz: "America/Montreal",
    isRecurring: 1,
    createdAt: "2026-11-10T12:00:00.000Z",
  });

  expect(schedulerTick().triggered).toContain("T-cron");

  setStatus("T-cron", "done");
  vi.setSystemTime(new Date("2026-11-11T15:02:00.000Z"));
  const [newId] = schedulerTick().recurring;
  expect(newId).toBeDefined();

  vi.setSystemTime(new Date("2026-11-11T15:03:00.000Z"));
  expect(schedulerTick().triggered).not.toContain(newId);

  vi.setSystemTime(new Date("2026-11-12T15:01:00.000Z"));
  expect(schedulerTick().triggered).toContain(newId);
});

test("a recreated recurring task takes the numeric next id past 999 for the day", async () => {
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  const { insert, schedulerTick } = await load();
  insert({ id: "T-20261111-999", status: "done", kanbanColumn: "done" });
  insert({ id: "T-20261111-1000", status: "done", kanbanColumn: "done" });
  insert({ id: "R-1", status: "done", kanbanColumn: "done", isRecurring: 1 });

  expect(schedulerTick().recurring).toEqual(["T-20261111-1001"]);
});

test("an ISO-Z trigger in the past still fires and counts as overdue past the grace window", async () => {
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  const { insert, schedulerTick, schedulerStatus } = await load();
  insert({ id: "T-iso-old", triggerKind: "at", triggerAt: "2026-11-11T14:00:00.000Z" });
  insert({ id: "T-iso-new", triggerKind: "at", triggerAt: "2026-11-11T14:59:00.000Z" });

  expect(schedulerStatus(30).overdueIds).toEqual(["T-iso-old"]);
  expect(schedulerTick().triggered.sort()).toEqual(["T-iso-new", "T-iso-old"]);
});

// mission-control-lib#4: the recreated row dropped where and how the task runs,
// so a recurring mesh task came back as a local task with no description.
test("a recreated recurring task keeps its definition and starts its run state fresh", async () => {
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  const { insert, schedulerTick } = await load();
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  insert({
    id: "R-mesh",
    status: "done",
    kanbanColumn: "done",
    isRecurring: 1,
    needsApproval: 0,
    triggerKind: "cron",
    triggerCron: "0 10 * * *",
    description: "rotate the logs",
    execution: "mesh",
    metric: "npm test",
    budgetMinutes: 45,
    scope: '["logs/**"]',
    collaboration: '{"mode":"parallel"}',
    preferredNodes: '["node-a"]',
    excludeNodes: '["node-b"]',
    clusterId: "cluster-1",
    color: "#336699",
    showInCalendar: 1,
    meshTaskId: "R-mesh",
    meshNode: "node-a",
    acknowledgedAt: "2026-11-11T14:00:00.000Z",
    artifacts: '["logs/run.txt"]',
    extra: JSON.stringify({ llm_provider: "openai", llm_model: "m-1", collab_result: '{"rounds":2}', circling_step: "2" }),
  });

  const [newId] = schedulerTick().recurring;
  const row = getDb().select().from(tasks).where(eq(tasks.id, newId)).get()!;
  expect(row).toMatchObject({
    status: "queued",
    description: "rotate the logs",
    execution: "mesh",
    metric: "npm test",
    budgetMinutes: 45,
    scope: '["logs/**"]',
    collaboration: '{"mode":"parallel"}',
    preferredNodes: '["node-a"]',
    excludeNodes: '["node-b"]',
    clusterId: "cluster-1",
    color: "#336699",
    showInCalendar: 1,
    triggerKind: "cron",
    meshTaskId: null,
    meshNode: null,
    acknowledgedAt: null,
    artifacts: null,
  });
  expect(JSON.parse(row.extra!)).toEqual({ llm_provider: "openai", llm_model: "m-1" });
});

test("a recreated recurring mesh task is not auto-dispatched to the local agent", async () => {
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  const { insert, schedulerTick } = await load();
  insert({ id: "R-mesh", status: "done", kanbanColumn: "done", isRecurring: 1, needsApproval: 0, execution: "mesh" });

  const tick = schedulerTick();
  const [newId] = tick.recurring;
  expect(newId).toBeDefined();
  expect(tick.dispatched).not.toContain(newId);
  expect(schedulerTick().dispatched).not.toContain(newId);
});
