import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let home: string;
let prevHome: string | undefined;
let soulsDir: string;

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-souls-propagate-"));
  process.env.HOME = home;
  vi.stubEnv("DB_PATH", path.join(home, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", path.join(home, "workspace"));
  vi.resetModules();

  soulsDir = path.join(home, ".openclaw", "souls");
  fs.mkdirSync(path.join(soulsDir, "src", "evolution"), { recursive: true });
  fs.mkdirSync(path.join(soulsDir, "dst"), { recursive: true });
  const event = {
    eventId: "evt_1",
    soulId: "src",
    category: "learning",
    trigger: "t",
    summary: "s",
    proposedChange: { target: "genes.json", action: "add", content: {} },
    reviewStatus: "pending",
  };
  fs.writeFileSync(path.join(soulsDir, "src", "evolution", "events.jsonl"), JSON.stringify(event) + "\n");

  const { getRawDb } = await import("@/lib/db");
  getRawDb()
    .prepare(
      "INSERT INTO soul_evolution_log (soul_id, event_id, event_type, description, review_status) VALUES ('src', 'evt_1', 'learning', 's', 'pending')",
    )
    .run();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

async function propagate() {
  const { POST } = await import("@/app/api/souls/[id]/propagate/route");
  return POST(
    new NextRequest("http://127.0.0.1/api/souls/src/propagate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceEventId: "evt_1", targetSoulId: "dst" }),
    }),
    { params: Promise.resolve({ id: "src" }) },
  );
}

const targetEvents = () => path.join(soulsDir, "dst", "evolution", "events.jsonl");

async function approve() {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().prepare("UPDATE soul_evolution_log SET review_status = 'approved' WHERE event_id = 'evt_1'").run();
}

test("an event that is not approved is not propagated", async () => {
  const res = await propagate();
  expect(res.status).toBe(409);
  expect(fs.existsSync(targetEvents())).toBe(false);
});

test("a rejected event is not propagated", async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().prepare("UPDATE soul_evolution_log SET review_status = 'rejected' WHERE event_id = 'evt_1'").run();
  const res = await propagate();
  expect(res.status).toBe(409);
  expect(fs.existsSync(targetEvents())).toBe(false);
});

test("an approved event propagates once; a repeat is a no-op success", async () => {
  await approve();
  const first = await propagate();
  expect(first.status).toBe(200);
  expect((await first.json()).alreadyPropagated).toBeUndefined();

  const second = await propagate();
  expect(second.status).toBe(200);
  expect((await second.json()).alreadyPropagated).toBe(true);

  const lines = fs.readFileSync(targetEvents(), "utf-8").trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).eventId).toBe("evt_1-propagate-dst");

  const { getRawDb } = await import("@/lib/db");
  const { c } = getRawDb()
    .prepare("SELECT COUNT(*) AS c FROM soul_evolution_log WHERE event_id = 'evt_1-propagate-dst'")
    .get() as { c: number };
  expect(c).toBe(1);
});
