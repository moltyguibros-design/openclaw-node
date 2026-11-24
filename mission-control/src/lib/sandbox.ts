import { AsyncLocalStorage } from "async_hooks";
import path from "path";
import type Database from "better-sqlite3";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import type * as schema from "./db/schema";
import { WORKSPACE_ROOT, ACTIVE_TASKS_MD } from "./config";

/**
 * A throw-away database and workspace that getDb(), the scheduler and the
 * markdown sync use instead of the live ones for the duration of a call
 * (the diagnostics test runner). Inside it gatewayNotify sends nothing.
 */
export interface Sandbox {
  db: ReturnType<typeof drizzle<typeof schema>>;
  raw: Database.Database;
  workspaceRoot: string;
}

const store = new AsyncLocalStorage<Sandbox>();

export function currentSandbox(): Sandbox | undefined {
  return store.getStore();
}

export function runInSandbox<T>(sandbox: Sandbox, fn: () => T): T {
  return store.run(sandbox, fn);
}

export function workspaceRoot(): string {
  return store.getStore()?.workspaceRoot ?? WORKSPACE_ROOT;
}

export function activeTasksMd(): string {
  const sandbox = store.getStore();
  return sandbox ? path.join(sandbox.workspaceRoot, "memory", "active-tasks.md") : ACTIVE_TASKS_MD;
}
