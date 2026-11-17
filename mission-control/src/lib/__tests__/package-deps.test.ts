import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";

const ROOT = path.join(__dirname, "..", "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

// Needed at runtime without a direct import: three is a peer of
// react-force-graph-3d's renderer.
const INDIRECT = new Set(["three"]);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx|mjs|js)$/.test(e.name) ? [p] : [];
  });
}

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"`;/()]*?from\s+["']([^"']+)["']|(?:^|[\s;])import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/gm;

function packageName(spec: string): string | null {
  if (/^(\.|\/|@\/|node:)/.test(spec)) return null;
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const files = [
  ...sources(path.join(ROOT, "src")),
  ...fs.readdirSync(ROOT).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => path.join(ROOT, f)),
];
const imported = new Set<string>();
for (const f of files) {
  for (const m of fs.readFileSync(f, "utf-8").matchAll(IMPORT_RE)) {
    const name = packageName(m[1] ?? m[2] ?? m[3] ?? m[4]);
    if (name) imported.add(name);
  }
}

test("every runtime dependency is imported somewhere (no dead installs)", () => {
  const unused = Object.keys(pkg.dependencies).filter((d) => !imported.has(d) && !INDIRECT.has(d));
  expect(unused).toEqual([]);
});

test("every imported package is declared, not reached through another package's hoisting", () => {
  const declared = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies), ...builtinModules]);
  expect([...imported].filter((n) => !declared.has(n))).toEqual([]);
});
