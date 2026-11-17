import { afterAll, beforeAll, expect, test } from "vitest";
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

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

test("the heartbeat status route answers from lib/heartbeat-detect.mjs", async () => {
  // Past the first 64KB the lib no longer reads, so the trigger must be up front.
  const lines = [
    { type: "message", message: { role: "user", content: "Read HEARTBEAT.md and follow it" } },
    { type: "message", message: { role: "assistant", content: "x".repeat(70_000) } },
  ];
  fs.writeFileSync(path.join(sessions, "hb-1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const { GET } = await import("@/app/api/settings/heartbeat/status/route");
  const body = await (await GET()).json();
  expect(body).toMatchObject({
    isActive: true,
    sessionId: "hb-1",
    sessionType: "heartbeat",
    daemon: { state: "ACTIVE", sessionId: "d1", isActive: true, lastActivityTime: 1234 },
  });

  const route = fs.readFileSync(path.resolve(__dirname, "../../app/api/settings/heartbeat/status/route.ts"), "utf8");
  expect(route).not.toMatch(/HEARTBEAT_PATTERNS|readFileSync/);
});
