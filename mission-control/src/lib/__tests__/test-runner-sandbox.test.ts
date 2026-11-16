import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// Diagnostics "Run All Tests" used to drive schedulerTick() and the markdown
// sync on the live database: it dispatched a phantom task to the live agent
// (gateway notify + dispatch signal) and wrote __TEST__ tasks into the live
// active-tasks.md. It now runs those suites in a throw-away sandbox.

vi.mock("@/lib/nats", () => ({ getNats: async () => ({ publish: () => {} }), sc: { encode: (s: string) => s } }));

let root: string;
let gateway: net.Server;
let gatewayConnections = 0;
const liveWs = () => path.join(root, "live-ws");
const liveMd = () => path.join(liveWs(), "memory", "active-tasks.md");
const LIVE_MD = "# Active Tasks\n\n## Live Tasks\n\n- task_id: REAL-1\n  title: Real backlog task\n  status: queued\n";

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-runner-sandbox-"));
  gatewayConnections = 0;
  gateway = net.createServer((sock) => { gatewayConnections++; sock.destroy(); });
  await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", () => r()));
  const port = (gateway.address() as net.AddressInfo).port;
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "openclaw.json"), JSON.stringify({ gateway: { port, host: "127.0.0.1", auth: { token: "t" } } }));
  fs.mkdirSync(path.join(liveWs(), "memory"), { recursive: true });
  fs.writeFileSync(liveMd(), LIVE_MD);
  vi.stubEnv("OPENCLAW_HOME", home);
  vi.stubEnv("WORKSPACE_ROOT", liveWs());
  vi.stubEnv("DB_PATH", path.join(root, "live.db"));
  vi.stubEnv("OPENCLAW_NODE_ROLE", "lead");
  vi.resetModules();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  await new Promise((r) => gateway.close(r));
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("POST /api/diagnostics/test-runner", () => {
  it("runs its dispatch and sync suites without touching the live agent, DB or active-tasks.md", async () => {
    const { getDb, getRawDb } = await import("@/lib/db");
    const { tasks } = await import("@/lib/db/schema");
    const now = new Date().toISOString();
    getDb().insert(tasks).values({
      id: "REAL-1", title: "Real backlog task", status: "queued", kanbanColumn: "backlog",
      needsApproval: 0, triggerKind: "none", execution: "local", updatedAt: now, createdAt: now,
    }).run();
    const live = getRawDb();
    const activityBefore = (live.prepare("SELECT COUNT(*) AS c FROM activity_log").get() as { c: number }).c;

    const { POST } = await import("@/app/api/diagnostics/test-runner/route");
    const body = await (await POST()).json();
    await new Promise((r) => setTimeout(r, 100));

    const failed = body.results.filter((r: { status: string }) => r.status === "fail");
    expect(failed).toEqual([]);
    const byName = (n: string) => body.results.find((r: { name: string }) => r.name === n);
    expect(byName("Auto-dispatch task with needsApproval=0").status).toBe("pass");
    expect(byName("Mesh task syncs to markdown with execution fields").status).toBe("pass");
    expect(byName("Recurring task recreates after done").status).toBe("pass");

    expect(gatewayConnections).toBe(0);
    expect(fs.existsSync(path.join(liveWs(), ".tmp"))).toBe(false);
    expect(fs.readFileSync(liveMd(), "utf8")).toBe(LIVE_MD);
    expect((live.prepare("SELECT COUNT(*) AS c FROM tasks WHERE id GLOB '__TEST__*'").get() as { c: number }).c).toBe(0);
    expect((live.prepare("SELECT status, owner FROM tasks WHERE id = 'REAL-1'").get())).toEqual({ status: "queued", owner: null });
    expect((live.prepare("SELECT COUNT(*) AS c FROM tasks").get() as { c: number }).c).toBe(1);
    expect((live.prepare("SELECT COUNT(*) AS c FROM activity_log").get() as { c: number }).c).toBe(activityBefore);
  });
});
