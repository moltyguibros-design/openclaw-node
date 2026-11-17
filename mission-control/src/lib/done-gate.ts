/** Only the human operator marks a task done (force_done); anything else lands in review. */
export function applyDoneGate(update: Record<string, unknown>, forceDone: unknown): void {
  if (forceDone) return;
  // Cancelled also lands in the done column, but it is not a claim of finished
  // work; gating it to review meant the mesh cancel was never sent.
  if (update.status === "cancelled") return;
  if (update.status === "done" || update.kanbanColumn === "done") {
    update.status = "waiting-user";
    update.kanbanColumn = "review";
  }
}

// Unconfirmed human controls (sub-item checkbox, dialog checkbox) send work to
// review rather than done, so a reviewed item reads as checked.
export function isCheckedOff(status: string): boolean {
  return status === "done" || status === "waiting-user";
}

export function checkOffToggle(status: string): "queued" | "waiting-user" {
  return isCheckedOff(status) ? "queued" : "waiting-user";
}
