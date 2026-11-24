import { describe, it, expect } from "vitest";
import { barDragUpdate } from "../roadmap-drag";

const viewStart = new Date(2026, 10, 1);
const dayWidth = 40;

describe("barDragUpdate", () => {
  it("moves a leaf task by its scheduled_date, the field its bar is drawn from", () => {
    const leaf = { type: "task", scheduledDate: "2026-11-10" };
    const left = 9 * dayWidth;
    expect(barDragUpdate(leaf, left + 2 * dayWidth, 60, viewStart, dayWidth)).toEqual({
      scheduled_date: "2026-11-12",
    });
  });

  it("moves a ranged bar by start_date/end_date, keeping its duration", () => {
    const phase = { type: "phase", scheduledDate: null };
    expect(barDragUpdate(phase, 3 * dayWidth, 5 * dayWidth, viewStart, dayWidth)).toEqual({
      start_date: "2026-11-04",
      end_date: "2026-11-09",
    });
  });

  it("treats a leaf task without a scheduled date as ranged", () => {
    const leaf = { type: "task", scheduledDate: null };
    expect(barDragUpdate(leaf, 0, dayWidth / 4, viewStart, dayWidth)).toEqual({
      start_date: "2026-11-01",
      end_date: "2026-11-02",
    });
  });
});
