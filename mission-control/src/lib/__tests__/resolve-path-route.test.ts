import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let home: string;
let ws: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-resolve-path-home-"));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "mc-resolve-path-ws-"));
  process.env.HOME = home;
  vi.stubEnv("WORKSPACE_ROOT", ws);
  vi.resetModules();
  fs.mkdirSync(path.join(ws, "a", "b", "c"), { recursive: true });
  fs.writeFileSync(path.join(ws, "a", "b", "c", "target.md"), "x");
  fs.mkdirSync(path.join(home, "Documents", "deep"), { recursive: true });
  fs.writeFileSync(path.join(home, "Documents", "deep", "other.md"), "y");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

async function resolve(name: string) {
  const { POST } = await import("@/app/api/resolve-path/route");
  const res = await POST(
    new NextRequest("http://127.0.0.1/api/resolve-path", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()).path as string | null;
}

test("resolves basenames without blocking the server on a synchronous walk", async () => {
  const readdirSync = vi.spyOn(fs, "readdirSync");
  expect(await resolve("target.md")).toBe(path.join(ws, "a", "b", "c", "target.md"));
  expect(await resolve("other.md")).toBe(path.join(home, "Documents", "deep", "other.md"));
  expect(await resolve("missing.md")).toBeNull();
  expect(readdirSync).not.toHaveBeenCalled();
});
