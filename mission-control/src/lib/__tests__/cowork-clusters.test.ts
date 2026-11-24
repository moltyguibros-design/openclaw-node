import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({
  getHealthKv: async () => null,
  sc: { decode: (b: Uint8Array) => new TextDecoder().decode(b) },
}));

let root: string;
let db: Database.Database | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cowork-clusters-"));
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

async function create(body: Record<string, unknown>) {
  const { getRawDb } = await import("@/lib/db");
  db = getRawDb();
  const { POST } = await import("@/app/api/cowork/clusters/route");
  return POST(
    new NextRequest("http://localhost/api/cowork/clusters", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

async function archive(id: string) {
  const { DELETE } = await import("@/app/api/cowork/clusters/[id]/route");
  return DELETE(new NextRequest(`http://localhost/api/cowork/clusters/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

function memberIds(id: string) {
  return db!
    .prepare("SELECT node_id FROM cluster_members WHERE cluster_id = ? ORDER BY node_id")
    .all(id)
    .map((r) => (r as { node_id: string }).node_id);
}

test("an active cluster's slug cannot be taken twice", async () => {
  expect((await create({ name: "Security Team" })).status).toBe(200);
  expect((await create({ name: "Security Team" })).status).toBe(409);
});

test("re-creating an archived cluster revives it with the new members", async () => {
  expect((await create({ name: "Security Team", members: [{ nodeId: "a" }] })).status).toBe(200);
  expect((await archive("security-team")).status).toBe(200);

  const res = await create({
    name: "Security Team",
    description: "again",
    members: [{ nodeId: "a" }, { nodeId: "b" }],
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "security-team", name: "Security Team" });
  expect(
    db!.prepare("SELECT status, description FROM clusters WHERE id = ?").get("security-team")
  ).toEqual({ status: "active", description: "again" });
  expect(memberIds("security-team")).toEqual(["a", "b"]);
});
