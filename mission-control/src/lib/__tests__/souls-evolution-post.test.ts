import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let home: string;
let prevHome: string | undefined;
let soulsDir: string;

const REPO = path.join(__dirname, "..", "..", "..", "..");
const git = (...args: string[]) => execFileSync("git", args, { cwd: soulsDir, encoding: "utf8" }).trim();

function writeSoul(id: string, evolutionEnabled: boolean, captureTypes?: string[]) {
  fs.mkdirSync(path.join(soulsDir, id), { recursive: true });
  const capabilities = { skills: [], tools: [], mcpServers: [], ...(captureTypes ? { evolutionConfig: { captureTypes } } : {}) };
  fs.writeFileSync(path.join(soulsDir, id, "capabilities.json"), JSON.stringify(capabilities));
  return { id, type: "specialist", evolutionEnabled, parentSoul: "daedalus" };
}

function initSoulsRepo() {
  git("init", "-q", "-b", "main");
  git("config", "user.name", "OpenClaw Mission Control");
  git("config", "user.email", "mission-control@openclaw.local");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "souls: installed state");
}

beforeEach(() => {
  prevHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mc-souls-evolution-post-"));
  process.env.HOME = home;
  vi.stubEnv("DB_PATH", path.join(home, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", path.join(home, ".openclaw", "workspace"));
  vi.resetModules();

  soulsDir = path.join(home, ".openclaw", "souls");
  const souls = [
    writeSoul("s1", true, ["learning"]),
    writeSoul("off", false, ["learning"]),
    writeSoul("free", true),
  ];
  fs.writeFileSync(path.join(soulsDir, "registry.json"), JSON.stringify({ version: "1.0.0", souls }));
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  process.env.HOME = prevHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: "evt_1",
  category: "learning",
  trigger: "task_completion",
  summary: "learned a thing",
  proposedChange: { target: "genes.json", action: "add", content: { id: "gene-a" } },
  ...overrides,
});

async function post(soul: string, body: unknown) {
  const { POST } = await import("@/app/api/souls/[id]/evolution/route");
  return POST(
    new NextRequest(`http://127.0.0.1/api/souls/${soul}/evolution`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: soul }) },
  );
}

async function approve(soul: string, eventId = "evt_1") {
  const { PATCH } = await import("@/app/api/souls/[id]/evolution/route");
  return PATCH(
    new NextRequest(`http://127.0.0.1/api/souls/${soul}/evolution?eventId=${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", reviewedBy: "operator" }),
    }),
    { params: Promise.resolve({ id: soul }) },
  );
}

async function rows() {
  const { getRawDb } = await import("@/lib/db");
  return getRawDb().prepare("SELECT soul_id, event_id, review_status FROM soul_evolution_log").all();
}

const eventsFile = (soul: string) => path.join(soulsDir, soul, "evolution", "events.jsonl");
const genesFile = (soul: string) => path.join(soulsDir, soul, "evolution", "genes.json");

test("a lesson posted for a soul with no evolution/ yet can be approved", async () => {
  initSoulsRepo();
  expect((await post("s1", event())).status).toBe(200);
  const res = await approve("s1");
  expect(res.status).toBe(200);
  expect(JSON.parse(fs.readFileSync(genesFile("s1"), "utf8")).genes).toEqual([{ id: "gene-a" }]);
  expect(git("log", "-1", "--format=%s")).toBe("evolution(evt_1): learned a thing");
});

test("a failed commit for a soul that had no genes.json leaves no genes.json behind", async () => {
  initSoulsRepo();
  expect((await post("s1", event())).status).toBe(200);
  fs.writeFileSync(path.join(soulsDir, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  expect((await approve("s1")).status).toBe(500);
  expect(fs.existsSync(genesFile("s1"))).toBe(false);
  expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  expect(git("branch", "--list", "evolution/*")).toBe("");
});

test("a soul with evolutionEnabled false refuses the lesson with 409 and records nothing", async () => {
  const res = await post("off", event());
  expect(res.status).toBe(409);
  expect(fs.existsSync(eventsFile("off"))).toBe(false);
  expect(await rows()).toEqual([]);
});

test("a category outside the soul's captureTypes is refused with 400 and records nothing", async () => {
  const res = await post("s1", event({ category: "gossip" }));
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/learning/);
  expect(fs.existsSync(eventsFile("s1"))).toBe(false);
  expect(await rows()).toEqual([]);
});

test("a soul without captureTypes accepts any category", async () => {
  expect((await post("free", event({ category: "anything" }))).status).toBe(200);
  expect(await rows()).toEqual([{ soul_id: "free", event_id: "evt_1", review_status: "pending" }]);
});

test("a soul missing from the registry is refused with 404", async () => {
  expect((await post("ghost", event())).status).toBe(404);
  expect(await rows()).toEqual([]);
});

const repoFile = (f: string) => fs.readFileSync(path.join(REPO, f), "utf8");

test("souls are told to post lessons through the API, not to write events.jsonl", () => {
  for (const soul of ["blockchain-auditor", "identity-architect", "lore-writer", "qa-evidence"]) {
    const principles = repoFile(`souls/${soul}/PRINCIPLES.md`);
    expect(principles, soul).toContain(`bin/mc-api POST /api/souls/${soul}/evolution`);
    expect(principles, soul).not.toMatch(/in evolution\/events\.jsonl/);
  }
  const guide = repoFile("identity/MULTI_SOUL_GUIDE.md");
  expect(guide).toMatch(/\*\*Capture\*\* — Soul posts .*bin\/mc-api POST \/api\/souls\/<id>\/evolution/);
  expect(guide).not.toContain("capsules");
  expect(repoFile("mission-control/src/app/souls/page.tsx")).not.toContain("capsules");
});

test("daedalus ships evolution seeds, no soul ships capsules.json, and no seed event lacks its review row", () => {
  expect(JSON.parse(repoFile("souls/daedalus/evolution/genes.json"))).toEqual({ version: "1.0.0", genes: [] });
  expect(repoFile("souls/daedalus/evolution/events.jsonl")).toBe("");
  for (const soul of fs.readdirSync(path.join(REPO, "souls"))) {
    const dir = path.join(REPO, "souls", soul, "evolution");
    if (!fs.existsSync(dir)) continue;
    expect(fs.existsSync(path.join(dir, "capsules.json")), soul).toBe(false);
    expect(fs.readFileSync(path.join(dir, "events.jsonl"), "utf8"), soul).toBe("");
  }
});
