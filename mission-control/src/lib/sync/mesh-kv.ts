/**
 * mesh-kv.ts — Sync engine for distributed Mission Control (Phase 2).
 *
 * Bridges NATS KV (mesh truth) ↔ local SQLite (MC database).
 *
 * Responsibilities:
 *   - Watch MESH_TASKS KV bucket for real-time updates
 *   - Mirror KV entries into local SQLite (upsert with revision tracking)
 *   - Push local task changes to KV via CAS writes
 *   - Handle conflict resolution (KV wins on workers, SQLite wins on lead)
 *
 * This module is imported by the sync/tasks.ts module and the hooks layer.
 * It does NOT run as a standalone daemon — it's part of the MC process.
 */

import { getTasksKv, sc } from "@/lib/nats";
import { NODE_ID, NODE_ROLE } from "@/lib/config";

// ── Types ──

export interface MeshTaskEntry {
  task_id: string;
  title: string;
  description: string;
  status: string;
  origin: string;
  owner: string | null;
  priority: number;
  budget_minutes: number;
  metric: string | null;
  success_criteria: string[];
  scope: string[];
  tags: string[];
  preferred_nodes: string[];
  exclude_nodes: string[];
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity: string | null;
  result: Record<string, unknown> | null;
  attempts: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

// ── KV Read Operations ──

/**
 * List all tasks from MESH_TASKS KV bucket.
 * Returns empty array if NATS is unavailable.
 */
export async function listMeshTasks(): Promise<MeshTaskEntry[]> {
  const kv = await getTasksKv();
  if (!kv) return [];

  const tasks: MeshTaskEntry[] = [];
  const keys = await kv.keys();

  for await (const key of keys) {
    const entry = await kv.get(key);
    if (!entry?.value) continue;
    try {
      tasks.push(JSON.parse(sc.decode(entry.value)));
    } catch {
      // skip malformed
    }
  }

  return tasks;
}

/**
 * Get a single task from KV with its revision.
 */
export async function getMeshTask(
  taskId: string
): Promise<{ task: MeshTaskEntry; revision: number } | null> {
  const kv = await getTasksKv();
  if (!kv) return null;

  const entry = await kv.get(taskId);
  if (!entry?.value) return null;

  return {
    task: JSON.parse(sc.decode(entry.value)),
    revision: entry.revision,
  };
}

// ── KV Write Operations (CAS) ──

/**
 * Write a task to KV. Used by the lead to publish task state.
 * No CAS — overwrites unconditionally. Use updateMeshTaskCAS for safe updates.
 */
export async function putMeshTask(task: MeshTaskEntry): Promise<number> {
  const kv = await getTasksKv();
  if (!kv) throw new Error("NATS KV unavailable");

  const rev = await kv.put(task.task_id, sc.encode(JSON.stringify(task)));
  return rev;
}

/**
 * The task fields a node may edit in KV. Everything else (status, owner,
 * lease, budget deadline, result, attempts, plan links, review override,
 * metric) is the task daemon's: its RPCs check ownership, leases and operator
 * signatures, and its submit and proposal gates validate the metric. A merge of
 * arbitrary fields here let any Mission Control instance complete, reassign or
 * re-route a task without those checks.
 */
export const MESH_TASK_EDITABLE_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "priority",
  "budget_minutes",
  "success_criteria",
  "scope",
  "tags",
  "preferred_nodes",
  "exclude_nodes",
]);

/** An edit the sync engine refused; `status` is the HTTP status a route answers with. */
export class MeshTaskEditError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Update a task with CAS (Compare-And-Swap).
 * Fails if the revision doesn't match (another node wrote since our read).
 * Only MESH_TASK_EDITABLE_FIELDS may change.
 *
 * @returns New revision number on success
 * @throws MeshTaskEditError for a refused field (400), a missing task (404) or a
 *   foreign task on a worker (403); the KV error on a revision mismatch (caller
 *   should re-read and retry)
 */
export async function updateMeshTaskCAS(
  taskId: string,
  updates: Partial<MeshTaskEntry>,
  expectedRevision: number
): Promise<number> {
  const kv = await getTasksKv();
  if (!kv) throw new Error("NATS KV unavailable");

  const refused = Object.keys(updates).filter((k) => !MESH_TASK_EDITABLE_FIELDS.has(k));
  if (refused.length) {
    throw new MeshTaskEditError(`Fields not editable: ${refused.join(", ")}`, 400);
  }

  // Read current
  const entry = await kv.get(taskId);
  if (!entry?.value) throw new MeshTaskEditError(`Task ${taskId} not found in KV`, 404);

  const current = JSON.parse(sc.decode(entry.value));

  // Authority check
  if (NODE_ROLE !== "lead" && current.origin !== NODE_ID) {
    throw new MeshTaskEditError(
      `Authority denied: worker ${NODE_ID} cannot update task from ${current.origin}`,
      403
    );
  }

  // Merge and write
  const updated = { ...current, ...updates };
  const rev = await kv.update(
    taskId,
    sc.encode(JSON.stringify(updated)),
    expectedRevision
  );
  return rev;
}

/**
 * Propose a new task from a worker node.
 * Task is created with status "proposed" — the lead daemon validates.
 * Never overwrites: a proposal reusing an existing task_id is refused (409).
 */
export async function proposeMeshTask(
  task: Omit<MeshTaskEntry, "status" | "origin">
): Promise<MeshTaskEntry> {
  const kv = await getTasksKv();
  if (!kv) throw new Error("NATS KV unavailable");

  const proposed: MeshTaskEntry = {
    ...task,
    status: NODE_ROLE === "lead" ? "queued" : "proposed",
    origin: NODE_ID,
  } as MeshTaskEntry;

  try {
    await kv.create(proposed.task_id, sc.encode(JSON.stringify(proposed)));
  } catch (err) {
    if (/wrong last sequence/.test((err as Error).message)) {
      throw new MeshTaskEditError(`Task ${proposed.task_id} already exists`, 409);
    }
    throw err;
  }
  return proposed;
}

// ── KV Watcher ──

export interface KvWatchEvent {
  key: string;
  operation: "PUT" | "DEL";
  task: MeshTaskEntry | null;
  revision: number;
}

/**
 * Start watching the MESH_TASKS KV bucket.
 * Returns an async iterator of KvWatchEvent and a stop() function.
 *
 * Call stop() on cleanup to prevent zombie watchers leaking NATS connections.
 */
export async function watchMeshTasks(): Promise<{
  events: AsyncIterable<KvWatchEvent>;
  stop: () => void;
} | null> {
  const kv = await getTasksKv();
  if (!kv) return null;

  const watcher = await kv.watch();

  const events: AsyncIterable<KvWatchEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = await watcher[Symbol.asyncIterator]().next();
          if (result.done) return { value: undefined, done: true };

          const entry = result.value;
          let task: MeshTaskEntry | null = null;
          if (entry.value) {
            try {
              task = JSON.parse(sc.decode(entry.value));
            } catch {
              // malformed
            }
          }

          return {
            value: {
              key: entry.key,
              operation: entry.value ? "PUT" : ("DEL" as const),
              task,
              revision: entry.revision,
            },
            done: false,
          };
        },
      };
    },
  };

  return {
    events,
    stop: () => {
      if (typeof watcher.stop === "function") {
        watcher.stop();
      }
    },
  };
}

// ── Merge Logic (for UI layer) ──

export interface MergedTask {
  id: string;
  title: string;
  source: "sqlite" | "kv" | "merged";
  [key: string]: unknown;
}

/**
 * Merge local SQLite tasks with KV mesh tasks.
 * Deduplicates by task ID.
 *
 * On lead: SQLite wins (has richer fields like kanbanColumn, sortOrder)
 * On worker: KV wins (more up-to-date for mesh-coordinated tasks)
 */
export function mergeTasks(
  sqliteTasks: Array<{ id: string; [key: string]: unknown }>,
  kvTasks: Array<{ task_id: string; [key: string]: unknown }>,
  nodeRole: "lead" | "worker" = NODE_ROLE
): MergedTask[] {
  const merged = new Map<string, MergedTask>();

  // SQLite tasks first
  for (const t of sqliteTasks) {
    merged.set(t.id, { ...t, id: t.id, title: String(t.title || ""), source: "sqlite" });
  }

  // KV tasks: on worker, KV wins for mesh tasks; on lead, SQLite wins
  for (const t of kvTasks) {
    const existing = merged.get(t.task_id);
    if (!existing) {
      merged.set(t.task_id, {
        ...t,
        id: t.task_id,
        title: String(t.title || ""),
        source: "kv",
      });
    } else if (nodeRole === "worker") {
      merged.set(t.task_id, {
        ...t,
        id: t.task_id,
        title: String(t.title || ""),
        source: "kv",
      });
    }
    // Lead: SQLite wins (don't overwrite)
  }

  return Array.from(merged.values());
}
