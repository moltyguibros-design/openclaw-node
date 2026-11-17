/**
 * mesh-tasks-route.test.ts — /api/mesh/tasks and /api/mesh/tasks/:id against a
 * MockKV-backed @/lib/nats (audit mission-control-app#19, part 2 option B).
 *
 * The routes kept their own copies of the KV logic: PATCH merged any body
 * field into the task, so a Mission Control instance could set status, owner,
 * lease or result without the task daemon's checks, and POST blind-put a
 * caller-chosen task_id over an existing task. They now go through
 * lib/sync/mesh-kv.ts, whose updateMeshTaskCAS edits only a field whitelist
 * and whose proposeMeshTask never overwrites.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MockKV } from "./mocks/mock-kv";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let kv: MockKV | null;
const cfg = { nodeId: "lead-node", nodeRole: "lead" as "lead" | "worker" };

vi.mock("@/lib/nats", () => ({
  getTasksKv: async () => kv,
  sc: {
    encode: (s: string) => encoder.encode(s),
    decode: (b: Uint8Array) => decoder.decode(b),
  },
}));

vi.mock("@/lib/config", () => ({
  get NODE_ID() {
    return cfg.nodeId;
  },
  get NODE_ROLE() {
    return cfg.nodeRole;
  },
}));

import { GET as list, POST } from "@/app/api/mesh/tasks/route";
import { GET as getOne, PATCH } from "@/app/api/mesh/tasks/[id]/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) =>
  new Request("http://localhost/api/mesh/tasks", { method: "POST", body: JSON.stringify(body) });

async function seed(over: Record<string, unknown> = {}) {
  const t = { task_id: "T-1", title: "work", status: "running", owner: "worker-2", origin: "lead-node", priority: 1, ...over };
  const rev = await kv!.put(String(t.task_id), encoder.encode(JSON.stringify(t)));
  return rev;
}

const stored = async (id = "T-1") => JSON.parse(decoder.decode((await kv!.get(id))!.value));

beforeEach(() => {
  kv = new MockKV();
  cfg.nodeId = "lead-node";
  cfg.nodeRole = "lead";
});

describe("PATCH /api/mesh/tasks/:id", () => {
  it("edits a whitelisted field and returns the task with its new revision", async () => {
    const rev = await seed();
    const res = await PATCH(json({ title: "renamed", priority: 4, revision: rev }), params("T-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.title).toBe("renamed");
    expect(body.revision).toBeGreaterThan(rev);
    expect((await stored()).priority).toBe(4);
  });

  it("refuses lifecycle fields (status, owner, lease, result) with 400 and writes nothing", async () => {
    const rev = await seed();
    const res = await PATCH(
      json({ status: "completed", owner: "lead-node", lease_token: "x", result: { success: true }, revision: rev }),
      params("T-1")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Fields not editable: status, owner, lease_token, result/);
    const t = await stored();
    expect(t.status).toBe("running");
    expect(t.owner).toBe("worker-2");
  });

  it("a worker editing a foreign task gets 403", async () => {
    cfg.nodeRole = "worker";
    cfg.nodeId = "worker-1";
    const rev = await seed();
    const res = await PATCH(json({ title: "mine now", revision: rev }), params("T-1"));
    expect(res.status).toBe(403);
  });

  it("a stale revision gets 409 with the current task", async () => {
    const rev = await seed();
    await PATCH(json({ title: "first", revision: rev }), params("T-1"));
    const res = await PATCH(json({ title: "second", revision: rev }), params("T-1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.currentTask.title).toBe("first");
    expect(body.currentRevision).toBeGreaterThan(rev);
  });

  it("an unknown task gets 404", async () => {
    const res = await PATCH(json({ title: "x", revision: 1 }), params("nope"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/mesh/tasks", () => {
  it("never overwrites an existing task_id", async () => {
    await seed();
    const res = await POST(json({ task_id: "T-1", title: "hijack" }));
    expect(res.status).toBe(409);
    expect((await stored()).title).toBe("work");
  });

  it("a worker's proposal lands as proposed with its origin", async () => {
    cfg.nodeRole = "worker";
    cfg.nodeId = "worker-1";
    const res = await POST(json({ title: "idea", status: "completed", owner: "worker-1" }));
    expect(res.status).toBe(201);
    const { task } = await res.json();
    expect(task.status).toBe("proposed");
    expect(task.origin).toBe("worker-1");
    expect(task.owner).toBeNull();
    expect((await stored(task.task_id)).status).toBe("proposed");
  });
});

describe("GET routes", () => {
  it("list and get read the same KV", async () => {
    const rev = await seed();
    const all = await (await list()).json();
    expect(all.natsAvailable).toBe(true);
    expect(all.tasks.map((t: { task_id: string }) => t.task_id)).toEqual(["T-1"]);
    const one = await (await getOne(new Request("http://localhost"), params("T-1"))).json();
    expect(one.revision).toBe(rev);
    expect(one.task.title).toBe("work");
  });

  it("report NATS unavailable", async () => {
    kv = null;
    expect(await (await list()).json()).toEqual({ tasks: [], natsAvailable: false });
    expect((await getOne(new Request("http://localhost"), params("T-1"))).status).toBe(503);
  });
});
