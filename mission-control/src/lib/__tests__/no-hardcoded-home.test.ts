import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", "..", rel), "utf-8");

test.each(["app/watcher/page.tsx", "app/api/resolve-path/route.ts"])("%s does not hard-code the operator's macOS home", (rel) => {
  expect(read(rel)).not.toContain("/Users/moltymac");
});

test("the watcher page builds source paths from the server-reported watcher.jsonl location", () => {
  expect(read("app/watcher/page.tsx")).toMatch(/source\s*\}\s*=\s*useWatcher\(/);
});
