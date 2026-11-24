/**
 * Self-Improvement Hook for OpenClaw
 *
 * Injects a reminder to evaluate learnings during agent bootstrap.
 * Fires on agent:bootstrap event before workspace files are injected.
 * handler.js is the CommonJS build of this file; keep the two in step.
 */

import type { HookHandler } from 'openclaw/hooks';

const REMINDER_CONTENT = `## Self-Improvement Reminder

After completing tasks, evaluate if any learnings should be captured.
Append one line to \`.learnings/lessons.md\`: \`[tag] Lesson text (YYYY-MM-DD)\`

**Log when:**
- User corrects you → \`[correction]\`
- You discover your knowledge was wrong → \`[correction]\`
- Command/operation fails → \`[error]\`
- You find a better approach → \`[pattern]\`
- User states how they want things done → \`[preference]\`
- User wants a missing capability or a process change → \`[workflow]\`

**Promote when pattern is proven:**
- Behavioral patterns → \`SOUL.md\`
- Workflow improvements → \`AGENTS.md\`
- Tool gotchas → \`TOOLS.md\`

Keep entries to one line: what happened and what to do differently.`;

const handler: HookHandler = async (event) => {
  // Safety checks for event structure
  if (!event || typeof event !== 'object') {
    return;
  }

  // Only handle agent:bootstrap events
  if (event.type !== 'agent' || event.action !== 'bootstrap') {
    return;
  }

  // Safety check for context
  if (!event.context || typeof event.context !== 'object') {
    return;
  }

  // Skip sub-agent sessions to avoid bootstrap issues
  // Sub-agents have sessionKey patterns like "agent:main:subagent:..."
  const sessionKey = event.sessionKey || '';
  if (sessionKey.includes(':subagent:')) {
    return;
  }

  // Inject the reminder as a virtual bootstrap file
  // Check that bootstrapFiles is an array before pushing
  if (Array.isArray(event.context.bootstrapFiles)) {
    event.context.bootstrapFiles.push({
      path: 'SELF_IMPROVEMENT_REMINDER.md',
      content: REMINDER_CONTENT,
      virtual: true,
    });
  }
};

export default handler;
