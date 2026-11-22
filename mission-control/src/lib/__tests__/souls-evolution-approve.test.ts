import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let home: string;
let prevHome: string | undefined;
let soulsDir: string;
let genesPath: string;

const git = (...args: string[]) => execFileSync("git", args, { cwd: soulsDir, encoding: "utf8" }).trim();

function writeEvent(action: string) {
  const event = {
    eventId: "evt_1",
    soulId: "s1",
    category: "learning",
    trigger: "t",
    summary: "learned a thing",
    proposedChange: { target: "genes.json", action, content: { name: "gene-a" } },
    reviewStatus: "pending",
  };
  fs.writeFileSync(path.join(soulsDir, "s1", "evolution", "events.jsonl"), JSON.stringify(event) + "\n");
}

// The same sequence scripts/install/workspace.sh runs for a fresh souls dir.
function initSoulsRepo() {
  git("init", "-q", "-b", "main");
  git("config", "user.name", "OpenClaw Mission Control");
  git("config", "user.email", "mission-control@openclaw.local");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "souls: installed state");
}

beforeEach(async () => {
  prevHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-souls-evolution-"));
  process.env.HOME = home;
  vi.stubEnv("DB_PATH", path.join(home, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", path.join(home, ".openclaw", "workspace"));
  vi.resetModules();

  soulsDir = path.join(home, ".openclaw", "souls");
  fs.mkdirSync(path.join(soulsDir, "s1", "evolution"), { recursive: true });
  genesPath = path.join(soulsDir, "s1", "evolution", "genes.json");
  fs.writeFileSync(genesPath, JSON.stringify({ genes: [] }, null, 2));
  writeEvent("add");

  const { getRawDb } = await import("@/lib/db");
  getRawDb()
    .prepare(
      "INSERT INTO soul_evolution_log (soul_id, event_id, event_type, description, review_status) VALUES ('s1', 'evt_1', 'learning', 's', 'pending')",
    )
    .run();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

async function approve() {
  const { PATCH } = await import("@/app/api/souls/[id]/evolution/route");
  return PATCH(
    new NextRequest("http://127.0.0.1/api/souls/s1/evolution?eventId=evt_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", reviewedBy: "operator" }),
    }),
    { params: Promise.resolve({ id: "s1" }) },
  );
}

const genes = () => JSON.parse(fs.readFileSync(genesPath, "utf8")).genes;
const status = async () => {
  const { getRawDb } = await import("@/lib/db");
  return getRawDb().prepare("SELECT review_status, commit_hash FROM soul_evolution_log WHERE event_id = 'evt_1'").get() as
    { review_status: string; commit_hash: string | null };
};

test("approve refuses with 409 before touching genes.json when souls is not a git repo", async () => {
  const res = await approve();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/not a git repository/);
  expect(genes()).toEqual([]);
  expect((await status()).review_status).toBe("pending");
});

test("approve applies the gene once, commits it on the base branch and leaves no evolution branch", async () => {
  initSoulsRepo();
  const res = await approve();
  expect(res.status).toBe(200);
  const { commitHash } = await res.json();
  expect(genes()).toEqual([{ name: "gene-a" }]);
  expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(git("rev-parse", "HEAD")).toBe(commitHash);
  expect(git("branch", "--list", "evolution/*")).toBe("");
  expect(git("status", "--porcelain")).toBe("");
  expect(await status()).toEqual({ review_status: "approved", commit_hash: commitHash });

  const again = await approve();
  expect(again.status).toBe(409);
  expect(genes()).toEqual([{ name: "gene-a" }]);
});

test("a git failure restores genes.json, returns to the base branch, and a retry applies the gene once", async () => {
  initSoulsRepo();
  const hook = path.join(soulsDir, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

  const res = await approve();
  expect(res.status).toBe(500);
  expect(genes()).toEqual([]);
  expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(git("branch", "--list", "evolution/*")).toBe("");
  expect(git("status", "--porcelain")).toBe("");
  expect((await status()).review_status).toBe("pending");

  fs.rmSync(hook);
  expect((await approve()).status).toBe(200);
  expect(genes()).toEqual([{ name: "gene-a" }]);
});

test("an action other than add is refused instead of failing at commit on a stray branch", async () => {
  initSoulsRepo();
  writeEvent("remove");
  const res = await approve();
  expect(res.status).toBe(400);
  expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(git("branch", "--list", "evolution/*")).toBe("");
  expect((await status()).review_status).toBe("pending");
});

async function reject(eventId = "evt_1", soul = "s1") {
  const { PATCH } = await import("@/app/api/souls/[id]/evolution/route");
  return PATCH(
    new NextRequest(`http://127.0.0.1/api/souls/${soul}/evolution?eventId=${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject", reviewedBy: "operator" }),
    }),
    { params: Promise.resolve({ id: soul }) },
  );
}

test("reject marks a pending event rejected", async () => {
  expect((await reject()).status).toBe(200);
  expect((await status()).review_status).toBe("rejected");
});

test("reject refuses an event that is no longer pending", async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().prepare("UPDATE soul_evolution_log SET review_status = 'approved' WHERE event_id = 'evt_1'").run();
  expect((await reject()).status).toBe(409);
  expect((await status()).review_status).toBe("approved");
});

test("reject answers 404 for an unknown event or another soul's event", async () => {
  expect((await reject("evt_missing")).status).toBe(404);
  expect((await reject("evt_1", "s2")).status).toBe(404);
  expect((await status()).review_status).toBe("pending");
});
