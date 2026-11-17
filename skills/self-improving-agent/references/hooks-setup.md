# Hook Setup Guide

Configure automatic self-improvement triggers for AI coding agents.

## Overview

Hooks enable proactive learning capture by injecting reminders at key moments:
- **UserPromptSubmit**: Reminder after each prompt to evaluate learnings
- **PostToolUse (Bash)**: Error detection when commands fail

## Claude Code Setup

### Option 1: Project-Level Configuration

Create `.claude/settings.json` in your project root. The paths below assume the project root is the
OpenClaw workspace (`~/.openclaw/workspace`), where the installer puts this skill under
`skills/self-improving-agent/`. The scripts are invoked through `bash`, so they need no execute bit.
`error-detector.sh` needs `jq`.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./skills/self-improving-agent/scripts/error-detector.sh"
          }
        ]
      }
    ]
  }
}
```

### Option 2: User-Level Configuration

Add to `~/.claude/settings.json` for global activation:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.openclaw/workspace/skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

### Minimal Setup (Activator Only)

For lower overhead, use only the UserPromptSubmit hook:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

## Codex CLI Setup

Codex uses the same hook system as Claude Code. Create `.codex/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash ./skills/self-improving-agent/scripts/activator.sh"
          }
        ]
      }
    ]
  }
}
```

## GitHub Copilot Setup

Copilot doesn't support hooks directly. Instead, add guidance to `.github/copilot-instructions.md`:

```markdown
## Self-Improvement

After completing tasks that involved:
- Debugging non-obvious issues
- Discovering workarounds
- Learning project-specific patterns
- Resolving unexpected errors

Consider appending the learning to `.learnings/lessons.md` as one line: `[tag] Lesson text (YYYY-MM-DD)`,
with tag one of correction, pattern, error, preference, workflow.

For high-value learnings that would benefit other sessions, consider skill extraction.
```

## Verification

### Test Activator Hook

1. Enable the hook configuration
2. Start a new Claude Code session
3. Send any prompt
4. Verify you see `<self-improvement-reminder>` in the context (UserPromptSubmit stdout is added to it)

### Test Error Detector Hook

1. Enable PostToolUse hook for Bash
2. Run a command that fails: `ls /nonexistent/path`
3. Verify you see `<error-detected>` reminder. The detector reads the hook input JSON from stdin and
   answers with `hookSpecificOutput.additionalContext`, because plain PostToolUse stdout never reaches
   the model. Probe it by hand:
   `echo '{"tool_response":{"stdout":"","stderr":"ls: No such file or directory"}}' | bash ./skills/self-improving-agent/scripts/error-detector.sh`

### Dry Run Extract Script

```bash
bash ./skills/self-improving-agent/scripts/extract-skill.sh test-skill --dry-run
```

Expected output shows the skill scaffold that would be created.

## Troubleshooting

### Hook Not Triggering

1. **Invoke via bash**: the command must start with `bash ` so the script's file mode does not matter
2. **Verify path**: Use absolute paths or paths relative to project root
3. **Check settings location**: Project vs user-level settings
4. **Restart session**: Hooks are loaded at session start

### Script Not Found

If using relative paths, ensure you're in the correct directory or use absolute paths:

```json
{
  "command": "bash /absolute/path/to/skills/self-improving-agent/scripts/activator.sh"
}
```

### Too Much Overhead

If the activator feels intrusive:

1. **Use minimal setup**: Only UserPromptSubmit, skip PostToolUse
2. **Add matcher filter**: Only trigger for certain prompts:

```json
{
  "matcher": "fix|debug|error|issue",
  "hooks": [...]
}
```

## Hook Output Budget

The activator is designed to be lightweight:
- **Target**: ~50-100 tokens per activation
- **Content**: Structured reminder, not verbose instructions
- **Format**: XML tags for easy parsing

If you need to reduce overhead further, you can edit `activator.sh` to output less text.

## Security Considerations

- Hook scripts run with the same permissions as Claude Code
- Scripts only output text; they don't modify files or run commands
- Error detector reads the hook input JSON (`.tool_response`) from stdin
- All scripts are opt-in (you must configure them explicitly)

## Disabling Hooks

To temporarily disable without removing configuration:

1. **Comment out in settings**:
```json
{
  "hooks": {
    // "UserPromptSubmit": [...]
  }
}
```

2. **Or delete the settings file**: Hooks won't run without configuration
