import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  request: vi.fn(async (..._args: unknown[]): Promise<{ data: string }> => ({ data: JSON.stringify({ ok: true }) })),
  publish: vi.fn(),
  put: vi.fn(async (..._args: unknown[]) => 1),
  session: null as Record<string, unknown> | null,
  sign: vi.fn(async (p: object) => p),
}));

vi.mock("@/lib/nats", () => ({
  getNats: async () => ({ request: h.request, publish: h.publish }),
  getCollabKv: async () => ({
    get: async () => ({ value: JSON.stringify(h.session) }),
    put: h.put,
  }),
  sc: { encode: (s: string) => s, decode: (s: string) => s },
}));
vi.mock("@/lib/mesh-sign", () => ({ signOperatorRequest: h.sign }));
vi.mock("@/lib/sync/tasks", () => ({ syncTasksToMarkdown: vi.fn() }));

const daemonSays = (body: object) => async () => ({ data: JSON.stringify(body) });
let root: string;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-intervene-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  h.request.mockReset();
  h.request.mockImplementation(daemonSays({ ok: true }));
  h.publish.mockClear();
  h.put.mockClear();
  h.sign.mockReset();
  h.sign.mockImplementation(async (p: object) => p);
  h.session = {
    session_id: "S",
    task_id: "T",
    status: "active",
    nodes: [{ node_id: "n1", status: "active" }, { node_id: "n2", status: "active" }],
    rounds: [{ reflections: [] }],
  };
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const now = new Date().toISOString();
  getDb().insert(tasks).values({ id: "T", title: "T", status: "running", kanbanColumn: "in_progress", execution: "mesh", updatedAt: now, createdAt: now } as typeof tasks.$inferInsert).run();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

async function intervene(body: object) {
  const { POST } = await import("@/app/api/cowork/intervene/route");
  return POST(new NextRequest("http://x/api/cowork/intervene", { method: "POST", body: JSON.stringify(body) }));
}

const taskStatus = async () => {
  const { getRawDb } = await import("@/lib/db");
  return (getRawDb().prepare("SELECT status FROM tasks WHERE id = 'T'").get() as { status: string }).status;
};

describe("operator interventions change nothing unless the task daemon accepts", () => {
  for (const action of ["abort", "force_converge"]) {
    it(`${action}: a daemon refusal answers 502 with its reason and leaves KV, events and Kanban alone`, async () => {
      h.request.mockImplementation(daemonSays({ ok: false, error: "refused: signature invalid" }));
      const res = await intervene({ action, sessionId: "S" });
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain("signature invalid");
      expect(h.put).not.toHaveBeenCalled();
      expect(h.publish).not.toHaveBeenCalled();
      expect(await taskStatus()).toBe("running");
    });

    it(`${action}: an unreachable daemon answers 503 and changes nothing`, async () => {
      h.request.mockImplementation(async () => { throw new Error("TIMEOUT"); });
      const res = await intervene({ action, sessionId: "S" });
      expect(res.status).toBe(503);
      expect(h.put).not.toHaveBeenCalled();
      expect(await taskStatus()).toBe("running");
    });

    it(`${action}: a signing failure is reported, not swallowed, and nothing is sent`, async () => {
      h.sign.mockImplementation(async () => { throw new Error("operator-auth.mjs not found"); });
      const res = await intervene({ action, sessionId: "S" });
      expect(res.status).toBe(500);
      expect((await res.json()).error).toContain("operator-auth.mjs not found");
      expect(h.request).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
    });
  }

  it("abort: an accepted cancel updates KV, publishes and moves the Kanban row", async () => {
    const res = await intervene({ action: "abort", sessionId: "S" });
    expect(res.status).toBe(200);
    expect(JSON.parse(h.put.mock.calls[0][1] as string).status).toBe("aborted");
    expect(h.publish).toHaveBeenCalledWith("mesh.events.collab.aborted", expect.any(String));
    expect(await taskStatus()).toBe("cancelled");
  });

  it("abort: a task that already ended still lets the session be aborted", async () => {
    h.request.mockImplementation(daemonSays({ ok: false, error: "Task T is already failed", code: "TASK_TERMINAL" }));
    expect((await intervene({ action: "abort", sessionId: "S" })).status).toBe(200);
  });

  it("force_converge: an accepted complete marks the session converged and the row done", async () => {
    h.request.mockImplementation(daemonSays({ ok: true, data: { task_id: "T", status: "completed" } }));
    const res = await intervene({ action: "force_converge", sessionId: "S" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "force_converged" });
    expect(JSON.parse(h.put.mock.calls[0][1] as string).status).toBe("converged");
    expect(await taskStatus()).toBe("done");
  });

  it("force_converge: a task the daemon parked in pending_review goes to Review with the approve command", async () => {
    h.request.mockImplementation(daemonSays({ ok: true, data: { task_id: "T", status: "pending_review" } }));
    const res = await intervene({ action: "force_converge", sessionId: "S" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, action: "force_converged", pendingReview: true });
    const { getRawDb } = await import("@/lib/db");
    expect(getRawDb().prepare("SELECT status, kanban_column, next_action FROM tasks WHERE id = 'T'").get()).toEqual({
      status: "waiting-user",
      kanban_column: "review",
      next_action: "mesh tasks approve T",
    });
  });

  it("remove_node: a refused or unreachable leave changes nothing (no direct-KV fallback)", async () => {
    h.request.mockImplementation(daemonSays({ ok: false, error: "Session S not found" }));
    expect((await intervene({ action: "remove_node", sessionId: "S", nodeId: "n2" })).status).toBe(502);
    h.request.mockImplementation(async () => { throw new Error("503 no responders"); });
    expect((await intervene({ action: "remove_node", sessionId: "S", nodeId: "n2" })).status).toBe(503);
    expect(h.put).not.toHaveBeenCalled();
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("remove_node: the stop notice to the removed node is signed and names it as the target", async () => {
    h.sign.mockImplementation(async (p: object) => ({ ...p, signature: "sig" }));
    expect((await intervene({ action: "remove_node", sessionId: "S", nodeId: "n2" })).status).toBe(200);
    const stop = h.publish.mock.calls.find((c) => c[0] === "mesh.agent.n2.stall");
    expect(stop).toBeDefined();
    expect(JSON.parse(stop![1] as string)).toEqual({
      task_id: "T", target_node_id: "n2", reason: "Removed by operator", signature: "sig",
    });
  });
});
