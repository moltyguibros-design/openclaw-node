import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The live sidebar polls /api/activity/live every 5s. Each poll used to
// readdirSync + statSync every transcript and readSync a 300KB tail, blocking
// the event loop in proportion to the number of sessions.

let home: string;
let sessions: string;

const toolUse = (file_path: string) =>
  JSON.stringify({
    timestamp: "2026-11-17T12:00:00Z",
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Write", input: { file_path } }] },
  }) + "\n";

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-transcript-live-"));
  sessions = path.join(home, ".openclaw", "agents", "main", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  vi.stubEnv("HOME", home);
  vi.stubEnv("WORKSPACE_ROOT", path.join(home, ".openclaw", "workspace"));
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(home, { recursive: true, force: true });
});

function bumpDirMtime(dir: string, seconds: number) {
  const t = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(dir, t, t);
}

test("polls reuse the directory scan and the parsed tail, and never block on sync fs", async () => {
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(sessions, `old-${i}.jsonl`), toolUse(`/x/old-${i}`));
  const newest = path.join(sessions, "newest.jsonl");
  fs.writeFileSync(newest, toolUse("/x/a/b/first"));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(newest, later, later);

  const { getRecentTranscriptActivity } = await import("@/lib/parsers/transcript");
  const readdir = vi.spyOn(fs.promises, "readdir");
  const open = vi.spyOn(fs.promises, "open");
  const sync = [
    vi.spyOn(fs, "readdirSync"),
    vi.spyOn(fs, "statSync"),
    vi.spyOn(fs, "readSync"),
    vi.spyOn(fs, "openSync"),
  ];

  for (let i = 0; i < 3; i++) {
    expect((await getRecentTranscriptActivity()).map((e) => e.detail)).toEqual(["Wrote b/first"]);
  }
  expect(readdir).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(1);
  for (const spy of sync) expect(spy).not.toHaveBeenCalled();

  // An append changes the file's size, not the directory: the tail is re-read, the listing is not.
  fs.appendFileSync(newest, toolUse("/x/a/b/second"));
  const later2 = new Date(Date.now() + 6000);
  fs.utimesSync(newest, later2, later2);
  expect((await getRecentTranscriptActivity()).map((e) => e.detail)).toEqual(["Wrote b/second", "Wrote b/first"]);
  expect(readdir).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledTimes(2);

  // A new session file changes the directory mtime and becomes the latest.
  const fresh = path.join(sessions, "fresh.jsonl");
  fs.writeFileSync(fresh, toolUse("/x/c/d/fresh"));
  const later3 = new Date(Date.now() + 9000);
  fs.utimesSync(fresh, later3, later3);
  bumpDirMtime(sessions, 9);
  expect((await getRecentTranscriptActivity()).map((e) => e.detail)).toEqual(["Wrote d/fresh"]);
  expect(readdir).toHaveBeenCalledTimes(2);
});

test("an older session that resumes is picked up by the periodic rescan", async () => {
  const a = path.join(sessions, "a.jsonl");
  const b = path.join(sessions, "b.jsonl");
  fs.writeFileSync(a, toolUse("/x/a/a/one"));
  fs.writeFileSync(b, toolUse("/x/b/b/two"));
  const t1 = new Date(Date.now() + 1000);
  fs.utimesSync(b, t1, t1);

  const { getRecentTranscriptActivity } = await import("@/lib/parsers/transcript");
  expect((await getRecentTranscriptActivity()).map((e) => e.detail)).toEqual(["Wrote b/two"]);

  const dirStat = fs.statSync(sessions);
  fs.appendFileSync(a, toolUse("/x/a/a/resumed"));
  const t2 = new Date(Date.now() + 2000);
  fs.utimesSync(a, t2, t2);
  fs.utimesSync(sessions, dirStat.atime, dirStat.mtime);

  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
  expect((await getRecentTranscriptActivity()).map((e) => e.detail)).toEqual(["Wrote a/resumed", "Wrote a/one"]);
});
