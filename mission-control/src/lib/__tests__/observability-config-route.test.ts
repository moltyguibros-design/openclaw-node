import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

// The trace-mode switch used to publish an unsigned { mode } nothing subscribed
// to, report success either way, and say "dev" while every daemon ran "smart".

const { publishSpy, natsState, signSpy, messages } = vi.hoisted(() => ({
  publishSpy: vi.fn(),
  natsState: { up: true },
  signSpy: vi.fn(async (p: object) => ({ ...p, operator_action: true, signature: "sig", signer_pubkey: "pk" })),
  messages: [] as { subject: string; data: string }[],
}));

vi.mock("@/lib/nats", () => ({
  getNats: async () => (natsState.up ? {
    publish: publishSpy,
    subscribe: () => ({
      unsubscribe() {},
      async *[Symbol.asyncIterator]() { for (const m of messages) yield m; },
    }),
  } : null),
  sc: { encode: (s: string) => s, decode: (s: string) => s },
}));
vi.mock("@/lib/mesh-sign", () => ({ signOperatorRequest: signSpy }));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-obs-config-"));
  vi.stubEnv("OPENCLAW_HOME", home);
  vi.stubEnv("OPENCLAW_TRACE_MODE", "");
  vi.resetModules();
  publishSpy.mockClear();
  signSpy.mockClear();
  natsState.up = true;
  messages.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(home, { recursive: true, force: true });
});

const patch = (mode: string) =>
  new NextRequest("http://x/api/observability/config", { method: "PATCH", body: JSON.stringify({ mode }) });

test("GET reports the daemons' start mode (smart unless OPENCLAW_TRACE_MODE says dev)", async () => {
  const { GET } = await import("@/app/api/observability/config/route");
  expect((await (await GET()).json()).mode).toBe("smart");
});

test("PATCH publishes a signed operator request and reports the new mode", async () => {
  const { GET, PATCH } = await import("@/app/api/observability/config/route");
  const res = await PATCH(patch("dev"));
  expect(res.status).toBe(200);
  expect(signSpy).toHaveBeenCalledWith({ mode: "dev" });
  expect(publishSpy).toHaveBeenCalledTimes(1);
  const [subject, payload] = publishSpy.mock.calls[0] as [string, string];
  expect(subject).toBe("openclaw.trace.config");
  expect(JSON.parse(payload)).toMatchObject({ mode: "dev", operator_action: true, signature: "sig" });
  expect((await (await GET()).json()).mode).toBe("dev");
});

test("PATCH without NATS or without a signer changes nothing and says so", async () => {
  const { GET, PATCH } = await import("@/app/api/observability/config/route");
  natsState.up = false;
  expect((await PATCH(patch("dev"))).status).toBe(503);
  natsState.up = true;
  signSpy.mockRejectedValueOnce(new Error("operator-auth.mjs not found"));
  expect((await PATCH(patch("dev"))).status).toBe(503);
  expect(publishSpy).not.toHaveBeenCalled();
  expect((await (await GET()).json()).mode).toBe("smart");
});

test("the SSE stream does not relay the switch as a trace event", async () => {
  messages.push(
    { subject: "openclaw.trace.config", data: JSON.stringify({ mode: "dev" }) },
    { subject: "openclaw.trace.node-a.mesh-tasks", data: JSON.stringify({ function: "claim" }) },
  );
  const { GET } = await import("@/app/api/observability/stream/route");
  const res = await GET();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("claim")) text += decoder.decode((await reader.read()).value);
  await reader.cancel();
  expect(text).not.toContain('"sourceNode":"config"');
  expect(text.match(/event: trace/g)).toHaveLength(1);
});
