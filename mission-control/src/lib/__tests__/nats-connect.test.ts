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
  delete (globalThis as { __nats_nc?: unknown }).__nats_nc;
  vi.unstubAllEnvs();
  vi.resetModules();
  connect.mockClear();
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
