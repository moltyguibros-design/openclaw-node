---
name: self-improving-agent
description: "Captures learnings, errors, and corrections to enable continuous improvement. Use when a command fails, user corrects the agent, a capability is missing, or a better approach is discovered. Also reviews learnings before major tasks."
triggers:
  - "log this as a learning"
  - "save this error"
  - "that's wrong, actually"
  - "remember this for next time"
  - "check learnings before starting"
negative_triggers:
  - "improve the UI"
  - "optimize performance"
  - "refactor this code"
---

# Self-Improvement Skill

Log learnings and errors to markdown files for continuous improvement. Coding agents can later process these into fixes, and important learnings get promoted to project memory.

## Quick Reference

Every lesson is one line appended to `.learnings/lessons.md` in the workspace, the file boot reads
(identity/MEMORY_SPEC.md §2.5):

```markdown
[tag] Lesson text (YYYY-MM-DD)
```

| Situation | Action |
|-----------|--------|
| Command/operation fails | `[error]` line |
| API/external tool fails | `[error]` line naming the integration |
| User corrects you | `[correction]` line |
| Knowledge was outdated | `[correction]` line |
| Found better approach | `[pattern]` line |
| User states how they want things done | `[preference]` line |
| User wants missing feature or a process change | `[workflow]` line |
| Similar to existing entry | Don't duplicate; sharpen the existing line |
| Broadly applicable learning | Promote to `CLAUDE.md`, `AGENTS.md`, and/or `.github/copilot-instructions.md` |
| Workflow improvements | Promote to `AGENTS.md` (OpenClaw workspace) |
| Tool gotchas | Promote to `TOOLS.md` (OpenClaw workspace) |
| Behavioral patterns | Promote to `SOUL.md` (OpenClaw workspace) |

Valid tags: `correction`, `pattern`, `error`, `preference`, `workflow`. `error`, `pattern` and
`correction` lines are shared with the other nodes by obsidian-sync.

## OpenClaw Setup (Recommended)

OpenClaw is the primary platform for this skill. It uses workspace-based prompt injection with automatic skill loading.

### Installation

The OpenClaw installer ships this skill to `~/.openclaw/workspace/skills/self-improving-agent/`.
This copy is patched locally for that layout; a ClawHub update would bring back the upstream
`.learnings/LEARNINGS.md` / `ERRORS.md` / `FEATURE_REQUESTS.md` logs, which boot does not read.

### Workspace Structure

OpenClaw injects these files into every session:

```
~/.openclaw/workspace/
├── AGENTS.md          # Multi-agent workflows, delegation patterns
├── SOUL.md            # Behavioral guidelines, personality, principles
├── TOOLS.md           # Tool capabilities, integration gotchas
├── MEMORY.md          # Long-term memory (main session only)
├── memory/            # Daily memory files
│   └── YYYY-MM-DD.md
└── .learnings/
    └── lessons.md     # This skill's log, read at boot
```

### Learning File

The installer creates `~/.openclaw/workspace/.learnings/lessons.md`. Append to it; never start a
second log next to it.

### Promotion Targets

When learnings prove broadly applicable, promote them to workspace files:

| Learning Type | Promote To | Example |
|---------------|------------|---------|
| Behavioral patterns | `SOUL.md` | "Be concise, avoid disclaimers" |
| Workflow improvements | `AGENTS.md` | "Spawn sub-agents for long tasks" |
| Tool gotchas | `TOOLS.md` | "Git push needs auth configured first" |

### Inter-Session Communication

OpenClaw provides tools to share learnings across sessions:

- **sessions_list** — View active/recent sessions
- **sessions_history** — Read another session's transcript
- **sessions_send** — Send a learning to another session
- **sessions_spawn** — Spawn a sub-agent for background work

### Optional: Enable Hook

For automatic reminders at session start:

```bash
# Copy hook to OpenClaw hooks directory
cp -r hooks/openclaw ~/.openclaw/hooks/self-improvement

# Enable it
openclaw hooks enable self-improvement
```

See `references/openclaw-integration.md` for complete details.

---

## Generic Setup (Other Agents)

For Claude Code, Codex, Copilot, or other agents, use `.learnings/lessons.md` in your project
with the same one-line format:

```bash
mkdir -p .learnings && touch .learnings/lessons.md
```

Hook recipes for Claude Code are in [references/hooks-setup.md](references/hooks-setup.md).

## Templates, Formats & Extended Reference

See [references/templates.md](references/templates.md) for templates and detailed examples.

Covers: the lessons.md line format and tag set, promoting to project memory, recurring pattern detection, periodic review, detection triggers, best practices, hook integration, automatic skill extraction, and multi-agent support.
