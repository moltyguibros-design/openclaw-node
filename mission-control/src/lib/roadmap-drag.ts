import { addDays, format } from "date-fns";
import type { Task } from "@/lib/hooks";

/** PATCH body for a Gantt bar dropped at newLeft/newWidth (pixels from viewStart). */
export function barDragUpdate(
  task: Pick<Task, "type" | "scheduledDate"> | undefined,
  newLeft: number,
  newWidth: number,
  viewStart: Date,
  dayWidth: number,
): Record<string, string> {
  const newStart = addDays(viewStart, Math.round(newLeft / dayWidth));
  // Leaf tasks are drawn from scheduledDate (getBarPosition), so that is what a move must change.
  if (task?.type === "task" && task.scheduledDate) {
    return { scheduled_date: format(newStart, "yyyy-MM-dd") };
  }
  const durationDays = Math.max(Math.round(newWidth / dayWidth), 1);
  return {
    start_date: format(newStart, "yyyy-MM-dd"),
    end_date: format(addDays(newStart, durationDays), "yyyy-MM-dd"),
  };
}
