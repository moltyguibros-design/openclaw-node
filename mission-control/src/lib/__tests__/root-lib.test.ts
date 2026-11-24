import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("loadRootLib imports a root lib from OPENCLAW_LIB_DIR once, and retries a lookup that failed", async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-root-lib-"));
  fs.writeFileSync(path.join(dir, "stub.mjs"), "export const v = 1;\n");
  vi.stubEnv("OPENCLAW_LIB_DIR", dir);
  vi.resetModules();
  const { loadRootLib } = await import("@/lib/root-lib");

  const first = loadRootLib<{ v: number }>("stub.mjs");
  expect(loadRootLib("stub.mjs")).toBe(first);
  expect((await first).v).toBe(1);

  await expect(loadRootLib("missing.mjs")).rejects.toThrow(/missing\.mjs not found \(tried: .*OPENCLAW_LIB_DIR/);
  fs.writeFileSync(path.join(dir, "missing.mjs"), "export const v = 2;\n");
  expect((await loadRootLib<{ v: number }>("missing.mjs")).v).toBe(2);
});

test("mesh-sign and soul-access load their root libs through loadRootLib", () => {
  const src = path.join(__dirname, "..");
  for (const f of ["mesh-sign.ts", "soul-access.ts"]) {
    const text = fs.readFileSync(path.join(src, f), "utf8");
    expect(text, f).toMatch(/loadRootLib</);
    expect(text, f).not.toMatch(/webpackIgnore|function candidates/);
  }
});
