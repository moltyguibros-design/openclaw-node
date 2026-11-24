#!/bin/bash
# Self-Improvement Error Detector Hook
# Triggers on PostToolUse for Bash to detect command failures.
# Claude Code passes the hook input as JSON on stdin, and PostToolUse stdout on
# exit 0 never reaches the model, so the reminder goes out as additionalContext.

set -e

OUTPUT="$(jq -r '[.tool_response | .. | strings] | join("\n")')"

ERROR_PATTERNS=(
    "error:"
    "Error:"
    "ERROR:"
    "failed"
    "FAILED"
    "command not found"
    "No such file"
    "Permission denied"
    "fatal:"
    "Exception"
    "Traceback"
    "npm ERR!"
    "ModuleNotFoundError"
    "SyntaxError"
    "TypeError"
    "exit code"
    "non-zero"
)

contains_error=false
for pattern in "${ERROR_PATTERNS[@]}"; do
    if [[ "$OUTPUT" == *"$pattern"* ]]; then
        contains_error=true
        break
    fi
done

if [ "$contains_error" = true ]; then
    REMINDER='<error-detected>
A command error was detected. Consider appending one line to .learnings/lessons.md if:
- The error was unexpected or non-obvious
- It required investigation to resolve
- It might recur in similar contexts
- The solution could benefit future sessions

Format: [error] What failed and what to do instead (YYYY-MM-DD)
</error-detected>'
    jq -n --arg ctx "$REMINDER" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
fi
