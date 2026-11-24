import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

type Callback = (err: Error | null, msg: { subject: string; data: Uint8Array }) => void;
const { bus } = vi.hoisted(() => ({
  bus: { subs: [] as { subject: string; callback: Callback; closed: boolean }[] },
}));

vi.mock("@/lib/nats", () => {
  const nc = {
    subscribe(subject: string, opts: { callback: Callback }) {
      const sub = { subject, callback: opts.callback, closed: false, isClosed() { return this.closed; }, unsubscribe() { this.closed = true; } };
      bus.subs.push(sub);
      return sub;
    },
  };
  return {
    getNats: async () => nc,
    sc: { encode: (s: string) => new TextEncoder().encode(s), decode: (b: Uint8Array) => new TextDecoder().decode(b) },
  };
});

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-trace-ingest-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  bus.subs.length = 0;
  delete (globalThis as Record<string, unknown>).__trace_ingest_nc;
  delete (globalThis as Record<string, unknown>).__trace_ingest_sub;
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

const daemonEvent = (over: Record<string, unknown> = {}) => ({
  id: "remote-1", timestamp: Date.now(), node_id: "worker-b", module: "mesh-tasks", function: "claim",
  tier: 1, category: "state_transition", args_summary: "T-1", result_summary: "ok", duration_ms: 12,
  error: null, meta: { from: "pending" }, ...over,
});

function deliver(subject: string, payload: unknown) {
  const data = new TextEncoder().encode(typeof payload === "string" ? payload : JSON.stringify(payload));
  for (const s of bus.subs) if (!s.closed) s.callback(null, { subject, data });
}

// Remote nodes' daemons write their own host's database, so without an
// ingester their traces never reached this dashboard.
test("a remote node's trace on openclaw.trace.> lands in the events feed", async () => {
  const { ensureTraceIngest, flushTraceRows } = await import("@/lib/trace-ingest");
  expect(await ensureTraceIngest()).toBe(true);
  expect(await ensureTraceIngest()).toBe(true);
  expect(bus.subs.map((s) => s.subject)).toEqual(["openclaw.trace.>"]);

  deliver("openclaw.trace.worker-b.mesh-tasks", daemonEvent());
  deliver("openclaw.trace.worker-c.mc", {
    id: "remote-mc", timestamp: Date.now(), nodeId: "worker-c", module: "mc", fn: "GET",
    tier: 2, category: "api_call", argsSummary: "GET /tasks", resultSummary: "200 3ms", durationMs: 3, error: null, meta: null,
  });
  expect(flushTraceRows()).toBe(2);

  const { GET } = await import("@/app/api/observability/events/route");
  const res = await GET(new NextRequest("http://127.0.0.1/api/observability/events?hours=1"));
  const { events } = (await res.json()) as { events: Record<string, unknown>[] };
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  expect(byId["remote-1"]).toMatchObject({ node_id: "worker-b", module: "mesh-tasks", function: "claim", tier: 1 });
  expect(byId["remote-mc"]).toMatchObject({ node_id: "worker-c", function: "GET", args_summary: "GET /tasks" });
});

test("an event already written by a same-host daemon is stored once", async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb()
    .prepare("INSERT INTO observability_events (id, timestamp, node_id, module, function, tier, category) VALUES ('local-1', ?, 'here', 'daemon', 'tick', 2, 'lifecycle')")
    .run(Date.now());
  const { ensureTraceIngest, flushTraceRows } = await import("@/lib/trace-ingest");
  await ensureTraceIngest();
  deliver("openclaw.trace.here.daemon", daemonEvent({ id: "local-1", node_id: "here", module: "daemon", function: "tick" }));
  expect(flushTraceRows()).toBe(0);
  const { c } = getRawDb().prepare("SELECT COUNT(*) AS c FROM observability_events").get() as { c: number };
  expect(c).toBe(1);
});

test("the server's instrumentation hook starts the ingester and the retention prune, but not during a build", async () => {
  const g = globalThis as Record<string, unknown>;
  try {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await (await import("@/instrumentation")).register();
    expect(g.__trace_ingest_timer).toBeFalsy();
    expect(g.__obs_prune_timer).toBeFalsy();

    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    await (await import("@/instrumentation")).register();
    await vi.waitFor(() => expect(bus.subs.map((s) => s.subject)).toEqual(["openclaw.trace.>"]));
    expect(g.__obs_prune_timer).toBeTruthy();
  } finally {
    clearInterval(g.__trace_ingest_timer as ReturnType<typeof setInterval>);
    delete g.__trace_ingest_timer;
    clearInterval(g.__obs_prune_timer as ReturnType<typeof setInterval>);
    delete g.__obs_prune_timer;
  }
});

test("the mode switch, malformed payloads and events naming another node are not stored", async () => {
  const { ensureTraceIngest, flushTraceRows } = await import("@/lib/trace-ingest");
  await ensureTraceIngest();
  deliver("openclaw.trace.config", { mode: "dev", id: "cfg", timestamp: 1, node_id: "config", module: "x", function: "y", category: "z" });
  deliver("openclaw.trace.worker-b.mesh-tasks", "not json");
  deliver("openclaw.trace.worker-b.mesh-tasks", daemonEvent({ id: "spoof", node_id: "worker-a" }));
  deliver("openclaw.trace.worker-b.mesh-tasks", daemonEvent({ id: "no-ts", timestamp: "soon" }));
  expect(flushTraceRows()).toBe(0);
});
