# Self-Improvement Templates & Detailed Examples

Extracted from SKILL.md for reference. See the main SKILL.md for overview and quick reference.

## Logging Format

Every lesson is one line appended to `.learnings/lessons.md` (identity/MEMORY_SPEC.md §2.5). Boot,
fitness scoring, the subagent audit and obsidian-sync all read this file and only this file.

```markdown
[tag] Lesson text (YYYY-MM-DD)
```

| Tag | Use for |
|-----|---------|
| `correction` | The user corrected you, or your knowledge turned out to be wrong or outdated |
| `pattern` | A better approach, convention or recurring fix you discovered |
| `error` | A command, tool or API failure and what to do instead |
| `preference` | How the user wants things done (style, tone, defaults) |
| `workflow` | A process change or a capability the user asked for that does not exist yet |

Rules:
- One line per lesson; the date is the day you learned it.
- The tag must be one of the five above.
- No exact duplicates: if a similar line exists, sharpen it instead of adding another.
- Name the command, file or integration involved so the line stands on its own.

Examples:

```markdown
[error] `npm install` fails in pnpm workspaces; check for pnpm-lock.yaml and use `pnpm install` (2025-01-15)
[correction] pytest fixtures for DB connections are module-scoped in this repo, not function-scoped (2025-01-15)
[pattern] Regenerate the API client with `pnpm run generate:api` after changing an endpoint (2025-01-16)
[preference] User wants commit messages in the conventional format with a short body (2025-01-17)
[workflow] User wants a CSV export of analysis results; not built yet (2025-01-18)
```

`error`, `pattern` and `correction` lines are propagated to the other nodes through the vault's
`00-meta/shared-lessons.md`; `preference` and `workflow` stay on this node.

## Promoting to Project Memory

When a learning is broadly applicable (not a one-off fix), promote it to permanent project memory.

### When to Promote

- Learning applies across multiple files/features
- Knowledge any contributor (human or AI) should know
- Prevents recurring mistakes
- Documents project-specific conventions

### Promotion Targets

| Target | What Belongs There |
|--------|-------------------|
| `CLAUDE.md` | Project facts, conventions, gotchas for all Claude interactions |
| `AGENTS.md` | Agent-specific workflows, tool usage patterns, automation rules |
| `.github/copilot-instructions.md` | Project context and conventions for GitHub Copilot |
| `SOUL.md` | Behavioral guidelines, communication style, principles (OpenClaw workspace) |
| `TOOLS.md` | Tool capabilities, usage patterns, integration gotchas (OpenClaw workspace) |

### How to Promote

1. **Distill** the learning into a concise rule or fact
2. **Add** to appropriate section in target file (create file if needed)
3. **Leave** the lessons.md line in place; it ages out under the memory maintenance policy

### Promotion Examples

**Lesson**:
> [error] `npm install` fails in pnpm workspaces; check for pnpm-lock.yaml and use `pnpm install` (2025-01-15)

**In CLAUDE.md** (concise):
```markdown
## Build & Dependencies
- Package manager: pnpm (not npm) - use `pnpm install`
```

**Lesson**:
> [pattern] Regenerate the API client with `pnpm run generate:api` after changing an endpoint (2025-01-16)

**In AGENTS.md** (actionable):
```markdown
## After API Changes
1. Regenerate client: `pnpm run generate:api`
2. Check for type errors: `pnpm tsc --noEmit`
```

## Recurring Pattern Detection

If logging something similar to an existing entry:

1. **Search first**: `grep -i "keyword" .learnings/lessons.md`
2. **Sharpen** the existing line instead of adding a near-duplicate
3. **Consider systemic fix**: Recurring issues often indicate:
   - Missing documentation (promote to CLAUDE.md or .github/copilot-instructions.md)
   - Missing automation (add to AGENTS.md)
   - Architectural problem (create tech debt ticket)

## Periodic Review

Review `.learnings/lessons.md` at natural breakpoints:

### When to Review
- Before starting a new major task
- After completing a feature
- When working in an area with past learnings
- Weekly during active development

### Quick Status Check
```bash
# Count lessons per tag
grep -o '^\[[a-z]*\]' .learnings/lessons.md | sort | uniq -c

# Recent corrections
grep '^\[correction\]' .learnings/lessons.md | tail -10

# Lessons about a topic
grep -i "docker" .learnings/lessons.md
```

### Review Actions
- Promote applicable learnings
- Merge near-duplicates into one sharper line
- Escalate recurring issues

## Detection Triggers

Automatically log when you notice:

**Corrections** (`[correction]`):
- "No, that's not right..."
- "Actually, it should be..."
- "You're wrong about..."
- "That's outdated..."
- User provides information you didn't know
- Documentation you referenced is outdated
- API behavior differs from your understanding

**Missing capabilities** (`[workflow]`):
- "Can you also..."
- "I wish you could..."
- "Is there a way to..."
- "Why can't you..."

**Errors** (`[error]`):
- Command returns non-zero exit code
- Exception or stack trace
- Unexpected output or behavior
- Timeout or connection failure

## Best Practices

1. **Log immediately** - context is freshest right after the issue
2. **Be specific** - future agents need to understand quickly
3. **Name the command or file** - makes fixes easier
4. **Say what to do instead** - not just "investigate"
5. **Use the right tag** - it decides whether the lesson is shared
6. **Promote aggressively** - if in doubt, add to CLAUDE.md or .github/copilot-instructions.md
7. **Review regularly** - stale learnings lose value

## Hook Integration

Enable automatic reminders through agent hooks. This is **opt-in** - you must explicitly configure hooks.

### Quick Setup (Claude Code / Codex)

Create `.claude/settings.json` in the workspace root (`~/.openclaw/workspace`):

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "bash ./skills/self-improving-agent/scripts/activator.sh"
      }]
    }]
  }
}
```

This injects a learning evaluation reminder after each prompt (~50-100 tokens overhead).

### Full Setup (With Error Detection)

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "bash ./skills/self-improving-agent/scripts/activator.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "bash ./skills/self-improving-agent/scripts/error-detector.sh"
      }]
    }]
  }
}
```

### Available Hook Scripts

| Script | Hook Type | Purpose |
|--------|-----------|---------|
| `scripts/activator.sh` | UserPromptSubmit | Reminds to evaluate learnings after tasks |
| `scripts/error-detector.sh` | PostToolUse (Bash) | Reads the hook JSON on stdin and answers with `additionalContext` on command errors (needs `jq`) |

See `references/hooks-setup.md` for detailed configuration and troubleshooting.

## Automatic Skill Extraction

When a learning is valuable enough to become a reusable skill, extract it using the provided helper.

### Skill Extraction Criteria

A learning qualifies for skill extraction when ANY of these apply:

| Criterion | Description |
|-----------|-------------|
| **Recurring** | The same lesson keeps coming back |
| **Verified** | The fix it describes is known to work |
| **Non-obvious** | Required actual debugging/investigation to discover |
| **Broadly applicable** | Not project-specific; useful across codebases |
| **User-flagged** | User says "save this as a skill" or similar |

### Extraction Workflow

1. **Identify candidate**: Learning meets extraction criteria
2. **Run helper** (or create manually):
   ```bash
   bash ./skills/self-improving-agent/scripts/extract-skill.sh skill-name --dry-run
   bash ./skills/self-improving-agent/scripts/extract-skill.sh skill-name
   ```
3. **Customize SKILL.md**: Fill in template with learning content
4. **Verify**: Read skill in fresh session to ensure it's self-contained

### Manual Extraction

If you prefer manual creation:

1. Create `skills/<skill-name>/SKILL.md`
2. Use template from `assets/SKILL-TEMPLATE.md`
3. Follow [Agent Skills spec](https://agentskills.io/specification):
   - YAML frontmatter with `name` and `description`
   - Name must match folder name
   - No README.md inside skill folder

### Extraction Detection Triggers

Watch for these signals that a learning should become a skill:

**In conversation:**
- "Save this as a skill"
- "I keep running into this"
- "This would be useful for other projects"
- "Remember this pattern"

**In lessons.md:**
- Several lines about the same issue (recurring)
- A `[pattern]` line with broad applicability
- User feedback praising the solution

### Skill Quality Gates

Before extraction, verify:

- [ ] Solution is tested and working
- [ ] Description is clear without original context
- [ ] Code examples are self-contained
- [ ] No project-specific hardcoded values
- [ ] Follows skill naming conventions (lowercase, hyphens)

## Multi-Agent Support

This skill works across different AI coding agents with agent-specific activation.

### Claude Code

**Activation**: Hooks (UserPromptSubmit, PostToolUse)
**Setup**: `.claude/settings.json` with hook configuration
**Detection**: Automatic via hook scripts

### Codex CLI

**Activation**: Hooks (same pattern as Claude Code)
**Setup**: `.codex/settings.json` with hook configuration
**Detection**: Automatic via hook scripts

### GitHub Copilot

**Activation**: Manual (no hook support)
**Setup**: Add to `.github/copilot-instructions.md`:

```markdown
## Self-Improvement

After solving non-obvious issues, consider appending one line to `.learnings/lessons.md`:
`[tag] Lesson text (YYYY-MM-DD)`, tag one of correction, pattern, error, preference, workflow.
Promote high-value learnings to skills.

Ask in chat: "Should I log this as a learning?"
```

**Detection**: Manual review at session end

### OpenClaw

**Activation**: Workspace injection + inter-agent messaging
**Setup**: See "OpenClaw Setup" section in SKILL.md
**Detection**: Via session tools and workspace files

### Agent-Agnostic Guidance

Regardless of agent, apply self-improvement when you:

1. **Discover something non-obvious** - solution wasn't immediate
2. **Correct yourself** - initial approach was wrong
3. **Learn project conventions** - discovered undocumented patterns
4. **Hit unexpected errors** - especially if diagnosis was difficult
5. **Find better approaches** - improved on your original solution

### Copilot Chat Integration

For Copilot users, add this to your prompts when relevant:

> After completing this task, evaluate if any learnings should be appended to `.learnings/lessons.md`.

Or use quick prompts:
- "Log this to learnings"
- "Create a skill from this solution"
- "Check .learnings/lessons.md for related issues"
