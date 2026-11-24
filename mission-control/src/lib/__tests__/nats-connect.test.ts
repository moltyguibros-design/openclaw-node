import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { connect } = vi.hoisted(() => ({
  connect: vi.fn(async (_opts: unknown) => ({ isClosed: () => false, closed: () => new Promise(() => {}) })),
}));
vi.mock("nats", async (orig) => ({ ...(await orig<typeof import("nats")>()), connect }));

let home: string | undefined;

afterEach(() => {
  for (const k of ["__nats_nc", "__nats_connecting", "__nats_failedAt"]) delete (globalThis as Record<string, unknown>)[k];
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  connect.mockReset();
  connect.mockImplementation(async () => ({ isClosed: () => false, closed: () => new Promise(() => {}) }));
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("URL and token come from $OPENCLAW_HOME/openclaw.env, quotes stripped, like the auth mode", async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-nats-connect-"));
  fs.writeFileSync(path.join(home, "openclaw.env"), "OPENCLAW_NATS=\"nats://10.1.2.3:4222\"\nOPENCLAW_NATS_TOKEN='tok'\n");
  vi.stubEnv("OPENCLAW_HOME", home);
  vi.stubEnv("OPENCLAW_NATS", "");
  vi.stubEnv("OPENCLAW_NATS_TOKEN", "");
  vi.stubEnv("OPENCLAW_NATS_AUTH", "");
  delete (globalThis as { __nats_nc?: unknown }).__nats_nc;
  vi.resetModules();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const { getNats } = await import("@/lib/nats");
    await getNats();
  } finally {
    log.mockRestore();
  }
  expect(connect).toHaveBeenCalledWith(expect.objectContaining({ servers: "nats://10.1.2.3:4222", token: "tok" }));
});

test("a bucket MC creates carries OPENCLAW_KV_REPLICAS from openclaw.env", async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-nats-connect-"));
  fs.writeFileSync(path.join(home, "openclaw.env"), "OPENCLAW_KV_REPLICAS=3\n");
  vi.stubEnv("OPENCLAW_HOME", home);
  vi.stubEnv("OPENCLAW_KV_REPLICAS", "");
  const kv = vi.fn(async (bucket: string, opts: unknown) => ({ bucket, opts }));
  connect.mockImplementationOnce(async () => ({
    isClosed: () => false,
    closed: () => new Promise(() => {}),
    jetstream: () => ({ views: { kv } }),
  }));
  for (const k of ["__nats_nc", "__nats_tasksKv", "__nats_collabKv", "__nats_healthKv"]) {
    delete (globalThis as Record<string, unknown>)[k];
  }
  vi.resetModules();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const { getTasksKv, getCollabKv, getHealthKv } = await import("@/lib/nats");
    await getTasksKv();
    await getCollabKv();
    await getHealthKv();
  } finally {
    log.mockRestore();
    for (const k of ["__nats_tasksKv", "__nats_collabKv", "__nats_healthKv"]) {
      delete (globalThis as Record<string, unknown>)[k];
    }
  }
  expect(kv).toHaveBeenCalledTimes(3);
  for (const [, opts] of kv.mock.calls) expect(opts).toEqual(expect.objectContaining({ replicas: 3 }));
});

test("concurrent callers during a connect share the attempt instead of getting null", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  connect.mockImplementationOnce(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return { isClosed: () => false, closed: () => new Promise(() => {}) };
  });
  const { getNats } = await import("@/lib/nats");
  const [a, b] = await Promise.all([getNats(), getNats()]);
  expect(a).not.toBeNull();
  expect(b).toBe(a);
  expect(connect).toHaveBeenCalledTimes(1);
});

test("after a failed connect, calls within 5s return null without reconnecting or logging again", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  connect.mockRejectedValue(new Error("down"));
  const { getNats } = await import("@/lib/nats");
  expect(await getNats()).toBeNull();
  expect(await getNats()).toBeNull();
  expect(connect).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(5001);
  expect(await getNats()).toBeNull();
  expect(connect).toHaveBeenCalledTimes(2);
});
