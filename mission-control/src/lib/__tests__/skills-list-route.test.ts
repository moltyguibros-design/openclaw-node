import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HAVE_PY = spawnSync("python3", ["--version"]).status === 0;
const WORKSPACE_BIN = path.join(__dirname, "..", "..", "..", "..", "workspace-bin");

let root: string;
let GET: () => Promise<Response>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-skills-list-"));
  const ws = path.join(root, "oc", "workspace");
  fs.mkdirSync(path.join(ws, "bin", "lib"), { recursive: true });
  fs.copyFileSync(path.join(WORKSPACE_BIN, "skill-audit"), path.join(ws, "bin", "skill-audit"));
  for (const f of ["__init__.py", "frontmatter.py"]) {
    fs.copyFileSync(path.join(WORKSPACE_BIN, "lib", f), path.join(ws, "bin", "lib", f));
  }
  fs.mkdirSync(path.join(ws, "skills", "x"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "skills", "x", "SKILL.md"),
    "---\nname: x\ndescription: Does x. Use when x is needed.\n---\n# X\n",
  );
  fs.mkdirSync(path.join(root, "home"));
  vi.stubEnv("WORKSPACE_ROOT", ws);
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.resetModules();
  ({ GET } = await import("@/app/api/skills/list/route"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

test.skipIf(!HAVE_PY)("audits the skills of a workspace outside ~/.openclaw", async () => {
  const res = await GET();
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(200);
  expect(body.total_skills).toBe(1);
  expect(body.skills.map((s: { name: string }) => s.name)).toEqual(["x"]);
});
