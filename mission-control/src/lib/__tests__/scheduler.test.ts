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

test("an ISO-Z trigger in the past still fires and counts as overdue past the grace window", async () => {
  vi.setSystemTime(new Date("2026-11-11T15:00:00.000Z"));
  const { insert, schedulerTick, schedulerStatus } = await load();
  insert({ id: "T-iso-old", triggerKind: "at", triggerAt: "2026-11-11T14:00:00.000Z" });
  insert({ id: "T-iso-new", triggerKind: "at", triggerAt: "2026-11-11T14:59:00.000Z" });

  expect(schedulerStatus(30).overdueIds).toEqual(["T-iso-old"]);
  expect(schedulerTick().triggered.sort()).toEqual(["T-iso-new", "T-iso-old"]);
});
