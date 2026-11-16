import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { tasks, taskSyncBase } from "@/lib/db/schema";
import { ACTIVE_TASKS_MD } from "@/lib/config";
import { NODE_ROLE } from "@/lib/config";
import {
  parseTasksMarkdown,
  serializeTasksMarkdown,
  serializeTaskBlock,
  statusToKanban,
  type ParsedTask,
} from "@/lib/parsers/task-markdown";

type DrizzleDb = ReturnType<typeof import("@/lib/db")["getDb"]>;

/* ------------------------------------------------------------------ */
/*  Mtime tracking — only re-sync from markdown when the file changes */
/* ------------------------------------------------------------------ */

let lastKnownMtime = 0;
let lastWriteMtime = 0; // mtime right after WE wrote the file
let lastImportTime = 0; // when we last ran a full import

// Debounce: bridge writes every 10s, memory-daemon every 3s — each changes
// mtime and triggers a full parse+upsert of every task. 5s cooldown prevents
// redundant re-imports during active mesh operations.
const MIN_REIMPORT_INTERVAL_MS = 5000;

/**
 * Check if active-tasks.md was modified externally (by Daedalus/user)
 * since we last read or wrote it.
 */
function markdownChangedExternally(): boolean {
  if (!fs.existsSync(ACTIVE_TASKS_MD)) return false;

  // Debounce: don't re-import if we just imported less than 5s ago
  if (Date.now() - lastImportTime < MIN_REIMPORT_INTERVAL_MS) return false;

  const stat = fs.statSync(ACTIVE_TASKS_MD);
  const mtime = stat.mtimeMs;

  // If the mtime matches what we set after our last write, skip.
  // This prevents re-importing our own writes.
  // Use tolerance window for cross-platform filesystem compatibility.
  if (Math.abs(mtime - lastWriteMtime) < 50) return false;

  if (Math.abs(mtime - lastKnownMtime) > 50) {
    lastKnownMtime = mtime;
    return true;
  }
  return false;
}

/**
 * Sync tasks from active-tasks.md into SQLite.
 * ONLY called when the file has been modified externally.
 * Merges markdown state into DB without blindly overwriting DB-only fields.
 */
export function syncTasksFromMarkdown(db: DrizzleDb): void {
  if (!fs.existsSync(ACTIVE_TASKS_MD)) return;

  lastImportTime = Date.now(); // stamp BEFORE work — prevents re-entry during long imports

  const raw = fs.readFileSync(ACTIVE_TASKS_MD, "utf-8");
  const parsed = parseTasksMarkdown(raw);
  const now = new Date().toISOString();

  const incomingIds = new Set<string>();

  for (const task of parsed) {
    incomingIds.add(task.id);

    // Check if task already exists in DB
    const existing = db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id))
      .get();

    if (existing) {
      // MERGE: update fields from markdown but preserve DB-authoritative fields
      // Done-gate: if markdown says "done" but task requires approval, redirect to "review"
      let effectiveStatus = task.status;
      if (task.status === "done" && existing.needsApproval === 1 && existing.status !== "done") {
        effectiveStatus = "waiting-user";
      }
      // If status changed in markdown, update kanbanColumn to match
      const statusChanged = existing.status !== effectiveStatus;
      const update: Record<string, unknown> = {
        title: task.title,
        status: effectiveStatus,
        owner: task.owner || null,
        successCriteria: task.successCriteria.length
          ? JSON.stringify(task.successCriteria)
          : null,
        artifacts: task.artifacts.length
          ? JSON.stringify(task.artifacts)
          : null,
        nextAction: task.nextAction || null,
        scheduledDate: task.scheduledDate || null,
        project: task.project || null,
        type: task.type || "task",
        parentId: task.parentId || null,
        startDate: task.startDate || null,
        endDate: task.endDate || null,
        color: task.color || null,
        description: task.description || null,
        needsApproval: task.needsApproval ? 1 : 0,
        triggerKind: task.triggerKind || "none",
        triggerAt: task.triggerAt || null,
        triggerCron: task.triggerCron || null,
        triggerTz: task.triggerTz || "America/Montreal",
        isRecurring: task.isRecurring ? 1 : 0,
        capacityClass: task.capacityClass || "normal",
        autoPriority: task.autoPriority || 0,
        // Mesh execution fields
        execution: task.execution || null,
        meshTaskId: task.meshTaskId || null,
        meshNode: task.meshNode || null,
        metric: task.metric || null,
        budgetMinutes: task.budgetMinutes || 30,
        scope: task.scope?.length ? JSON.stringify(task.scope) : null,
        // Collab routing fields
        collaboration: task.collaboration ? JSON.stringify(task.collaboration) : null,
        preferredNodes: task.preferredNodes?.length ? JSON.stringify(task.preferredNodes) : null,
        excludeNodes: task.excludeNodes?.length ? JSON.stringify(task.excludeNodes) : null,
        clusterId: task.clusterId || null,
        extra: Object.keys(task.extra || {}).length ? JSON.stringify(task.extra) : null,
        updatedAt: task.updatedAt || now,
      };

      // Only update kanbanColumn if status actually changed in the markdown
      if (statusChanged) {
        update.kanbanColumn = statusToKanban(effectiveStatus);
      }
      // Otherwise, preserve the existing kanbanColumn (user may have dragged it)

      db.update(tasks).set(update).where(eq(tasks.id, task.id)).run();
    } else {
      // INSERT: new task from markdown
      db.insert(tasks)
        .values({
          id: task.id,
          title: task.title,
          status: task.status,
          kanbanColumn: statusToKanban(task.status),
          owner: task.owner || null,
          successCriteria: task.successCriteria.length
            ? JSON.stringify(task.successCriteria)
            : null,
          artifacts: task.artifacts.length
            ? JSON.stringify(task.artifacts)
            : null,
          nextAction: task.nextAction || null,
          scheduledDate: task.scheduledDate || null,
          project: task.project || null,
          type: task.type || "task",
          parentId: task.parentId || null,
          startDate: task.startDate || null,
          endDate: task.endDate || null,
          color: task.color || null,
          description: task.description || null,
          needsApproval: task.needsApproval ? 1 : 0,
          triggerKind: task.triggerKind || "none",
          triggerAt: task.triggerAt || null,
          triggerCron: task.triggerCron || null,
          triggerTz: task.triggerTz || "America/Montreal",
          isRecurring: task.isRecurring ? 1 : 0,
          capacityClass: task.capacityClass || "normal",
          autoPriority: task.autoPriority || 0,
          // Mesh execution fields
          execution: task.execution || null,
          meshTaskId: task.meshTaskId || null,
          meshNode: task.meshNode || null,
          metric: task.metric || null,
          budgetMinutes: task.budgetMinutes || 30,
          scope: task.scope?.length ? JSON.stringify(task.scope) : null,
          // Collab routing fields
          collaboration: task.collaboration ? JSON.stringify(task.collaboration) : null,
          preferredNodes: task.preferredNodes?.length ? JSON.stringify(task.preferredNodes) : null,
          excludeNodes: task.excludeNodes?.length ? JSON.stringify(task.excludeNodes) : null,
          clusterId: task.clusterId || null,
          extra: Object.keys(task.extra || {}).length ? JSON.stringify(task.extra) : null,
          updatedAt: task.updatedAt || now,
          createdAt: now,
        })
        .run();
    }
  }

  // Remove tasks that no longer exist in the markdown —
  // but PRESERVE roadmap/pipeline tasks (project, phase, pipeline types)
  // and any tasks tagged with a project (they live in the DB, not markdown).
  const allDbTasks = db
    .select({ id: tasks.id, type: tasks.type, project: tasks.project, execution: tasks.execution, status: tasks.status })
    .from(tasks)
    .all();
  for (const row of allDbTasks) {
    if (row.id === "__LIVE_SESSION__") continue;
    // Preserve hierarchy nodes (project, phase, pipeline) — they're roadmap-only
    if (row.type === "project" || row.type === "phase" || row.type === "pipeline") continue;
    // Preserve tasks owned by a project (imported via pipeline, not markdown-managed)
    if (row.project) continue;
    // Preserve in-flight mesh tasks (only clean up terminal ones)
    if (row.execution === "mesh" && row.status !== "done" && row.status !== "cancelled") continue;
    if (!incomingIds.has(row.id)) {
      db.delete(tasks).where(eq(tasks.id, row.id)).run();
    }
  }

  // What the file holds is now what MC has seen: a later MC write only
  // carries fields whose DB value differs from it (done-gate redirects included).
  saveBaseline(db, new Map(parsed.map((t) => [t.id, fieldsOf(serializeTaskBlock(t))])));
}

/**
 * Conditionally sync from markdown — only if file changed externally.
 * This is what GET /api/tasks should call instead of unconditional sync.
 */
export function syncTasksFromMarkdownIfChanged(db: DrizzleDb): void {
  if (markdownChangedExternally()) {
    syncTasksFromMarkdown(db);
  }
}

/**
 * Write MC's task changes to active-tasks.md: only the tasks and fields MC
 * changed since it last imported or wrote the file, edited in place under the
 * kanban lock (the kanban-io updateTaskInPlace contract). The mesh bridge and
 * memory daemon edit the same file; a full rewrite from the DB reverted
 * whatever they wrote after MC's last import.
 *
 * "Changed" = the task's serialized field differs from task_sync_base (its
 * lines as MC last imported or wrote them). New DB tasks are appended, tasks
 * MC deleted are removed, everything else in the file is left as it is.
 */
export function syncTasksToMarkdown(db: DrizzleDb): void {
  // Workers must NOT write to active-tasks.md — the lead owns this file.
  // Writing from workers would cause conflict loops in the mesh sync.
  if (NODE_ROLE === "worker") return;

  const current = db
    .select()
    .from(tasks)
    .orderBy(tasks.sortOrder, tasks.id)
    .all()
    // The live session task is synthetic
    .filter((t) => t.id !== "__LIVE_SESSION__")
    .map(rowToParsed);
  const after = new Map(current.map((t) => [t.id, fieldsOf(serializeTaskBlock(t))]));
  const stored = loadBaseline(db);

  // P5-5: the mesh bridge and memory daemon write this file under the
  // kanban-io mkdir lock. Same lock dir, same protocol — refuse to write without it.
  withKanbanLockSync(ACTIVE_TASKS_MD, () => {
    const exists = fs.existsSync(ACTIVE_TASKS_MD);
    const content = exists ? fs.readFileSync(ACTIVE_TASKS_MD, "utf-8") : "";
    const unseenExternalWrite = exists && !isOwnMtime(fs.statSync(ACTIVE_TASKS_MD).mtimeMs);
    let next: string;
    if (/^## Live Tasks/m.test(content)) {
      const edited = applyTaskChanges(content, current, after, stored);
      if (edited === null) return;
      next = edited;
    } else {
      // No file (or no Live Tasks section to edit in place): write it whole.
      fs.mkdirSync(path.dirname(ACTIVE_TASKS_MD), { recursive: true });
      next = serializeTasksMarkdown(current);
    }

    // Atomic write: write to .tmp, then rename over original
    const tmpPath = ACTIVE_TASKS_MD + ".tmp";
    fs.writeFileSync(tmpPath, next, "utf-8");
    fs.renameSync(tmpPath, ACTIVE_TASKS_MD);

    // Our own write is not re-imported — unless it carried another writer's
    // edits MC has not imported yet: then the next read must import them.
    const mtime = fs.statSync(ACTIVE_TASKS_MD).mtimeMs;
    lastWriteMtime = unseenExternalWrite ? 0 : mtime;
    lastKnownMtime = unseenExternalWrite ? 0 : mtime;
  });
  saveBaseline(db, after);
}

function isOwnMtime(mtime: number): boolean {
  return Math.abs(mtime - lastWriteMtime) < 50 || Math.abs(mtime - lastKnownMtime) < 50;
}

/* ------------------------------------------------------------------ */
/*  Surgical task-block edits                                          */
/* ------------------------------------------------------------------ */

/** Field key → its lines: the `  key:` line plus any `    - item` lines under it. */
type FieldLines = Map<string, string[]>;

export function fieldsOf(block: string): FieldLines {
  const fields: FieldLines = new Map();
  let open: string[] | null = null;
  for (const line of block.split("\n").slice(1)) {
    const key = line.match(/^  (\w[\w_]*):/)?.[1];
    if (key) {
      open = fields.has(key) ? null : [line];
      if (open) fields.set(key, open);
    } else if (open && /^    - /.test(line)) {
      open.push(line);
    } else {
      open = null;
    }
  }
  return fields;
}

function sameLines(a: string[] | undefined, b: string[] | undefined): boolean {
  return (a ?? []).join("\n") === (b ?? []).join("\n");
}

/** One parsed `- task_id:` block in the file: [start, end) line range. */
interface FileBlock { id: string; start: number; end: number }

function taskBlocks(lines: string[], from: number): FileBlock[] {
  const blocks: FileBlock[] = [];
  for (let i = from; i < lines.length; i++) {
    const id = lines[i].match(/^- task_id:\s*(.+)$/)?.[1]?.trim();
    if (id === undefined) continue;
    if (blocks.length > 0) blocks[blocks.length - 1].end = i;
    blocks.push({ id, start: i, end: lines.length });
  }
  return blocks;
}

/** Replace, insert or drop one field's lines inside a block (without its trailing blank lines). */
function setField(block: string[], key: string, value: string[] | undefined): void {
  const at = block.findIndex((l, i) => i > 0 && l.startsWith(`  ${key}:`));
  if (at >= 0) {
    let end = at + 1;
    while (end < block.length && /^    - /.test(block[end])) end++;
    block.splice(at, end - at, ...(value ?? []));
  } else if (value) {
    const updatedAt = block.findIndex((l, i) => i > 0 && l.startsWith("  updated_at:"));
    block.splice(updatedAt > 0 ? updatedAt : block.length, 0, ...value);
  }
}

/** The file (which has a `## Live Tasks` section) with MC's changes applied, or null when there are none. */
export function applyTaskChanges(
  content: string,
  current: ParsedTask[],
  after: Map<string, FieldLines>,
  stored: Map<string, FieldLines>,
): string | null {
  const lines = content.split("\n");
  const live = lines.findIndex((l) => l.startsWith("## Live Tasks"));
  const blocks = taskBlocks(lines, live + 1);
  const fileFields = new Map<string, FieldLines>();
  for (const b of blocks) {
    if (!fileFields.has(b.id)) fileFields.set(b.id, fieldsOf(lines.slice(b.start, b.end).join("\n")));
  }
  // No stored base at all (first run with this table): the file stands in for
  // it, which is the old full-rewrite behaviour, once.
  const base = stored.size > 0 ? stored : fileFields;

  const edits = new Map<string, Map<string, string[] | undefined>>();
  const appended: ParsedTask[] = [];
  for (const t of current) {
    const now = after.get(t.id)!;
    const before = base.get(t.id) ?? fileFields.get(t.id);
    if (!before) {
      if (!fileFields.has(t.id)) appended.push(t);
      continue;
    }
    const changed = new Map<string, string[] | undefined>();
    for (const key of new Set([...before.keys(), ...now.keys()])) {
      if (!sameLines(before.get(key), now.get(key))) changed.set(key, now.get(key));
    }
    if (changed.size > 0) edits.set(t.id, changed);
  }
  const removed = new Set([...base.keys()].filter((id) => !after.has(id)));
  if (edits.size === 0 && appended.length === 0 && ![...removed].some((id) => fileFields.has(id))) return null;

  const out = lines.slice(0, live + 1);
  let cursor = live + 1;
  const done = new Set<string>();
  for (const b of blocks) {
    out.push(...lines.slice(cursor, b.start));
    cursor = b.end;
    if (removed.has(b.id)) continue;
    const block = lines.slice(b.start, b.end);
    const change = done.has(b.id) ? undefined : edits.get(b.id);
    done.add(b.id);
    if (change) {
      let body = block.length;
      while (body > 1 && block[body - 1].trim() === "") body--;
      const head = block.slice(0, body);
      for (const [key, value] of change) setField(head, key, value);
      out.push(...head, ...block.slice(body));
    } else {
      out.push(...block);
    }
  }
  out.push(...lines.slice(cursor));

  let text = out.join("\n");
  if (appended.length > 0) {
    text = text.replace(/\n*$/, "\n\n") + appended.map(serializeTaskBlock).join("\n\n") + "\n";
  }
  return text;
}

function loadBaseline(db: DrizzleDb): Map<string, FieldLines> {
  const base = new Map<string, FieldLines>();
  for (const row of db.select().from(taskSyncBase).all()) {
    try {
      base.set(row.id, new Map(Object.entries(JSON.parse(row.fields) as Record<string, string[]>)));
    } catch { /* unreadable row: treated as no base for that task */ }
  }
  return base;
}

function saveBaseline(db: DrizzleDb, base: Map<string, FieldLines>): void {
  db.transaction((tx) => {
    tx.delete(taskSyncBase).run();
    for (const [id, fields] of base) {
      tx.insert(taskSyncBase).values({ id, fields: JSON.stringify(Object.fromEntries(fields)) }).run();
    }
  });
}

type TaskRow = typeof tasks.$inferSelect;

function rowToParsed(t: TaskRow): ParsedTask {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    // null, as the parser yields for a blank owner / `n/a`: an imported row then
    // serializes to exactly its file lines, so only real edits count as changes.
    owner: t.owner || null,
    successCriteria: t.successCriteria ? JSON.parse(t.successCriteria) : [],
    artifacts: t.artifacts ? JSON.parse(t.artifacts) : [],
    nextAction: t.nextAction || null,
    scheduledDate: t.scheduledDate || null,
    project: t.project || null,
    type: t.type || null,
    parentId: t.parentId || null,
    startDate: t.startDate || null,
    endDate: t.endDate || null,
    color: t.color || null,
    description: t.description || null,
    needsApproval: !!t.needsApproval,
    triggerKind: t.triggerKind || "none",
    triggerAt: t.triggerAt || null,
    triggerCron: t.triggerCron || null,
    triggerTz: t.triggerTz || "America/Montreal",
    isRecurring: !!t.isRecurring,
    capacityClass: t.capacityClass || "normal",
    autoPriority: t.autoPriority || 0,
    // Mesh execution fields — MUST be preserved on DB→markdown round-trip
    execution: t.execution || null,
    meshTaskId: t.meshTaskId || null,
    meshNode: t.meshNode || null,
    metric: t.metric || null,
    budgetMinutes: t.budgetMinutes || 30,
    scope: t.scope ? JSON.parse(t.scope) : [],
    // Collab routing fields
    collaboration: t.collaboration ? JSON.parse(t.collaboration) : null,
    preferredNodes: t.preferredNodes ? JSON.parse(t.preferredNodes) : [],
    excludeNodes: t.excludeNodes ? JSON.parse(t.excludeNodes) : [],
    clusterId: t.clusterId || null,
    extra: parseExtra(t.extra),
    updatedAt: t.updatedAt,
  };
}

function parseExtra(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// Same rule as lib/kanban-io.js: a lock older than this was left by a writer
// killed while holding it, and is removed (accepting that two writers may race it).
const STALE_LOCK_MS = 30000;

function breakStaleLock(lockDir: string): boolean {
  try {
    const age = Date.now() - fs.statSync(lockDir).mtimeMs;
    if (age <= STALE_LOCK_MS) return false;
    fs.rmdirSync(lockDir);
    console.warn(`[sync] removed stale lock ${lockDir} (${Math.round(age / 1000)}s old)`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirror of lib/kanban-io.js withMkdirLock (mkdir(<file>.lk) is atomic on
 * every local filesystem). Synchronous because the sync layer is; the wait
 * is a bounded spin with a real sleep, never a busy loop.
 */
export function withKanbanLockSync<T>(filePath: string, fn: () => T, maxWaitMs = 5000): T {
  const lockDir = filePath + ".lk";
  const start = Date.now();
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() - start < maxWaitMs) {
    try {
      fs.mkdirSync(lockDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        if (breakStaleLock(lockDir)) continue;
        Atomics.wait(sleep, 0, 0, 50);
        continue;
      }
      throw err;
    }
    try {
      return fn();
    } finally {
      try { fs.rmdirSync(lockDir); } catch { /* already released */ }
    }
  }
  throw new Error(`active-tasks.md lock acquisition timeout after ${maxWaitMs}ms — another writer holds ${lockDir}`);
}
