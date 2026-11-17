import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LINES = 40_000;
let root: string;
let GET: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-file-"));
  const logs = path.join(root, "workspace", "logs");
  fs.mkdirSync(logs, { recursive: true });
  const body = Array.from({ length: LINES }, (_, i) => JSON.stringify({ i, pad: "x".repeat(60) })).join("\n") + "\n";
  fs.writeFileSync(path.join(logs, "memory-injections.jsonl"), body);
  vi.stubEnv("WORKSPACE_ROOT", path.join(root, "workspace"));
  vi.resetModules();
  ({ GET } = await import("@/app/api/memory-file/route"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

const url = (query: string) => new NextRequest(`http://127.0.0.1/api/memory-file?${query}`);

test("tail mode returns the last N lines of a log larger than the read cap", async () => {
  expect(fs.statSync(path.join(root, "workspace", "logs", "memory-injections.jsonl")).size).toBeGreaterThan(2_000_000);
  const res = await GET(url("path=workspace/logs/memory-injections.jsonl&tail=30"));
  expect(res.status).toBe(200);
  const { content } = await res.json();
  const ids = content.split("\n").map((line: string) => JSON.parse(line).i);
  expect(ids).toEqual(Array.from({ length: 30 }, (_, k) => LINES - 30 + k));
});

test("a full read of a file larger than the cap is still refused", async () => {
  const res = await GET(url("path=workspace/logs/memory-injections.jsonl"));
  expect(res.status).toBe(413);
});
