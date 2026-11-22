import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("@/lib/nats", () => ({
  getNats: async () => null,
  sc: { encode: (s: string) => new TextEncoder().encode(s) },
}));

let root: string | undefined;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

// The home page polls /api/activity every 3s per open tab; a traced read wrote an
// observability row (and a NATS publish) for every poll.
test("reading recent activity writes no observability rows", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-activity-read-"));
  vi.stubEnv("DB_PATH", path.join(root, "mc.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { getRawDb } = await import("@/lib/db");
  const raw = getRawDb();
  try {
    const { getRecentActivity, logActivity } = await import("@/lib/activity");
    logActivity("task_created", "made one", "T-1");
    const count = () => (raw.prepare("SELECT COUNT(*) AS c FROM observability_events").get() as { c: number }).c;
    const before = count();

    for (let i = 0; i < 3; i++) expect(getRecentActivity()).toHaveLength(1);
    expect(count()).toBe(before);
  } finally {
    raw.close();
  }
});
