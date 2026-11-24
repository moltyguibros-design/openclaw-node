import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { parseMemoryMd } from "../parsers/memory-md";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-md-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseMemoryMd", () => {
  it("extracts H1 title", () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "# Long-Term Memory\n\nSome content\n");
    const result = parseMemoryMd(filePath);
    expect(result.title).toBe("Long-Term Memory");
  });

  it("defaults title to MEMORY.md when no H1", () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "No heading\n## Section\nContent\n");
    const result = parseMemoryMd(filePath);
    expect(result.title).toBe("MEMORY.md");
  });

  it("preserves full content", () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    const content = "# Memory\n\nRaw content here\n";
    fs.writeFileSync(filePath, content);
    const result = parseMemoryMd(filePath);
    expect(result.fullContent).toBe(content);
  });

  it("includes modification timestamp", () => {
    const filePath = path.join(tmpDir, "MEMORY.md");
    fs.writeFileSync(filePath, "content");
    const result = parseMemoryMd(filePath);
    expect(result.modifiedAt).toBeDefined();
    expect(new Date(result.modifiedAt).getTime()).toBeGreaterThan(0);
  });

  it("throws for missing file", () => {
    expect(() => parseMemoryMd("/nonexistent/MEMORY.md")).toThrow("not found");
  });
});
