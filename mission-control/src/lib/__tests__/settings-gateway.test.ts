import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;
let configPath: string;
const original = JSON.stringify({ gateway: { auth: { token: "t" } } }, null, 2) + "\n";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-settings-gateway-"));
  configPath = path.join(root, "openclaw.json");
  fs.writeFileSync(configPath, original, { mode: 0o600 });
  vi.stubEnv("OPENCLAW_HOME", root);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

async function patch(body: unknown) {
  const { PATCH } = await import("@/app/api/settings/gateway/route");
  return PATCH(
    new NextRequest("http://localhost/api/settings/gateway", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );
}

test("saving replaces openclaw.json by rename, keeps it 0600 and keeps the token", async () => {
  const before = fs.statSync(configPath).ino;
  const res = await patch({ heartbeat: { target: "last" } });
  expect(res.status).toBe(200);
  const after = fs.statSync(configPath);
  expect(after.mode & 0o777).toBe(0o600);
  expect(after.ino).not.toBe(before);
  expect(fs.readdirSync(root)).toEqual(["openclaw.json"]);
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  expect(saved.gateway.auth.token).toBe("t");
  expect(saved.agents.defaults.heartbeat).toEqual({ target: "last" });
});

test.each([
  { maxConcurrent: "abc" },
  { maxConcurrent: 0 },
  { maxConcurrent: 2.5 },
  { compaction: "x" },
  { compaction: null },
  { compaction: [] },
])("rejects %j without touching openclaw.json", async body => {
  const res = await patch(body);
  expect(res.status).toBe(400);
  expect(fs.readFileSync(configPath, "utf8")).toBe(original);
});

test("accepts a positive integer maxConcurrent and an object compaction", async () => {
  const res = await patch({ maxConcurrent: 3, compaction: { mode: "safeguard" } });
  expect(res.status).toBe(200);
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  expect(saved.agents.defaults.maxConcurrent).toBe(3);
  expect(saved.agents.defaults.compaction).toEqual({ mode: "safeguard" });
});
