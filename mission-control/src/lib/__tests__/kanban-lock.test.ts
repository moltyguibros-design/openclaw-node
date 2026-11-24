import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withKanbanLockSync } from "@/lib/sync/tasks";
import { NODE_ID } from "@/lib/config";

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

  it("records pid + node + time while held and names the holder on contention", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-kanban-owner-"));
    const file = path.join(dir, "active-tasks.md");
    const lockDir = file + ".lk";

    const seen = withKanbanLockSync(file, () => JSON.parse(fs.readFileSync(path.join(lockDir, "owner"), "utf-8")));
    expect(seen.pid).toBe(process.pid);
    expect(seen.node).toBe(NODE_ID);
    expect(Math.abs(Date.now() - seen.acquiredAt)).toBeLessThan(10_000);
    expect(fs.existsSync(lockDir)).toBe(false);

    fs.mkdirSync(lockDir);
    fs.writeFileSync(path.join(lockDir, "owner"), JSON.stringify({ pid: 4242, node: "other-host", acquiredAt: Date.now() }));
    expect(() => withKanbanLockSync(file, () => "ran", 300)).toThrow(/pid 4242 on other-host/);

    const old = (Date.now() - 60_000) / 1000;
    fs.utimesSync(lockDir, old, old);
    expect(withKanbanLockSync(file, () => "ran", 300)).toBe("ran");
    expect(fs.existsSync(lockDir)).toBe(false);
  });
});
