import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// MC writes active-tasks.md beside the mesh bridge and memory daemon. Its old
// full rewrite from the DB reverted whatever they wrote after MC's last import
// (status, mesh_task_id, mesh_node, extra fields).

let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-sync-"));
  file = path.join(root, "memory", "active-tasks.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.stubEnv("DB_PATH", path.join(root, "mc.db"));
  vi.stubEnv("OPENCLAW_NODE_ROLE", "lead");
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

const block = (id: string, fields: string) => `- task_id: ${id}\n  title: ${id} title\n${fields}  updated_at: 2026-11-01T00:00:00Z\n`;
const FILE = `# Active Tasks

Updated: 2026-11-01 00:00 America/Montreal

## Live Tasks

${block("T-A", "  status: queued\n  owner: main\n  success_criteria:\n    - it works\n  artifacts:\n  next_action: n/a\n")}
${block("T-B", "  status: submitted\n  owner: mesh\n  success_criteria:\n  artifacts:\n  next_action: n/a\n  execution: mesh\n  mesh_task_id: M-1\n")}`;

async function load() {
  const { getDb } = await import("@/lib/db");
  const { tasks } = await import("@/lib/db/schema");
  const sync = await import("@/lib/sync/tasks");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const set = (id: string, values: Record<string, unknown>) =>
    db.update(tasks).set({ ...values, updatedAt: "2026-11-02T00:00:00Z" }).where(eq(tasks.id, id)).run();
  const get = (id: string) => db.select().from(tasks).where(eq(tasks.id, id)).get();
  return { db, tasks, sync, set, get };
}

/** What the bridge does: read-modify-write of one block (kanban-io updateTaskInPlace). */
function bridgeEdit(id: string, edit: (blockText: string) => string) {
  const content = fs.readFileSync(file, "utf-8");
  const start = content.indexOf(`- task_id: ${id}\n`);
  const next = content.indexOf("\n- task_id:", start + 1);
  const end = next < 0 ? content.length : next + 1;
  fs.writeFileSync(file, content.slice(0, start) + edit(content.slice(start, end)) + content.slice(end));
}

describe("syncTasksToMarkdown writes only what MC changed", () => {
  it("keeps the bridge's edits to other tasks and to other fields of the same task", async () => {
    fs.writeFileSync(file, FILE);
    const { db, sync, set } = await load();
    sync.syncTasksFromMarkdown(db);

    bridgeEdit("T-B", (b) => b
      .replace("status: submitted", "status: running")
      .replace("  mesh_task_id: M-1\n", "  mesh_task_id: M-1\n  mesh_node: w1\n  collab_result: ok\n"));
    bridgeEdit("T-A", (b) => b.replace("  next_action: n/a\n", "  next_action: n/a\n  mesh_node: w2\n"));
    fs.appendFileSync(file, "\n" + block("T-C", "  status: queued\n  owner: mesh\n  success_criteria:\n  artifacts:\n  next_action: n/a\n"));

    // The scheduler dispatches T-A from its stale DB copy.
    set("T-A", { status: "ready", title: "renamed" });
    sync.syncTasksToMarkdown(db);

    const out = fs.readFileSync(file, "utf-8");
    const { parseTasksMarkdown } = await import("@/lib/parsers/task-markdown");
    const byId = Object.fromEntries(parseTasksMarkdown(out).map((t) => [t.id, t]));
    expect(byId["T-A"]).toMatchObject({ status: "ready", title: "renamed", meshNode: "w2", successCriteria: ["it works"] });
    expect(byId["T-B"]).toMatchObject({ status: "running", meshTaskId: "M-1", meshNode: "w1", extra: { collab_result: "ok" } });
    expect(byId["T-C"]).toMatchObject({ status: "queued" });
    expect(out.startsWith("# Active Tasks\n\nUpdated: 2026-11-01 00:00 America/Montreal\n")).toBe(true);
  });

  it("appends a task MC created, removes one MC deleted, and leaves an unchanged file alone", async () => {
    fs.writeFileSync(file, FILE);
    const { db, tasks, sync } = await load();
    const { eq } = await import("drizzle-orm");
    sync.syncTasksFromMarkdown(db);

    const before = fs.statSync(file).mtimeMs;
    sync.syncTasksToMarkdown(db);
    expect(fs.statSync(file).mtimeMs).toBe(before);

    db.delete(tasks).where(eq(tasks.id, "T-A")).run();
    db.insert(tasks).values({
      id: "T-N", title: "new one", status: "queued", kanbanColumn: "backlog", updatedAt: "2026-11-02T00:00:00Z",
    }).run();
    sync.syncTasksToMarkdown(db);

    const { parseTasksMarkdown } = await import("@/lib/parsers/task-markdown");
    expect(parseTasksMarkdown(fs.readFileSync(file, "utf-8")).map((t) => [t.id, t.title])).toEqual([
      ["T-B", "T-B title"],
      ["T-N", "new one"],
    ]);
  });

  it("a write that carried unimported bridge edits makes the next read import them", async () => {
    fs.writeFileSync(file, FILE);
    const { db, sync, set, get } = await load();
    sync.syncTasksFromMarkdown(db);
    bridgeEdit("T-B", (b) => b.replace("status: submitted", "status: running"));

    set("T-A", { status: "ready" });
    sync.syncTasksToMarkdown(db);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10_000);
    sync.syncTasksFromMarkdownIfChanged(db);
    expect(get("T-B")?.status).toBe("running");
    expect(get("T-A")?.status).toBe("ready");
  });

  // A startup backfill to execution='local' made the first write after a restart add it to every block without one.
  it("a restart does not make the next write add execution: local to blocks that had none", async () => {
    fs.writeFileSync(file, FILE);
    const first = await load();
    first.sync.syncTasksFromMarkdown(first.db);

    vi.resetModules();
    const { db, sync, set, get } = await load();
    set("T-A", { title: "renamed" });
    sync.syncTasksToMarkdown(db);

    const out = fs.readFileSync(file, "utf-8");
    expect(out).toContain("title: renamed");
    expect(out).not.toContain("execution: local");
    expect(get("T-A")?.execution).toBeNull();
  });
});
