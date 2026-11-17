import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The route carried its own TypeScript copy of lib/heartbeat-detect.mjs. It
// now loads the lib, so detection and the route answer the same way.

const LIB_DIR = path.resolve(__dirname, "../../../../lib");
let home: string;
let sessions: string;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-heartbeat-"));
  sessions = path.join(home, "gateway-sessions");
  fs.mkdirSync(sessions, { recursive: true });
  fs.mkdirSync(path.join(home, ".openclaw/config"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".openclaw/config/transcript-sources.json"),
    JSON.stringify({ sources: [{ name: "gateway", path: sessions, format: "openclaw-gateway" }] }),
  );
  const workspace = path.join(home, ".openclaw", "workspace");
  fs.mkdirSync(path.join(workspace, ".tmp"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, ".tmp/daemon-state.json"),
    JSON.stringify({ state: "ACTIVE", sessionId: "d1", lastActivityTime: 1234, pid: 1, updatedAt: 1 }),
  );
  process.env.HOME = home;
  process.env.OPENCLAW_WORKSPACE = workspace;
  process.env.OPENCLAW_OBS_DB = path.join(home, "obs.db");
  process.env.OPENCLAW_LIB_DIR = LIB_DIR;
});

beforeEach(() => {
  vi.restoreAllMocks();
  for (const f of fs.readdirSync(sessions)) fs.rmSync(path.join(sessions, f));
});

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

function writeSession(id: string, firstMessage: string, padLines: number) {
  const file = path.join(sessions, `${id}.jsonl`);
  const filler = JSON.stringify({ message: "x".repeat(1000) });
  fs.writeFileSync(file, [JSON.stringify({ message: firstMessage }), ...Array(padLines).fill(filler)].join("\n") + "\n");
  return file;
}

async function status() {
  const { GET } = await import("@/app/api/settings/heartbeat/status/route");
  return (await GET()).json();
}

test("the heartbeat status route answers from lib/heartbeat-detect.mjs", async () => {
  // Past the first 64KB the lib no longer reads, so the trigger must be up front.
  const lines = [
    { type: "message", message: { role: "user", content: "Read HEARTBEAT.md and follow it" } },
    { type: "message", message: { role: "assistant", content: "x".repeat(70_000) } },
  ];
  fs.writeFileSync(path.join(sessions, "hb-1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  expect(await status()).toMatchObject({
    isActive: true,
    sessionId: "hb-1",
    sessionType: "heartbeat",
    daemon: { state: "ACTIVE", sessionId: "d1", isActive: true, lastActivityTime: 1234 },
  });

  const route = fs.readFileSync(path.resolve(__dirname, "../../app/api/settings/heartbeat/status/route.ts"), "utf8");
  expect(route).not.toMatch(/HEARTBEAT_PATTERNS|readFileSync/);
});

// The detector only scans the first 15 lines but read the whole transcript
// into memory on every call; it now reads a bounded head (64 KB).
test("detects a heartbeat session without reading the whole transcript", async () => {
  const file = writeSession("hb-2", "Read HEARTBEAT.md and follow it", 2000);
  const readFileSync = vi.spyOn(fs, "readFileSync");
  expect(await status()).toMatchObject({ isActive: true, sessionId: "hb-2", sessionType: "heartbeat" });
  expect(readFileSync.mock.calls.filter(([p]) => p === file)).toEqual([]);
});

test("a recent non-heartbeat session reads as main", async () => {
  writeSession("main-1", "fix the build", 20);
  expect(await status()).toMatchObject({ isActive: false, sessionId: null, sessionType: "main" });
});
