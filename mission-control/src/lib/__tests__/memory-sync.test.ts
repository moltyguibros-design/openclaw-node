import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-memory-sync-"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.stubEnv("DB_PATH", path.join(root, "mc.db"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

test("one unparseable vault doc keeps its row and the docs after it; a doc deleted from disk loses its row", async () => {
  const notes = path.join(root, "memory-vault", "notes");
  fs.mkdirSync(notes, { recursive: true });
  const [a, b, c] = ["A", "B", "C"].map((n) => path.join(notes, `${n}.md`));
  for (const [file, title] of [[a, "A"], [b, "B"], [c, "C"]]) {
    fs.writeFileSync(file, `---\ntitle: ${title}\n---\nbody ${title}\n`);
  }
  fs.writeFileSync(
    path.join(root, "memory-vault", ".clawvault-index.json"),
    JSON.stringify({ documents: [c, a, b].map((p) => ({ path: p, category: "notes" })) }),
  );

  const { getDb, getRawDb } = await import("@/lib/db");
  const { indexAllMemory } = await import("@/lib/sync/memory");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(indexAllMemory(getDb())).toEqual({ indexed: 3, updated: 0, removed: 0 });

    fs.writeFileSync(a, "---\ntitle: [x\n---\nbody\n");
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(a, later, later);
    fs.rmSync(c);

    const stats = indexAllMemory(getDb());
    const paths = (getRawDb().prepare("SELECT file_path FROM memory_docs ORDER BY file_path").all() as { file_path: string }[])
      .map((r) => r.file_path);
    expect(paths).toEqual([a, b]);
    expect(stats.removed).toBe(1);
    expect(getRawDb().prepare("SELECT title FROM memory_docs WHERE file_path = ?").get(a)).toEqual({ title: "A" });
  } finally {
    warn.mockRestore();
    getRawDb().close();
  }
});

test("one unreadable lore file does not drop the lore files listed after it", async () => {
  const research = path.join(root, "projects", "arcane", "lore", "research");
  fs.mkdirSync(research, { recursive: true });
  fs.writeFileSync(path.join(research, "a.md"), "# A\n");
  fs.writeFileSync(path.join(research, "b.md"), "# B\n");
  const [first, second] = fs.readdirSync(research).map((f) => path.join(research, f));

  const { getDb, getRawDb } = await import("@/lib/db");
  const { indexAllMemory } = await import("@/lib/sync/memory");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(indexAllMemory(getDb()).indexed).toBe(2);

    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(first, later, later);
    const realRead = fs.readFileSync;
    const read = vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (file === first) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      return (realRead as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    try {
      const stats = indexAllMemory(getDb());
      expect(stats.removed).toBe(0);
    } finally {
      read.mockRestore();
    }
    const paths = (getRawDb().prepare("SELECT file_path FROM memory_docs ORDER BY file_path").all() as { file_path: string }[])
      .map((r) => r.file_path);
    expect(paths).toEqual([first, second].sort());
  } finally {
    warn.mockRestore();
    getRawDb().close();
  }
});
