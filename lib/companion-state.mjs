/**
 * companion-state.mjs — the node's `.daemon-state-<node>.md`, which the
 * session-start hook shows every new session as its crash-recovery signal.
 *
 * `status` is the daemon's view of the node: active, idle, or ended once the
 * last session finished its end-of-session pipeline. A file still saying
 * active or idle when no session is live means the previous one died before
 * that pipeline ran.
 */

/**
 * @param {string} existing  the current file content ('' when absent)
 * @param {{ status: 'active'|'idle'|'ended', newSession?: boolean, now: string,
 *           runningTasks: string, runningCount: number, doneCount: number }} state
 *   newSession: the first session booted on a node with none live; started_at restarts.
 */
export function renderCompanionState(existing, { status, newSession = false, now, runningTasks, runningCount, doneCount }) {
  const previousStart = existing.match(/^started_at:\s*(.+)$/m)?.[1].trim();
  const startedAt = !newSession && previousStart ? previousStart : now;
  return `## Session Status
status: ${status}
started_at: ${startedAt}
last_flush: ${now}

## Active Task
${runningTasks}

## Current State
${runningCount} running, ${doneCount} done

## Crash Recovery
If this file says \`status: active\` or \`status: idle\` but no session is live:
1. The session crashed before its end-of-session flush
2. Read memory/active-tasks.md for last known work state
3. Resume from the active task listed above
`;
}
