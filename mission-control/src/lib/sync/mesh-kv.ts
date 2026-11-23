/**
 * mesh-kv.ts — read access to the MESH_TASKS KV bucket for Mission Control.
 *
 * The /api/mesh/tasks routes read through listMeshTasks and getMeshTask.
 * watchMeshTasks and mergeTasks have no caller yet: they are kept as groundwork
 * for a multi-node Mission Control.
 *
 * Nothing here writes MESH_TASKS. Only the task daemon does, behind its
 * ownership checks: task creation and edits go through mesh.tasks.submit and
 * the signed mesh.tasks.update, whose lib/mesh-tasks.js EDITABLE_TASK_FIELDS is
 * the one list of editable fields.
 */

import { getTasksKv, sc } from "@/lib/nats";
import { NODE_ROLE } from "@/lib/config";

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
  // nats.js hands out a fresh generator on every [Symbol.asyncIterator]() call
  // and refuses a second one while the first is suspended ("already yielding").
  const source = watcher[Symbol.asyncIterator]();

  const events: AsyncIterable<KvWatchEvent> = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = await source.next();
          if (result.done) return { value: undefined, done: true };

          const entry = result.value;
          // A DEL or PURGE entry carries an empty, still truthy, value.
          const operation = entry.operation === "PUT" ? "PUT" : "DEL";
          let task: MeshTaskEntry | null = null;
          if (operation === "PUT") {
            try {
              task = JSON.parse(sc.decode(entry.value));
            } catch {
              // malformed
            }
          }

          return {
            value: {
              key: entry.key,
              operation,
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
