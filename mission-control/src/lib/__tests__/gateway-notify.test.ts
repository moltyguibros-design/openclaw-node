import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { traceCall } = vi.hoisted(() => ({ traceCall: vi.fn() }));
vi.mock("@/lib/tracer", () => ({ traceCall }));

interface Server {
  open(ws: FakeWS): void;
  request(ws: FakeWS, frame: { method?: string }): void;
}

const later = (fn: () => void) => { void Promise.resolve().then(fn); };
const challenge = (ws: FakeWS) => ws.deliver({ type: "event", event: "connect.challenge" });

let server: Server;
let thrown: unknown[];

class FakeWS {
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  private closed = false;
  constructor() { later(() => server.open(this)); }
  send(raw: string) { const frame = JSON.parse(raw); later(() => server.request(this, frame)); }
  close() { later(() => this.serverClose()); }
  deliver(frame: unknown) {
    try {
      this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
    } catch (err) {
      thrown.push(err);
    }
  }
  serverClose() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

let tmp: string;
let gatewayNotify: (text: string) => Promise<boolean>;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gateway-notify-"));
  fs.writeFileSync(path.join(tmp, "openclaw.json"), JSON.stringify({ gateway: { auth: { token: "t" } } }));
  vi.stubEnv("OPENCLAW_HOME", tmp);
  vi.stubGlobal("WebSocket", FakeWS);
  ({ gatewayNotify } = await import("@/lib/gateway-notify"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  traceCall.mockClear();
  thrown = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function settle(p: Promise<boolean>): Promise<boolean | undefined> {
  let result: boolean | undefined;
  void p.then((v) => { result = v; });
  await vi.advanceTimersByTimeAsync(6000);
  return result;
}

test("a rejected connect followed by a clean close resolves false and traces the error", async () => {
  server = {
    open: challenge,
    request(ws, frame) {
      if (frame.method !== "connect") return;
      ws.deliver({ type: "res", ok: false, error: { message: "auth" } });
      later(() => ws.serverClose());
    },
  };
  expect(await settle(gatewayNotify("x"))).toBe(false);
  expect(traceCall).toHaveBeenCalledWith("gateway-notify", "gatewayNotify", expect.any(Number), undefined, "auth");
});

test("a clean close with no reply resolves false", async () => {
  server = {
    open: challenge,
    request(ws) { later(() => ws.serverClose()); },
  };
  expect(await settle(gatewayNotify("x"))).toBe(false);
});

test("a non-JSON frame is ignored instead of throwing from the message handler", async () => {
  server = {
    open(ws) {
      ws.deliver("ping");
      later(() => ws.serverClose());
    },
    request() {},
  };
  expect(await settle(gatewayNotify("x"))).toBe(false);
  expect(thrown).toEqual([]);
});

test("an accepted chat.send still resolves true when the socket closes afterwards", async () => {
  server = {
    open: challenge,
    request(ws, frame) {
      if (frame.method === "connect") ws.deliver({ type: "res", ok: true, payload: { type: "hello-ok" } });
      if (frame.method === "chat.send") ws.deliver({ type: "res", ok: true, payload: { runId: "r1" } });
    },
  };
  expect(await settle(gatewayNotify("x"))).toBe(true);
  expect(traceCall).toHaveBeenCalledWith("gateway-notify", "gatewayNotify", expect.any(Number), "ok");
});
