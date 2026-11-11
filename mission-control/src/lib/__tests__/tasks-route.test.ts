import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const { requestSpy, notifySpy, logSpy } = vi.hoisted(() => ({
  requestSpy: vi.fn(async () => ({})),
  notifySpy: vi.fn(async () => true),
  logSpy: vi.fn(),
}));

vi.mock("@/lib/nats", () => ({
  getNats: async () => ({ request: requestSpy, publish: vi.fn() }),
  sc: { encode: (s: string) => s },
}));
vi.mock("@/lib/mesh-sign", () => ({ signOperatorRequest: async (p: object) => p }));
vi.mock("@/lib/gateway-notify", () => ({ gatewayNotify: notifySpy }));
vi.mock("@/lib/activity", () => ({ logActivity: logSpy }));
vi.mock("@/lib/sync/tasks", () => ({ syncTasksToMarkdown: vi.fn() }));

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tasks-route-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  requestSpy.mockClear();
  notifySpy.mockClear();
  logSpy.mockClear();
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
  getDb().insert(tasks).values({ title: String(row.id), kanbanColumn: "backlog", updatedAt: now, createdAt: now, ...row } as typeof tasks.$inferInsert).run();
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("DELETE /api/tasks/[id]", () => {
  it("cancels running mesh tasks among the deleted descendants", async () => {
    await insertTask({ id: "P", status: "queued", execution: null });
    await insertTask({ id: "C", status: "running", kanbanColumn: "in_progress", execution: "mesh", parentId: "P" });
    const { DELETE } = await import("@/app/api/tasks/[id]/route");

    const res = await DELETE(new NextRequest("http://x/api/tasks/P", { method: "DELETE" }), params("P"));

    expect(res.status).toBe(200);
    const cancels = requestSpy.mock.calls.filter((c) => (c as unknown[])[0] === "mesh.tasks.cancel");
    expect(cancels.map((c) => JSON.parse((c as unknown[])[1] as string).task_id)).toEqual(["C"]);
  });

  // collectDescendants recursed through a parent_id cycle until the stack overflowed (500).
  it("deletes a parent_id cycle instead of overflowing the stack", async () => {
    await insertTask({ id: "A", status: "queued", parentId: "B" });
    await insertTask({ id: "B", status: "queued", parentId: "A" });
    const { DELETE } = await import("@/app/api/tasks/[id]/route");

    const res = await DELETE(new NextRequest("http://x/api/tasks/A", { method: "DELETE" }), params("A"));

    expect(res.status).toBe(200);
    const { getRawDb } = await import("@/lib/db");
    expect(getRawDb().prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  });
});

describe("parent_id cycles", () => {
  it("PATCH refuses a parent that is the task itself or one of its descendants", async () => {
    await insertTask({ id: "P", status: "queued" });
    await insertTask({ id: "C", status: "queued", parentId: "P" });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const patch = (parent: string) =>
      PATCH(new NextRequest("http://x/api/tasks/P", { method: "PATCH", body: JSON.stringify({ parent_id: parent }) }), params("P"));

    expect((await patch("C")).status).toBe(400);
    expect((await patch("P")).status).toBe(400);
    const { getRawDb } = await import("@/lib/db");
    expect(getRawDb().prepare("SELECT parent_id FROM tasks WHERE id = 'P'").get()).toEqual({ parent_id: null });
  });

  it("POST refuses a custom id equal to its parent_id", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(new NextRequest("http://x/api/tasks", { method: "POST", body: JSON.stringify({ title: "t", id: "X", parent_id: "X" }) }));
    expect(res.status).toBe(400);
  });

  // UNION ALL never terminates on a cycle; a synchronous SQLite call cannot be timed out, so this runs only with the fix.
  it("the subtree query terminates on a cycle already in the table", async () => {
    await insertTask({ id: "A", status: "queued", parentId: "B" });
    await insertTask({ id: "B", status: "queued", parentId: "A" });
    const { GET } = await import("@/app/api/tasks/[id]/tree/route");

    const res = await GET(new NextRequest("http://x/api/tasks/A/tree"), params("A"));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }[]).map((r) => r.id).sort()).toEqual(["A", "B"]);
  });
});

describe("PATCH /api/tasks/[id]", () => {
  it("reports the done-gate's waiting-user/review, not completed/done", async () => {
    const { AGENT_NAME } = await import("@/lib/config");
    await insertTask({ id: "T", status: "running", kanbanColumn: "in_progress", owner: AGENT_NAME, needsApproval: 0 });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");

    const req = new NextRequest("http://x/api/tasks/T", { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    const res = await PATCH(req, params("T"));

    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("waiting-user");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [type, text] = logSpy.mock.calls[0] as unknown as [string, string];
    expect(type).toBe("task_updated");
    expect(text).toContain("status → waiting-user");
    expect(text).not.toContain("completed");
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect((notifySpy.mock.calls[0] as unknown as [string])[0]).toMatch(/to waiting-user$/);
  });
});
