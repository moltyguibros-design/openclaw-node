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

test("a non-default OPENCLAW_ROOT moves every MC store under it, not under ~/.openclaw", async () => {
  const home = tmpHome();
  const root = path.join(tmpHome(), "oc-root");
  vi.stubEnv("HOME", home);
  vi.stubEnv("WORKSPACE_ROOT", path.join(root, "workspace"));
  vi.stubEnv("OPENCLAW_HOME", "");
  vi.resetModules();

  const config = await import("@/lib/config");
  expect(config.OPENCLAW_ROOT).toBe(root);
  expect(config.HANDOFFS_DIR).toBe(path.join(root, "workspace", "memory-vault", "handoffs"));
  expect(config.SOULS_DIR).toBe(path.join(root, "souls"));
  expect(config.MC_SESSION_TOKEN_PATH).toBe(path.join(root, "config", "mc-session-token"));

  vi.spyOn(console, "log").mockImplementation(() => {});
  const token = (await import("@/lib/server-auth")).loadOrCreateSessionToken();
  expect(fs.readFileSync(path.join(root, "config", "mc-session-token"), "utf8").trim()).toBe(token);
  expect(fs.existsSync(path.join(home, ".openclaw"))).toBe(false);

  const { defaultMcTokenPath } = await import("../../../../lib/mc-session-token.mjs");
  expect(defaultMcTokenPath({ OPENCLAW_WORKSPACE: path.join(root, "workspace") })).toBe(config.MC_SESSION_TOKEN_PATH);

  expect((await import("@/lib/nats-auth")).openclawHome()).toBe(root);
});

test("no MC module outside config.ts joins the home directory with .openclaw", () => {
  const src = path.join(__dirname, "..", "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith(path.join("lib", "config.ts"))) {
        const text = fs.readFileSync(p, "utf8");
        if (/homedir\(\)[^\n;]*\.openclaw|homedir\(\),\s*\n\s*"\.openclaw|HOME,\s*"\.openclaw/.test(text)) {
          offenders.push(path.relative(src, p));
        }
      }
    }
  };
  walk(src);
  expect(offenders).toEqual([]);
});
