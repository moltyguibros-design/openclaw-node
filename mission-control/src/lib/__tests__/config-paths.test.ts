import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmps: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-config-paths-"));
  tmps.push(dir);
  return dir;
}

test("WORKSPACE_ROOT falls back to OPENCLAW_WORKSPACE, the name the service units set", async () => {
  vi.stubEnv("WORKSPACE_ROOT", "");
  vi.stubEnv("OPENCLAW_WORKSPACE", "/srv/oc/ws");
  vi.resetModules();
  expect((await import("@/lib/config")).WORKSPACE_ROOT).toBe("/srv/oc/ws");
});

test("with neither variable set, every workspace consumer resolves under the real home", async () => {
  const home = tmpHome();
  const workspace = path.join(home, ".openclaw", "workspace");
  vi.stubEnv("WORKSPACE_ROOT", "");
  vi.stubEnv("OPENCLAW_WORKSPACE", "");
  vi.stubEnv("HOME", home);
  vi.resetModules();

  expect((await import("@/lib/config")).WORKSPACE_ROOT).toBe(workspace);
  expect((await import("@/lib/memory/categories")).getCategoryPath("work")).toBe(
    path.join(workspace, "memory", "categories", "work.md"),
  );

  const sessions = path.join(home, ".openclaw", "agents", "main", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const toolUse = (name: string, file_path: string) =>
    JSON.stringify({
      timestamp: "2026-11-11T12:00:00Z",
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input: { file_path } }] },
    });
  fs.writeFileSync(
    path.join(sessions, "s.jsonl"),
    [
      toolUse("Write", path.join(workspace, "projects", "a", "b", "c.md")),
      toolUse("Edit", path.join(home, "notes", "x", "y", "z.md")),
    ].join("\n") + "\n",
  );
  const details = (await import("@/lib/parsers/transcript"))
    .getRecentTranscriptActivity()
    .map((e) => e.detail);
  expect(details).toEqual(["Edited notes/x/y/z.md", "Wrote projects/a/b/c.md"]);
});
