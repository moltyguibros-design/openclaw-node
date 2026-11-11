import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-content-"));
  vi.stubEnv("STATE_DB_PATH", path.join(root, "state.db"));
  vi.stubEnv("WORKSPACE_ROOT", path.join(root, "workspace"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

function buildStateDb(withSupersededBy: boolean) {
  const db = new Database(path.join(root, "state.db"));
  db.exec(`
    CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT, type TEXT, mention_count INTEGER, salience REAL, last_seen TEXT);
    CREATE TABLE mentions (entity_id INTEGER, session_id TEXT);
    CREATE TABLE themes (label TEXT, hierarchy_path TEXT, mention_count INTEGER, last_seen TEXT);
    CREATE TABLE decisions (id INTEGER PRIMARY KEY, decision TEXT, rationale TEXT, confidence REAL,
      session_id TEXT, created_at TEXT${withSupersededBy ? ", superseded_by INTEGER" : ""});
  `);
  if (withSupersededBy) {
    const insert = db.prepare(
      "INSERT INTO decisions (id, decision, rationale, confidence, session_id, created_at, superseded_by) VALUES (?, ?, 'r', 0.9, 's1', ?, ?)",
    );
    insert.run(1, "use X", "2026-01-01", 2);
    insert.run(2, "use Y", "2026-01-02", null);
  } else {
    const insert = db.prepare(
      "INSERT INTO decisions (id, decision, rationale, confidence, session_id, created_at) VALUES (?, ?, 'r', 0.9, 's1', ?)",
    );
    insert.run(1, "use X", "2026-01-01");
    insert.run(2, "use Y", "2026-01-02");
  }
  db.close();
}

async function get(query = "") {
  const { GET } = await import("@/app/api/memory-content/route");
  return GET(new NextRequest(`http://127.0.0.1/api/memory-content${query}`));
}

test("a superseded decision is not listed or counted as current memory", async () => {
  buildStateDb(true);
  const res = await get();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.decisions.map((d: { decision: string }) => d.decision)).toEqual(["use Y"]);
  expect(body.counts.decisions).toBe(1);
});

test("a text search does not surface a superseded decision", async () => {
  buildStateDb(true);
  const body = await (await get("?q=use")).json();
  expect(body.decisions.map((d: { decision: string }) => d.decision)).toEqual(["use Y"]);
});

test("a session drill-down still shows every decision that session produced", async () => {
  buildStateDb(true);
  const body = await (await get("?session=s1")).json();
  expect(body.decisions.map((d: { decision: string }) => d.decision)).toEqual(["use Y", "use X"]);
});

test("a pre-v6 state.db without superseded_by lists every decision", async () => {
  buildStateDb(false);
  const res = await get();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.decisions.map((d: { decision: string }) => d.decision)).toEqual(["use Y", "use X"]);
  expect(body.counts.decisions).toBe(2);
});
