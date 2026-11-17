import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// POST /api/tasks reads body.next_action; there is no component harness, so
// the dialog's createTask literals are checked at the source level.
const dialog = fs.readFileSync(
  path.join(__dirname, "..", "..", "components", "board", "unified-task-dialog.tsx"),
  "utf-8",
);
const createCalls = [...dialog.matchAll(/createTask\(\{([\s\S]*?)\}\);/g)].map((m) => m[1]);

test("the task dialog has both create paths", () => {
  expect(createCalls).toHaveLength(2);
});

test.each(createCalls.map((body, i) => [i, body]))(
  "createTask call %i sends next_action in the snake_case key the POST route reads",
  (_i, body) => {
    expect(body).toMatch(/\bnext_action:/);
    expect(body).not.toMatch(/\bnextAction:/);
  },
);
