import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({
  getNats: async () => null,
  sc: { encode: (s: string) => new TextEncoder().encode(s) },
}));
vi.mock("@/lib/sync/tasks", () => ({ syncTasksToMarkdown: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));

let root: string;
let db: Database.Database | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cowork-dispatch-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
});

afterEach(() => {
  db?.close();
  db = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

async function openDb() {
  const { getRawDb } = await import("@/lib/db");
  db = getRawDb();
  return db;
}

async function post(body: Record<string, unknown>) {
  await openDb();
  const { POST } = await import("@/app/api/cowork/dispatch/route");
  return POST(
    new NextRequest("http://localhost/api/cowork/dispatch", {
      method: "POST",
      body: JSON.stringify({ title: "t", ...body }),
    })
  );
}

function dispatch(nodes: unknown[]) {
  return post({ nodes });
}

async function seedCluster(status: string) {
  const raw = await openDb();
  raw
    .prepare("INSERT INTO clusters (id, name, status, updated_at) VALUES ('c', 'C', ?, ?)")
    .run(status, new Date().toISOString());
  const member = raw.prepare("INSERT INTO cluster_members (cluster_id, node_id) VALUES ('c', ?)");
  member.run("a");
  member.run("b");
}

test("node entries without an id do not count toward the 2-node minimum", async () => {
  const res = await dispatch([{ nodeId: "a" }, { role: "worker" }]);
  expect(res.status).toBe(400);
  expect(db!.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({ n: 0 });
});

test("two real node ids dispatch a collab task", async () => {
  const res = await dispatch([{ nodeId: "a" }, { node_id: "b" }, { role: "worker" }]);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.nodesAssigned).toEqual(["a", "b"]);
  const row = db!.prepare("SELECT preferred_nodes FROM tasks WHERE id = ?").get(body.taskId);
  expect(row).toEqual({ preferred_nodes: JSON.stringify(["a", "b"]) });
});

test("an active cluster's members are dispatched", async () => {
  await seedCluster("active");
  const res = await post({ clusterId: "c" });
  expect(res.status).toBe(200);
  expect((await res.json()).nodesAssigned).toEqual(["a", "b"]);
});

test("an archived cluster is refused and no task is created", async () => {
  await seedCluster("archived");
  const res = await post({ clusterId: "c" });
  expect(res.status).toBe(400);
  expect(db!.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({ n: 0 });
});

test("an unknown cluster id is refused", async () => {
  const res = await post({ clusterId: "missing", nodes: [{ nodeId: "a" }, { nodeId: "b" }] });
  expect(res.status).toBe(400);
  expect(db!.prepare("SELECT count(*) AS n FROM tasks").get()).toEqual({ n: 0 });
});
