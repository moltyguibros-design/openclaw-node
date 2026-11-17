/**
 * mesh-tasks-route.test.ts — /api/mesh/tasks and /api/mesh/tasks/:id.
 *
 * POST overwrote an existing task_id and PATCH merged any body field (status,
 * owner, lease, result, requires_review) into MESH_TASKS KV, past every daemon
 * check (mission-control-app#19 part 2, mission-control-app~2#6). Both now go
 * through the task daemon, whose lib/mesh-tasks.js EDITABLE_TASK_FIELDS is the
 * one list of editable fields, and never write KV themselves. The GET routes
 * read KV through lib/sync/mesh-kv.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockKV } from "./mocks/mock-kv";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const h = vi.hoisted(() => ({
  kv: null as unknown,
  request: vi.fn(async (..._args: unknown[]): Promise<{ data: Uint8Array }> => ({ data: new Uint8Array() })),
  sign: vi.fn(async (p: object) => ({ ...p, signature: "sig" })),
}));

vi.mock("@/lib/nats", () => ({
  getNats: async () => ({ request: h.request }),
  getTasksKv: async () => h.kv,
  sc: {
    encode: (s: string) => encoder.encode(s),
    decode: (b: Uint8Array) => decoder.decode(b),
  },
}));
vi.mock("@/lib/mesh-sign", () => ({ signOperatorRequest: h.sign }));

let kv: MockKV;
let kvWrites: ReturnType<typeof vi.fn>;

const daemonSays = (body: object) => async () => ({ data: encoder.encode(JSON.stringify(body)) });
const sent = () => h.request.mock.calls.map(([subject, data]) => ({ subject, body: JSON.parse(decoder.decode(data as Uint8Array)) }));
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(over: Record<string, unknown> = {}) {
  const t = { task_id: "T-1", title: "work", status: "running", owner: "worker-2", origin: "lead-node", priority: 1, ...over };
  return kv.put(String(t.task_id), encoder.encode(JSON.stringify(t)));
}
const stored = async (id = "T-1") => JSON.parse(decoder.decode((await kv.get(id))!.value));

beforeEach(async () => {
  kv = new MockKV();
  h.kv = kv;
  kvWrites = vi.fn();
  await seed();
  for (const method of ["put", "update", "create", "delete"] as const) {
    const original = (kv as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
    if (typeof original !== "function") continue;
    (kv as unknown as Record<string, unknown>)[method] = (...a: unknown[]) => {
      kvWrites(method, ...a);
      return original.apply(kv, a);
    };
  }
  h.request.mockReset();
  h.sign.mockClear();
});

async function post(body: object) {
  const { POST } = await import("@/app/api/mesh/tasks/route");
  return POST(new Request("http://x/api/mesh/tasks", { method: "POST", body: JSON.stringify(body) }));
}

async function patch(id: string, body: object) {
  const { PATCH } = await import("@/app/api/mesh/tasks/[id]/route");
  return PATCH(new Request(`http://x/api/mesh/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }), params(id));
}

describe("POST /api/mesh/tasks", () => {
  it("submits through the daemon with only proposer fields, and writes no KV", async () => {
    h.request.mockImplementation(daemonSays({ ok: true, data: { task_id: "T-2", status: "queued" } }));
    const res = await post({ task_id: "T-2", title: "work", priority: 2, status: "completed", owner: "me", requires_review: false });
    expect(res.status).toBe(201);
    expect((await res.json()).task).toEqual({ task_id: "T-2", status: "queued" });
    expect(sent()).toEqual([{ subject: "mesh.tasks.submit", body: { task_id: "T-2", title: "work", priority: 2 } }]);
    expect(kvWrites).not.toHaveBeenCalled();
  });

  it("never overwrites an existing task_id: the daemon's TASK_EXISTS is a 409", async () => {
    h.request.mockImplementation(daemonSays({ ok: false, error: "Task T-1 already exists", code: "TASK_EXISTS" }));
    const res = await post({ task_id: "T-1", title: "hijack" });
    expect(res.status).toBe(409);
    expect(kvWrites).not.toHaveBeenCalled();
    expect((await stored()).title).toBe("work");
  });

  it("refuses an unsafe task_id before reaching the daemon", async () => {
    const res = await post({ task_id: "../x", title: "work" });
    expect(res.status).toBe(400);
    expect(h.request).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/mesh/tasks/:id", () => {
  it("sends a signed mesh.tasks.update for the path's task, and writes no KV", async () => {
    h.request.mockImplementation(daemonSays({ ok: true, data: { task_id: "T-1", title: "renamed" } }));
    const res = await patch("T-1", { title: "renamed", task_id: "OTHER" });
    expect(res.status).toBe(200);
    expect(h.sign).toHaveBeenCalledWith({ title: "renamed", task_id: "T-1" });
    expect(sent()).toEqual([{ subject: "mesh.tasks.update", body: { title: "renamed", task_id: "T-1", signature: "sig" } }]);
    expect(kvWrites).not.toHaveBeenCalled();
  });

  it("refuses lifecycle fields (status, owner, lease, result) with 400 and leaves the task as it was", async () => {
    h.request.mockImplementation(daemonSays({ ok: false, error: "Update refused: status, owner, lease_token, result cannot be edited", code: "INVALID_UPDATE" }));
    const res = await patch("T-1", { status: "completed", owner: "lead-node", lease_token: "x", result: { success: true } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/status, owner, lease_token, result cannot be edited/);
    expect(kvWrites).not.toHaveBeenCalled();
    const t = await stored();
    expect(t.status).toBe("running");
    expect(t.owner).toBe("worker-2");
  });

  it.each([
    ["INVALID_UPDATE", 400],
    ["TASK_NOT_FOUND", 404],
    ["TASK_TERMINAL", 409],
  ])("maps a daemon %s refusal to %i", async (code, status) => {
    h.request.mockImplementation(daemonSays({ ok: false, error: "refused", code }));
    const res = await patch("T-1", { title: "x" });
    expect(res.status).toBe(status);
    expect(kvWrites).not.toHaveBeenCalled();
  });

  it("changes nothing when signing is unavailable", async () => {
    h.sign.mockImplementationOnce(async () => { throw new Error("operator-auth.mjs not found"); });
    const res = await patch("T-1", { title: "renamed" });
    expect(res.status).toBe(500);
    expect(h.request).not.toHaveBeenCalled();
  });
});

describe("GET routes", () => {
  it("list and get read the same KV", async () => {
    const { GET: list } = await import("@/app/api/mesh/tasks/route");
    const { GET: getOne } = await import("@/app/api/mesh/tasks/[id]/route");
    const all = await (await list()).json();
    expect(all.natsAvailable).toBe(true);
    expect(all.tasks.map((t: { task_id: string }) => t.task_id)).toEqual(["T-1"]);
    const one = await (await getOne(new Request("http://localhost"), params("T-1"))).json();
    expect(one.revision).toBeGreaterThan(0);
    expect(one.task.title).toBe("work");
  });

  it("report NATS unavailable", async () => {
    h.kv = null;
    const { GET: list } = await import("@/app/api/mesh/tasks/route");
    const { GET: getOne } = await import("@/app/api/mesh/tasks/[id]/route");
    expect(await (await list()).json()).toEqual({ tasks: [], natsAvailable: false });
    expect((await getOne(new Request("http://localhost"), params("T-1"))).status).toBe(503);
  });
});
