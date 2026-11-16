import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withKanbanLockSync } from "@/lib/sync/tasks";

describe("withKanbanLockSync stale lock recovery", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("breaks a lock left behind longer than 30s ago, and still waits on a fresh one", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-kanban-lock-"));
    const file = path.join(dir, "active-tasks.md");
    const lockDir = file + ".lk";
    fs.mkdirSync(lockDir);

    expect(() => withKanbanLockSync(file, () => "ran", 300)).toThrow(/lock acquisition timeout/);

    const old = (Date.now() - 60_000) / 1000;
    fs.utimesSync(lockDir, old, old);
    expect(withKanbanLockSync(file, () => "ran", 300)).toBe("ran");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
