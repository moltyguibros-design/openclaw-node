/** Only the human operator marks a task done (force_done); anything else lands in review. */
export function applyDoneGate(update: Record<string, unknown>, forceDone: unknown): void {
  if (forceDone) return;
  if (update.status === "done" || update.kanbanColumn === "done") {
    update.status = "waiting-user";
    update.kanbanColumn = "review";
  }
}
