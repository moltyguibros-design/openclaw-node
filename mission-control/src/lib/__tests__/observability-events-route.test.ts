import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const { publishSpy } = vi.hoisted(() => ({ publishSpy: vi.fn() }));

vi.mock("@/lib/nats", () => ({
  getNats: async () => ({ publish: publishSpy }),
  sc: { encode: (s: string) => s },
}));

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-obs-events-route-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
  publishSpy.mockClear();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

test("polling the events feed does not trace itself into the table it serves", async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb()
    .prepare(
      "INSERT INTO observability_events (id, timestamp, node_id, module, function, tier, category) VALUES ('e1', ?, 'n1', 'daemon', 'tick', 2, 'lifecycle')",
    )
    .run(Date.now());

  const { GET } = await import("@/app/api/observability/events/route");
  const poll = () => GET(new NextRequest("http://127.0.0.1/api/observability/events?hours=24&limit=10"));
  expect((await poll()).status).toBe(200);
  const second = await poll();
  const { events } = (await second.json()) as { events: { id: string }[] };

  expect(events.map((e) => e.id)).toEqual(["e1"]);
  await new Promise((r) => setTimeout(r, 0));
  expect(publishSpy).not.toHaveBeenCalled();
  const { c } = getRawDb().prepare("SELECT COUNT(*) AS c FROM observability_events").get() as { c: number };
  expect(c).toBe(1);
});
