import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const daemonSays = (body: object) => async () => ({ data: JSON.stringify(body) });
const { requestSpy, notifySpy, logSpy } = vi.hoisted(() => ({
  requestSpy: vi.fn(async (..._args: unknown[]): Promise<{ data: string }> => ({ data: JSON.stringify({ ok: true }) })),
  notifySpy: vi.fn(async () => true),
  logSpy: vi.fn(),
}));

vi.mock("@/lib/nats", () => ({
  getNats: async () => ({ request: requestSpy, publish: vi.fn() }),
  sc: { encode: (s: string) => s, decode: (s: string) => s },
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
  requestSpy.mockReset();
  requestSpy.mockImplementation(daemonSays({ ok: true }));
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

// Operator decision: a refused or unreachable cancel changes nothing in Mission Control.
describe("mesh cancel must be accepted before the row changes", () => {
  const rowStatus = async (id: string) => {
    const { getRawDb } = await import("@/lib/db");
    return (getRawDb().prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string } | undefined)?.status;
  };

  it("DELETE keeps the row when the daemon refuses the cancel", async () => {
    await insertTask({ id: "M", status: "running", kanbanColumn: "in_progress", execution: "mesh" });
    requestSpy.mockImplementation(daemonSays({ ok: false, error: "cancel refused: bad signature" }));
    const { DELETE } = await import("@/app/api/tasks/[id]/route");

    const res = await DELETE(new NextRequest("http://x/api/tasks/M", { method: "DELETE" }), params("M"));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("bad signature");
    expect(await rowStatus("M")).toBe("running");
  });

  it("DELETE keeps the row when the daemon cannot be reached", async () => {
    await insertTask({ id: "M", status: "running", kanbanColumn: "in_progress", execution: "mesh" });
    requestSpy.mockImplementation(async () => { throw new Error("TIMEOUT"); });
    const { DELETE } = await import("@/app/api/tasks/[id]/route");

    const res = await DELETE(new NextRequest("http://x/api/tasks/M", { method: "DELETE" }), params("M"));

    expect(res.status).toBe(503);
    expect(await rowStatus("M")).toBe("running");
  });

  it("DELETE of a subtree marks the children the daemon did cancel and deletes nothing", async () => {
    await insertTask({ id: "P", status: "queued", execution: null });
    await insertTask({ id: "C1", status: "running", kanbanColumn: "in_progress", execution: "mesh", parentId: "P" });
    await insertTask({ id: "C2", status: "running", kanbanColumn: "in_progress", execution: "mesh", parentId: "P" });
    requestSpy
      .mockImplementationOnce(daemonSays({ ok: true }))
      .mockImplementationOnce(daemonSays({ ok: false, error: "cancel refused" }));
    const { DELETE } = await import("@/app/api/tasks/[id]/route");

    const res = await DELETE(new NextRequest("http://x/api/tasks/P", { method: "DELETE" }), params("P"));

    expect(res.status).toBe(502);
    expect(await rowStatus("C1")).toBe("cancelled");
    expect(await rowStatus("C2")).toBe("running");
    expect(await rowStatus("P")).toBe("queued");
  });

  it("DELETE proceeds for a mesh task the daemon never received, or one that already ended", async () => {
    await insertTask({ id: "Q", status: "queued", execution: "mesh" });
    requestSpy.mockImplementation(daemonSays({ ok: false, error: "Task Q not found", code: "TASK_NOT_FOUND" }));
    const { DELETE } = await import("@/app/api/tasks/[id]/route");
    expect((await DELETE(new NextRequest("http://x/api/tasks/Q", { method: "DELETE" }), params("Q"))).status).toBe(200);

    await insertTask({ id: "E", status: "running", kanbanColumn: "in_progress", execution: "mesh" });
    requestSpy.mockImplementation(daemonSays({ ok: false, error: "Task E is already completed", code: "TASK_TERMINAL" }));
    expect((await DELETE(new NextRequest("http://x/api/tasks/E", { method: "DELETE" }), params("E"))).status).toBe(200);
  });

  it("PATCH to cancelled leaves the row as it was when the daemon refuses", async () => {
    await insertTask({ id: "M", status: "running", kanbanColumn: "in_progress", execution: "mesh" });
    requestSpy.mockImplementation(daemonSays({ ok: false, error: "cancel refused: not authorized" }));
    const { PATCH } = await import("@/app/api/tasks/[id]/route");

    // force_done: without it the done-gate turns a move to the done column into waiting-user.
    const req = new NextRequest("http://x/api/tasks/M", { method: "PATCH", body: JSON.stringify({ status: "cancelled", force_done: true }) });
    const res = await PATCH(req, params("M"));

    expect(res.status).toBe(502);
    expect(await rowStatus("M")).toBe("running");
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

// The scheduler's recurring copy of a one-time trigger has no next time and never fires.
describe("recurring one-time triggers are refused", () => {
  const row = async (id: string) => {
    const { getRawDb } = await import("@/lib/db");
    return getRawDb().prepare("SELECT trigger_kind, is_recurring, status FROM tasks WHERE id = ?").get(id);
  };

  it("POST refuses is_recurring with trigger_kind at, and accepts it with cron", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const post = (body: object) => POST(new NextRequest("http://x/api/tasks", { method: "POST", body: JSON.stringify({ title: "t", ...body }) }));

    expect((await post({ id: "A", trigger_kind: "at", trigger_at: "2026-12-01T10:00:00Z", is_recurring: true })).status).toBe(400);
    expect(await row("A")).toBeUndefined();
    expect((await post({ id: "C", trigger_kind: "cron", trigger_cron: "0 10 * * 1", is_recurring: true })).status).toBe(201);
  });

  it("PATCH refuses making an at task recurring, or a recurring task one-time", async () => {
    await insertTask({ id: "A", status: "queued", triggerKind: "at", triggerAt: "2026-12-01T10:00:00Z" });
    await insertTask({ id: "R", status: "queued", triggerKind: "cron", triggerCron: "0 10 * * 1", isRecurring: 1 });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const patch = (id: string, body: object) =>
      PATCH(new NextRequest(`http://x/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }), params(id));

    expect((await patch("A", { is_recurring: true })).status).toBe(400);
    expect((await patch("R", { trigger_kind: "at", trigger_at: "2026-12-01T10:00:00Z" })).status).toBe(400);
    expect(await row("A")).toMatchObject({ trigger_kind: "at", is_recurring: 0 });
    expect(await row("R")).toMatchObject({ trigger_kind: "cron", is_recurring: 1 });
    expect((await patch("R", { trigger_kind: "at", is_recurring: false })).status).toBe(200);
  });

  it("PATCH still moves an existing at+recurring row when it touches neither field", async () => {
    await insertTask({ id: "L", status: "queued", triggerKind: "at", isRecurring: 1 });
    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const res = await PATCH(new NextRequest("http://x/api/tasks/L", { method: "PATCH", body: JSON.stringify({ status: "blocked" }) }), params("L"));
    expect(res.status).toBe(200);
  });
});

// A custom id is written raw as the `- task_id:` line, so a newline in it forges a second task block.
describe("custom ids stay on one line", () => {
  it("POST /api/tasks refuses an id with a newline", async () => {
    const { POST } = await import("@/app/api/tasks/route");
    const res = await POST(new NextRequest("http://x/api/tasks", { method: "POST", body: JSON.stringify({ title: "t", id: "A\n- task_id: B" }) }));
    expect(res.status).toBe(400);
  });

  it("POST /api/projects refuses an id with a newline", async () => {
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(new NextRequest("http://x/api/projects", { method: "POST", body: JSON.stringify({ title: "p", id: "A\r\nB" }) }));
    expect(res.status).toBe(400);
  });
});
