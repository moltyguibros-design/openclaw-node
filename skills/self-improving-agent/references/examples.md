# Entry Examples

Concrete examples of well-formed lines in `.learnings/lessons.md`. Each lesson is one line:
`[tag] Lesson text (YYYY-MM-DD)`, with tag one of correction, pattern, error, preference, workflow.

## Correction

The user corrected an assumption:

```markdown
[correction] DB fixtures in tests/conftest.py are module-scoped by convention; check existing fixture scopes before defaulting to function scope (2025-01-15)
```

## Correction: Knowledge Gap

Your knowledge was wrong or outdated:

```markdown
[correction] This project uses pnpm workspaces (pnpm-lock.yaml), not npm; run `pnpm install` (2025-01-15)
```

Once promoted, CLAUDE.md carries the rule and the line stays until it ages out.

## Pattern: Promoted to AGENTS.md

A better approach worth keeping:

```markdown
[pattern] After changing an API endpoint, regenerate the TypeScript client with `pnpm run generate:api` and run `pnpm tsc --noEmit` (2025-01-16)
```

## Error

A command failed and you found what to do instead:

```markdown
[error] `docker build` fails on Apple Silicon with "no match for platform linux/arm64"; add `--platform linux/amd64` (2025-01-15)
```

## Error: Recurring Issue

The same failure came back; sharpen the existing line rather than adding another:

```markdown
[error] payments.example.com times out after 30s at peak hours on POST /api/checkout; retry with exponential backoff (see src/services/payment.ts) (2025-01-20)
```

## Preference

How the user wants things done:

```markdown
[preference] User wants dark mode respected via prefers-color-scheme, with a manual toggle (2025-01-10)
```

## Workflow: Missing Capability

The user asked for something that does not exist yet:

```markdown
[workflow] User wants analysis results exportable as CSV; no export exists yet (2025-01-15)
```

## Extracted Skill Example

When the recurring Docker lesson above is extracted as a skill, it becomes:

**File**: `skills/docker-m1-fixes/SKILL.md`

```markdown
---
name: docker-m1-fixes
description: "Fixes Docker build failures on Apple Silicon (M1/M2). Use when docker build fails with platform mismatch errors."
---

# Docker M1 Fixes

Solutions for Docker build issues on Apple Silicon Macs.

## Quick Reference

| Error | Fix |
|-------|-----|
| `no match for platform linux/arm64` | Add `--platform linux/amd64` to build |
| Image runs but crashes | Use emulation or find ARM-compatible base |

## The Problem

Many Docker base images don't have ARM64 variants. When building on
Apple Silicon (M1/M2/M3), Docker attempts to pull ARM64 images by
default, causing platform mismatch errors.

## Solutions

### Option 1: Build Flag (Recommended)

Add platform flag to your build command:

\`\`\`bash
docker build --platform linux/amd64 -t myapp .
\`\`\`

### Option 2: Dockerfile Modification

Specify platform in the FROM instruction:

\`\`\`dockerfile
FROM --platform=linux/amd64 python:3.11-slim
\`\`\`

### Option 3: Docker Compose

Add platform to your service:

\`\`\`yaml
services:
  app:
    platform: linux/amd64
    build: .
\`\`\`

## Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Build flag | No file changes | Must remember flag |
| Dockerfile | Explicit, versioned | Affects all builds |
| Compose | Convenient for dev | Requires compose |

## Performance Note

Running AMD64 images on ARM64 uses Rosetta 2 emulation. This works
for development but may be slower. For production, find ARM-native
alternatives when possible.

## Source

- Lesson: `[error] docker build fails on Apple Silicon ... (2025-01-15)` from `.learnings/lessons.md`
- Tag: error
- Extraction Date: 2025-01-18
```
