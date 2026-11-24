import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proxy-"));
  vi.stubEnv("WORKSPACE_ROOT", path.join(root, "workspace"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

// Next 16 deprecates src/middleware.ts for src/proxy.ts, whose handler is `proxy` and which may not declare a runtime.
test("src/proxy.ts is the auth gate: it denies a bare /api request and admits the session token", async () => {
  const { proxy, config } = await import("@/proxy");
  expect(config.matcher).toEqual(["/((?!_next/static|_next/image|favicon.ico).*)"]);
  expect(config).not.toHaveProperty("runtime");

  const host = "127.0.0.1:3000";
  const denied = proxy(new NextRequest("http://127.0.0.1:3000/api/tasks", { headers: { host } }));
  expect(denied.status).toBe(401);
  expect(await denied.json()).toEqual({ error: "token" });

  const token = fs.readFileSync(path.join(root, "config", "mc-session-token"), "utf8").trim();
  const allowed = proxy(
    new NextRequest("http://127.0.0.1:3000/api/tasks", { headers: { host, authorization: `Bearer ${token}` } }),
  );
  expect(allowed.headers.get("x-middleware-next")).toBe("1");
});

test("src/middleware.ts is gone, so the build never sees both conventions", () => {
  expect(fs.existsSync(path.join(__dirname, "..", "..", "middleware.ts"))).toBe(false);
});
