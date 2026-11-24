import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractWikilinks,
  extractTaskIds,
  extractFileRefs,
  buildResolutionMaps,
  resolveWikilink,
  extractAllReferences,
  toGraphId,
} from "../memory/wikilinks";

describe("extractWikilinks", () => {
  it("extracts basic wikilinks", () => {
    const result = extractWikilinks("See [[Project Alpha]] and [[Task Beta]]");
    expect(result).toEqual(["Project Alpha", "Task Beta"]);
  });

  it("handles aliased wikilinks [[target|display]]", () => {
    const result = extractWikilinks("Check [[real-target|Display Name]]");
    expect(result).toEqual(["real-target"]);
  });

  it("deduplicates wikilinks", () => {
    const result = extractWikilinks("[[Foo]] and [[Foo]] again");
    expect(result).toEqual(["Foo"]);
  });

  it("ignores wikilinks inside code blocks", () => {
    const result = extractWikilinks("```\n[[Inside Code]]\n```\nOutside [[Real]]");
    expect(result).toEqual(["Real"]);
  });

  it("ignores wikilinks inside inline code", () => {
    const result = extractWikilinks("Use `[[NotALink]]` but [[ActualLink]]");
    expect(result).toEqual(["ActualLink"]);
  });

  it("returns empty for no wikilinks", () => {
    expect(extractWikilinks("No links here")).toEqual([]);
  });

  it("skips empty targets", () => {
    expect(extractWikilinks("[[]]")).toEqual([]);
  });

  it("trims whitespace from targets", () => {
    const result = extractWikilinks("[[  Padded  ]]");
    expect(result).toEqual(["Padded"]);
  });
});

describe("extractTaskIds", () => {
  it("extracts T-YYYYMMDD-NNN format", () => {
    const result = extractTaskIds("Working on T-20260305-001 and T-20260310-042");
    expect(result).toEqual(["T-20260305-001", "T-20260310-042"]);
  });

  it("extracts ARCANE-style IDs", () => {
    const result = extractTaskIds("ARCANE-M01 and ARCANE-B02-3");
    expect(result).toEqual(["ARCANE-M01", "ARCANE-B02-3"]);
  });

  it("deduplicates task IDs", () => {
    const result = extractTaskIds("T-20260305-001 mentioned twice: T-20260305-001");
    expect(result).toEqual(["T-20260305-001"]);
  });

  it("ignores IDs in code blocks", () => {
    const result = extractTaskIds("```\nT-20260101-999\n```");
    expect(result).toEqual([]);
  });
});

describe("extractFileRefs", () => {
  it("extracts markdown file references", () => {
    const result = extractFileRefs("See docs/README.md for details");
    expect(result).toContain("docs/README.md");
  });

  it("extracts various extensions", () => {
    const result = extractFileRefs("Edit src/app.ts and config.json");
    expect(result).toContain("src/app.ts");
    expect(result).toContain("config.json");
  });

  it("skips http URLs", () => {
    const result = extractFileRefs("Visit https://example.com/page");
    // http refs are filtered out
    const httpRefs = result.filter((r) => r.includes("http"));
    expect(httpRefs).toEqual([]);
  });

  it("includes short but valid file refs", () => {
    // "a.md" is 4 chars, passes the >= 4 length check
    const result = extractFileRefs("see a.md for info");
    expect(result).toContain("a.md");
  });
});

describe("buildResolutionMaps", () => {
  it("builds path, basename, and title maps", () => {
    const docs = [
      { filePath: "projects/alpha/README.md", title: "Alpha Project" },
      { filePath: "memory/notes.md", title: "Session Notes" },
    ];
    const maps = buildResolutionMaps(docs);

    expect(maps.byPath.has("projects/alpha/README.md")).toBe(true);
    expect(maps.byBasename.has("readme")).toBe(true);
    expect(maps.byTitle.has("alpha project")).toBe(true);
  });

  it("first doc wins for basename conflicts", () => {
    const docs = [
      { filePath: "a/notes.md", title: null },
      { filePath: "b/notes.md", title: null },
    ];
    const maps = buildResolutionMaps(docs);
    expect(maps.byBasename.get("notes")).toBe("a/notes.md");
  });
});

describe("resolveWikilink", () => {
  const maps = buildResolutionMaps([
    { filePath: "projects/alpha.md", title: "Alpha Project" },
    { filePath: "memory/2026-03-01.md", title: "March 1 Log" },
  ]);

  it("resolves exact path", () => {
    expect(resolveWikilink("projects/alpha.md", maps)).toBe("projects/alpha.md");
  });

  it("resolves path without .md extension", () => {
    expect(resolveWikilink("projects/alpha", maps)).toBe("projects/alpha.md");
  });

  it("resolves by basename (case-insensitive)", () => {
    expect(resolveWikilink("Alpha", maps)).toBe("projects/alpha.md");
  });

  it("resolves by title (case-insensitive)", () => {
    expect(resolveWikilink("alpha project", maps)).toBe("projects/alpha.md");
  });

  it("returns null for unresolvable target", () => {
    expect(resolveWikilink("nonexistent", maps)).toBeNull();
  });
});

describe("extractAllReferences", () => {
  const maps = buildResolutionMaps([
    { filePath: "projects/alpha.md", title: "Alpha Project" },
    { filePath: "tasks/T-20260305-001.md", title: "T-20260305-001" },
    { filePath: "self.md", title: "Self" },
  ]);

  it("combines wikilinks, task IDs, and file refs", () => {
    const content = "See [[Alpha Project]] and T-20260305-001 in projects/alpha.md";
    const refs = extractAllReferences(content, maps, "self.md");
    expect(refs).toContain("projects/alpha.md");
    expect(refs).toContain("tasks/T-20260305-001.md");
  });

  it("excludes self-references", () => {
    const content = "[[Self]] is this document";
    const refs = extractAllReferences(content, maps, "self.md");
    expect(refs).not.toContain("self.md");
  });

  it("deduplicates across sources", () => {
    const content = "[[Alpha Project]] and projects/alpha.md";
    const refs = extractAllReferences(content, maps, "self.md");
    const alphaCount = refs.filter((r) => r === "projects/alpha.md").length;
    expect(alphaCount).toBe(1);
  });
});

// The file tree selects workspace-relative paths; graph ids must use the same form.
describe("toGraphId", () => {
  it("makes a path under the workspace relative to it", () => {
    expect(toGraphId("/w/memory/2026-01-01.md", "/w")).toBe("memory/2026-01-01.md");
    expect(toGraphId("/w/MEMORY.md", "/w")).toBe("MEMORY.md");
  });

  it("leaves a path outside the workspace, or one already relative, as it is", () => {
    expect(toGraphId("/elsewhere/x.md", "/w")).toBe("/elsewhere/x.md");
    expect(toGraphId("/w-other/x.md", "/w")).toBe("/w-other/x.md");
    expect(toGraphId("memory-vault/a.md", "/w")).toBe("memory-vault/a.md");
  });
});

describe("GET /api/memory/wikilinks", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-wikilinks-route-"));
    vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
    vi.stubEnv("WORKSPACE_ROOT", root);
    vi.resetModules();
  });

  afterEach(async () => {
    const { getRawDb } = await import("@/lib/db");
    getRawDb().close();
    vi.unstubAllEnvs();
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits workspace-relative node ids and link endpoints", async () => {
    const { getDb } = await import("@/lib/db");
    const { memoryDocs } = await import("@/lib/db/schema");
    getDb().insert(memoryDocs).values([
      { source: "daily_log", filePath: path.join(root, "memory", "2026-01-01.md"), title: "Jan 1", content: "See [[MEMORY]]" },
      { source: "long_term_memory", filePath: path.join(root, "MEMORY.md"), title: "Memory", content: "# Memory" },
    ]).run();
    const { GET } = await import("@/app/api/memory/wikilinks/route");

    const body = await (await GET()).json();

    expect(body.nodes.map((n: { id: string; linkCount: number }) => [n.id, n.linkCount])).toEqual([
      ["memory/2026-01-01.md", 1],
      ["MEMORY.md", 1],
    ]);
    expect(body.links).toEqual([{ source: "memory/2026-01-01.md", target: "MEMORY.md" }]);
  });
});
