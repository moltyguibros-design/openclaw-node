import { describe, it, expect } from "vitest";
import { applyDoneGate } from "../done-gate";

describe("applyDoneGate", () => {
  it("redirects done to waiting-user/review without force_done", () => {
    const update: Record<string, unknown> = { status: "done", kanbanColumn: "done" };
    applyDoneGate(update, undefined);
    expect(update).toEqual({ status: "waiting-user", kanbanColumn: "review" });
  });

  it("redirects a move to the done column alone", () => {
    const update: Record<string, unknown> = { kanbanColumn: "done" };
    applyDoneGate(update, undefined);
    expect(update).toEqual({ status: "waiting-user", kanbanColumn: "review" });
  });

  it("lets force_done through unchanged", () => {
    const update: Record<string, unknown> = { status: "done", kanbanColumn: "done" };
    applyDoneGate(update, true);
    expect(update).toEqual({ status: "done", kanbanColumn: "done" });
  });

  it("leaves non-done updates unchanged", () => {
    const update: Record<string, unknown> = { status: "running", kanbanColumn: "in_progress" };
    applyDoneGate(update, undefined);
    expect(update).toEqual({ status: "running", kanbanColumn: "in_progress" });
  });
});
