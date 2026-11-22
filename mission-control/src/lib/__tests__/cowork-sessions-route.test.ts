import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

// MESH_COLLAB is never purged, so the route used to await one KV get per
// session ever created, one after another, and return them all for a page
// that shows only the 8 newest finished ones.
const store = new Map<string, Uint8Array>();
let inFlight = 0;
let maxInFlight = 0;
let gets = 0;

vi.mock("@/lib/nats", () => ({
  sc: { decode: (b: Uint8Array) => new TextDecoder().decode(b) },
  getCollabKv: async () => ({
    keys: async () =>
      (async function* () {
        yield* store.keys();
      })(),
    get: async (key: string) => {
      gets++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { value: store.get(key) };
    },
  }),
}));

function seed(id: string, status: string, minute: number) {
  const created_at = new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
  store.set(id, new TextEncoder().encode(JSON.stringify({ session_id: id, status, created_at })));
}

async function get(query: string) {
  const { GET } = await import("@/app/api/cowork/sessions/route");
  const res = await GET(new NextRequest(`http://localhost/api/cowork/sessions${query}`));
  return (await res.json()) as { sessions: Array<{ session_id: string; status: string }> };
}

afterEach(() => {
  store.clear();
  inFlight = 0;
  maxInFlight = 0;
  gets = 0;
});

test("terminal sessions: the gets run concurrently and only the newest N come back", async () => {
  for (let i = 0; i < 30; i++) seed(`done-${i}`, i % 3 === 0 ? "aborted" : "completed", i);
  seed("live", "active", 40);

  const { sessions } = await get("?status=converged,completed,aborted&limit=8");

  expect(maxInFlight).toBeGreaterThan(1);
  expect(sessions).toHaveLength(8);
  expect(new Set(sessions.map((s) => s.session_id))).toEqual(
    new Set(Array.from({ length: 8 }, (_, k) => `done-${29 - k}`))
  );
});

test("without a limit every matching session is returned", async () => {
  for (let i = 0; i < 12; i++) seed(`s-${i}`, "completed", i);
  const { sessions } = await get("?status=completed");
  expect(sessions).toHaveLength(12);
  expect(sessions[0].session_id).toBe("s-11");
});

test("live sessions are read through the daemon's index.live, not a scan of every session", async () => {
  for (let i = 0; i < 50; i++) seed(`done-${i}`, "completed", i);
  seed("a1", "active", 51);
  seed("a2", "recruiting", 52);
  seed("gone", "completed", 53);
  store.set("index.live", new TextEncoder().encode(JSON.stringify({ a1: "active", a2: "recruiting", gone: "active" })));

  const { sessions } = await get("?status=recruiting,active");

  expect(sessions.map((s) => s.session_id).sort()).toEqual(["a1", "a2"]);
  expect(gets).toBe(4);
});

test("without index.live a live query still finds the live sessions by scanning", async () => {
  for (let i = 0; i < 5; i++) seed(`done-${i}`, "completed", i);
  seed("a1", "active", 10);
  seed("a2", "recruiting", 11);

  const { sessions } = await get("?status=recruiting,active");

  expect(sessions.map((s) => s.session_id).sort()).toEqual(["a1", "a2"]);
});

