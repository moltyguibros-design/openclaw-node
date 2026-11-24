import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { applyDoneGate, isCheckedOff, checkOffToggle } from "../done-gate";

// The sub-item checkbox, the dialog checkbox and bulk "Move to: Done" send no
// force_done, so the done gate lands them in Review. They used to say "done",
// and a sub-item in Review never showed checked: a second click sent "done"
// again and stayed in Review.
const board = path.join(__dirname, "../../components/board");
const read = (f: string) => fs.readFileSync(path.join(board, f), "utf8");

describe("unconfirmed human done controls", () => {
  it("a sub-item checked once reads as checked and unchecks on the next click", () => {
    const update: Record<string, unknown> = { status: checkOffToggle("queued") };
    applyDoneGate(update, undefined);
    expect(update.status).toBe("waiting-user");
    expect(isCheckedOff(update.status as string)).toBe(true);
    expect(checkOffToggle(update.status as string)).toBe("queued");
  });

  it("treats done as checked and running as not", () => {
    expect(isCheckedOff("done")).toBe(true);
    expect(isCheckedOff("running")).toBe(false);
    expect(checkOffToggle("done")).toBe("queued");
  });

  it("the card's checkbox and progress count use the review-aware check", () => {
    const src = read("task-card.tsx");
    expect(src).toContain("status: checkOffToggle(sub.status)");
    expect(src).toContain('isCheckedOff(s.status) || s.status === "cancelled"');
    expect(src).not.toMatch(/sub\.status === "done"/);
  });

  it("the dialog checkbox says Send to review and sets waiting-user", () => {
    const src = read("unified-task-dialog.tsx");
    expect(src).not.toContain("Mark as done");
    expect(src).toContain("Send to review");
    expect(src).toContain('setStatus(e.target.checked ? "waiting-user" : "queued")');
  });

  it("bulk Move to: offers no Done that would land in Review", () => {
    expect(read("kanban-board.tsx")).toContain('COLUMNS.filter((col) => col !== "done").map((col) => (');
  });
});
