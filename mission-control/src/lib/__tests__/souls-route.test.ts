/**
 * /api/souls registry writes. A corrupt or unreadable registry.json used to
 * read as empty, so one POST overwrote every other soul; ids were
 * mass-assigned from the body with no SAFE_ID check, and PATCH could rename one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let home: string;
let prevHome: string | undefined;
let registryPath: string;
let route: typeof import("@/app/api/souls/route");

function req(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as never;
}

function writeRegistry(content: string) {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, content);
}

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "souls-route-"));
  process.env.HOME = home;
  registryPath = path.join(home, ".openclaw", "souls", "registry.json");
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  route = await import("@/app/api/souls/route");
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("/api/souls", () => {
  it("POST on a corrupt registry fails and leaves the file untouched", async () => {
    const corrupt = '{"version":"1.0.0","souls":[{"id":"a"';
    writeRegistry(corrupt);
    const res = await route.POST(req("POST", "http://127.0.0.1:3000/api/souls", { id: "b" }));
    expect(res.status).toBe(500);
    expect(fs.readFileSync(registryPath, "utf8")).toBe(corrupt);
  });

  it("POST refuses an id outside the safe alphabet", async () => {
    writeRegistry(JSON.stringify({ version: "1.0.0", souls: [] }));
    const res = await route.POST(req("POST", "http://127.0.0.1:3000/api/souls", { id: "../x" }));
    expect(res.status).toBe(400);
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8")).souls).toEqual([]);
  });

  it("PATCH cannot rename a soul", async () => {
    writeRegistry(JSON.stringify({ version: "1.0.0", souls: [{ id: "a", type: "specialist" }] }));
    const res = await route.PATCH(req("PATCH", "http://127.0.0.1:3000/api/souls?id=a", { id: "z" }));
    expect(res.status).toBe(400);
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8")).souls.map((s: { id: string }) => s.id)).toEqual(["a"]);
  });

  it("POST with no registry yet creates it with the one soul", async () => {
    const res = await route.POST(req("POST", "http://127.0.0.1:3000/api/souls", { id: "ok" }));
    expect(res.status).toBe(201);
    const souls = JSON.parse(fs.readFileSync(registryPath, "utf8")).souls;
    expect(souls.map((s: { id: string }) => s.id)).toEqual(["ok"]);
    expect(fs.readdirSync(path.dirname(registryPath))).toEqual(["registry.json"]);
  });
});
