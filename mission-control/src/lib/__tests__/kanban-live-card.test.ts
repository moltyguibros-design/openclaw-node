import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// GET /api/tasks prepends a derived, unstored __LIVE_SESSION__ card; PATCH on it
// answers 404. KanbanBoard owns its SWR state and has no DOM harness here, so the
// click guard is checked at the source level.
it("a click on the live-session card neither opens the edit dialog nor joins a bulk selection", () => {
  const board = fs.readFileSync(path.join(__dirname, "../../components/board/kanban-board.tsx"), "utf8");
  expect(board).toMatch(/const handleTaskClick = \(task: Task\) => \{\s*if \(task\.id === "__LIVE_SESSION__"\) return;/);
});
