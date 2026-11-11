import { afterEach, expect, it, vi } from "vitest";

vi.mock("swr", () => ({ default: vi.fn(), mutate: vi.fn(async () => undefined) }));

import { interveneSession } from "../hooks";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status: number) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

it("rejects with the route's error on a non-2xx reply, so the session card can show it", async () => {
  vi.stubGlobal("fetch", reply({ error: "NATS unavailable" }, 503));
  await expect(interveneSession({ action: "abort", sessionId: "s1" })).rejects.toThrow("NATS unavailable");
});

it("resolves the body on success", async () => {
  vi.stubGlobal("fetch", reply({ ok: true, action: "aborted" }, 200));
  await expect(interveneSession({ action: "abort", sessionId: "s1" })).resolves.toEqual({
    ok: true,
    action: "aborted",
  });
});
