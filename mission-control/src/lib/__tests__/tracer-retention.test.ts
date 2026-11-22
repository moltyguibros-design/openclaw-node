import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({
  getNats: async () => null,
  sc: { encode: (s: string) => new TextEncoder().encode(s) },
}));

let root: string | undefined;
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  clearInterval(g.__obs_prune_timer as ReturnType<typeof setInterval>);
  delete g.__obs_prune_timer;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

// Daemons (lib/obs-db.js) and trace ingest insert without pruning, so retention cannot ride on MC's own traced calls.
test("the hourly prune drops events past the 24h retention with no traced call", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tracer-retention-"));
  vi.stubEnv("DB_PATH", path.join(root, "mc.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();

  const { getRawDb } = await import("@/lib/db");
  const raw = getRawDb();
  try {
    const realNow = Date.now();
    const insert = raw.prepare(
      "INSERT INTO observability_events (id, timestamp, node_id, module, function, category) VALUES (?, ?, 'n', 'daemon', 'f', 'compute')",
    );
    insert.run("old", realNow - 23.5 * 3_600_000);
    insert.run("fresh", realNow - 3_600_000);
    const ids = () => (raw.prepare("SELECT id FROM observability_events ORDER BY id").all() as { id: string }[]).map((r) => r.id);

    vi.useFakeTimers({ now: realNow, toFake: ["setInterval", "clearInterval", "Date"] });
    const { startObservabilityPrune } = await import("@/lib/tracer");
    startObservabilityPrune();
    startObservabilityPrune();
    expect(ids()).toEqual(["fresh", "old"]);

    vi.advanceTimersByTime(61 * 60_000);
    expect(ids()).toEqual(["fresh"]);
  } finally {
    raw.close();
  }
});
