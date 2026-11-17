import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

// The handoff and soul-prompt routes read and wrote memory-vault/handoffs for any soul;
// each soul's capabilities.json permissions.memory now decides (lib/soul-memory-access.mjs).

let home: string;

function soul(id: string, handoffs: string) {
  const dir = path.join(home, ".openclaw", "souls", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "capabilities.json"), JSON.stringify({ tools: ["Read"], permissions: { memory: { shared: "read", private: [id], handoffs } } }));
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-soul-access-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("DB_PATH", path.join(home, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", path.join(home, ".openclaw", "workspace"));
  vi.resetModules();
  soul("reader", "read");
  soul("writer", "readwrite");
  soul("blind", "none");
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const now = new Date().toISOString();
  getDb().insert(tasks).values([
    { id: "T-1", title: "audit", status: "running", kanbanColumn: "in_progress", updatedAt: now, createdAt: now },
    { id: "T-2", title: "audit", status: "running", kanbanColumn: "in_progress", soulId: "reader", updatedAt: now, createdAt: now },
  ] as (typeof tasks.$inferInsert)[]).run();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(home, { recursive: true, force: true });
});

async function handoff(taskId: string, toSoul: string) {
  const { POST } = await import("@/app/api/tasks/[id]/handoff/route");
  return POST(new NextRequest(`http://x/api/tasks/${taskId}/handoff`, { method: "POST", body: JSON.stringify({ toSoul, reason: "expertise" }) }), { params: Promise.resolve({ id: taskId }) });
}

const handoffDoc = (taskId: string) => path.join(home, ".openclaw", "workspace", "memory-vault", "handoffs", `${taskId}-handoff.md`);

describe("POST /api/tasks/:id/handoff", () => {
  it("hands off to a soul that may read handoffs", async () => {
    const res = await handoff("T-1", "reader");
    expect(res.status).toBe(200);
    expect(fs.existsSync(handoffDoc("T-1"))).toBe(true);
  });

  it("refuses a receiver without handoffs read, and writes nothing", async () => {
    const res = await handoff("T-1", "blind");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/blind may not read handoffs/);
    expect(fs.existsSync(handoffDoc("T-1"))).toBe(false);
  });

  it("refuses a handing-off soul without handoffs write", async () => {
    const res = await handoff("T-2", "writer");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/reader may not write handoffs/);
  });

  it("refuses an unknown or unsafe receiver", async () => {
    expect((await handoff("T-1", "nobody")).status).toBe(403);
    expect((await handoff("T-1", "../x")).status).toBe(400);
  });
});

describe("POST /api/souls/:id/prompt", () => {
  async function prompt(soulId: string) {
    fs.mkdirSync(path.dirname(handoffDoc("T-1")), { recursive: true });
    fs.writeFileSync(handoffDoc("T-1"), "HANDOFF BODY");
    const { POST } = await import("@/app/api/souls/[id]/prompt/route");
    const res = await POST(new NextRequest(`http://x/api/souls/${soulId}/prompt`, { method: "POST", body: JSON.stringify({ taskId: "T-1" }) }), { params: Promise.resolve({ id: soulId }) });
    return (await res.json()).preamble as string;
  }

  it("includes the handoff doc for a soul that may read handoffs", async () => {
    expect(await prompt("reader")).toContain("HANDOFF BODY");
  });

  it("withholds it from a soul that may not", async () => {
    const preamble = await prompt("blind");
    expect(preamble).not.toContain("HANDOFF BODY");
    expect(preamble).toMatch(/Withheld: blind may not read handoffs/);
  });
});
