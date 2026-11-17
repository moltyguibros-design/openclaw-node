/**
 * /api/souls registry writes. A corrupt or unreadable registry.json used to
 * read as empty, so one POST overwrote every other soul; ids were
 * mass-assigned from the body with no SAFE_ID check, and PATCH could rename one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const SYNC_REGISTRY = path.resolve(__dirname, "../../../../souls/sync-registry.js");

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
    expect(fs.readdirSync(path.dirname(registryPath)).sort()).toEqual(["ok", "registry.json"]);
    expect(fs.readdirSync(path.join(path.dirname(registryPath), "ok"))).toEqual(["capabilities.json"]);
  });

  it("a soul registered by POST survives sync-registry.js, which rebuilds from capabilities.json", async () => {
    const soulsDir = path.dirname(registryPath);
    writeRegistry(JSON.stringify({ version: "1.0.0", souls: [] }));
    const capabilities = { skills: ["s1"], tools: ["Read"], mcpServers: [] };
    const res = await route.POST(req("POST", "http://127.0.0.1:3000/api/souls", {
      id: "mc-made", type: "specialist", capabilities, specializations: ["x"],
    }));
    expect(res.status).toBe(201);
    expect(JSON.parse(fs.readFileSync(path.join(soulsDir, "mc-made", "capabilities.json"), "utf8"))).toEqual(capabilities);

    fs.copyFileSync(SYNC_REGISTRY, path.join(soulsDir, "sync-registry.js"));
    execFileSync(process.execPath, [path.join(soulsDir, "sync-registry.js")], { stdio: "pipe" });
    const synced = JSON.parse(fs.readFileSync(registryPath, "utf8")).souls;
    expect(synced.map((s: { id: string }) => s.id)).toEqual(["mc-made"]);
    expect(synced[0].capabilities).toEqual(capabilities);
    expect(synced[0].specializations).toEqual(["x"]);

    execFileSync(process.execPath, [path.join(soulsDir, "sync-registry.js")], { stdio: "pipe" });
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8")).souls[0].updatedAt).toBe(synced[0].updatedAt);
  });

  it("PATCH of capabilities rewrites capabilities.json and keeps its other keys", async () => {
    const soulsDir = path.dirname(registryPath);
    writeRegistry(JSON.stringify({ version: "1.0.0", souls: [{ id: "a", capabilities: { skills: [], tools: [], mcpServers: [] } }] }));
    fs.mkdirSync(path.join(soulsDir, "a"));
    fs.writeFileSync(path.join(soulsDir, "a", "capabilities.json"),
      JSON.stringify({ skills: [], tools: [], mcpServers: [], permissions: { memory: { shared: "read" } } }));
    const res = await route.PATCH(req("PATCH", "http://127.0.0.1:3000/api/souls?id=a", {
      capabilities: { skills: ["new"], tools: ["Bash"], mcpServers: [] },
    }));
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(soulsDir, "a", "capabilities.json"), "utf8"))).toEqual({
      skills: ["new"], tools: ["Bash"], mcpServers: [], permissions: { memory: { shared: "read" } },
    });
  });
});
