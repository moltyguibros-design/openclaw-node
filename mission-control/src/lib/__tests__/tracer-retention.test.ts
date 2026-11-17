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

test("a traced call prunes events past the 24h retention while MC stays up, not only at startup", async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tracer-retention-"));
  vi.stubEnv("DB_PATH", path.join(root, "mc.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { getRawDb } = await import("@/lib/db");
  const raw = getRawDb();
  try {
    const realNow = Date.now();
    raw
      .prepare("INSERT INTO observability_events (id, timestamp, node_id, module, function, category) VALUES ('old', ?, 'n', 'm', 'f', 'compute')")
      .run(realNow - 25 * 3_600_000);

    const count = (where: string) => (raw.prepare(`SELECT COUNT(*) AS c FROM observability_events WHERE ${where}`).get() as { c: number }).c;
    const { traceCall } = await import("@/lib/tracer");
    traceCall("t", "f", Date.now());
    expect(count("id = 'old'")).toBe(1);

    vi.spyOn(Date, "now").mockReturnValue(realNow + 61 * 60_000);
    traceCall("t", "f", Date.now());
    expect(count("id = 'old'")).toBe(0);
    expect(count("module = 't' AND function = 'f'")).toBe(2);
  } finally {
    raw.close();
  }
});
