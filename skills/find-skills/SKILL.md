---
name: find-skills
description: "Search the open agent-skills ecosystem and present matching skills. Never installs or updates a skill itself: installs go only through the openclaw-skill-scanner gate. Use when the user asks how to do something that might exist as a skill, wants to search for tools/workflows, or wants to extend agent capabilities."
triggers:
  - "find a skill for"
  - "is there a skill that can"
  - "search for skills"
  - "install a skill"
  - "what skills are available"
negative_triggers:
  - "list my installed skills"
  - "create a new skill from scratch"
  - "uninstall a skill"
---

# Find Skills

This skill helps you discover skills from the open agent skills ecosystem and present them to
the user. It does not install or update anything: a third-party skill is unreviewed code, and the
only install path on this node is the scanner gate (see "If the User Wants to Install").

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

## What is the Skills CLI?

The Skills CLI (`npx skills`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**The one command this skill uses:**

- `npx skills find [query]` - Search for skills by keyword

Do not run the CLI's install or update commands: they write unscanned code straight into the
skills tree and can overwrite the repo-managed skills.

**Browse skills at:** https://skills.sh/

## How to Help Users Find Skills

### Step 1: Understand What They Need

When a user asks for help with something, identify:

1. The domain (e.g., React, testing, design, deployment)
2. The specific task (e.g., writing tests, creating animations, reviewing PRs)
3. Whether this is a common enough task that a skill likely exists

### Step 2: Search for Skills

Run the find command with a relevant query:

```bash
npx skills find [query]
```

For example:

- User asks "how do I make my React app faster?" → `npx skills find react performance`
- User asks "can you help me with PR reviews?" → `npx skills find pr review`
- User asks "I need to create a changelog" → `npx skills find changelog`

The command will return results like:

```
vercel-labs/agent-skills@vercel-react-best-practices
└ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

### Step 3: Present Options to the User

When you find relevant skills, present them to the user with:

1. The skill name and what it does
2. A link to learn more at skills.sh

Example response:

```
I found a skill that might help! The "vercel-react-best-practices" skill provides
React and Next.js performance optimization guidelines from Vercel Engineering.

Learn more: https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
```

Stop there. Searching and presenting is the whole job of this skill.

### If the User Wants to Install

Installing is the user's decision, and it goes only through the scanner gate, which downloads
the skill to a temp directory, scans it, blocks blacklisted or dangerous skills and asks before
installing one with warnings:

```bash
bash skills/openclaw-skill-scanner/install-hook.sh <clawhub-slug>
```

- Run it only when the user explicitly asks for that slug, and leave its confirmation prompt to
  the user. Never pass `--force`.
- The gate installs ClawHub slugs. A skills.sh package that is not on ClawHub has no scanned
  install path on this node: say so and stop.
- Never update installed skills in bulk: many of them carry local fixes that an update would
  overwrite.

## Common Skill Categories

When searching, consider these common categories:

| Category        | Example Queries                          |
| --------------- | ---------------------------------------- |
| Web Development | react, nextjs, typescript, css, tailwind |
| Testing         | testing, jest, playwright, e2e           |
| DevOps          | deploy, docker, kubernetes, ci-cd        |
| Documentation   | docs, readme, changelog, api-docs        |
| Code Quality    | review, lint, refactor, best-practices   |
| Design          | ui, ux, design-system, accessibility     |
| Productivity    | workflow, automation, git                |

## Tips for Effective Searches

1. **Use specific keywords**: "react testing" is better than just "testing"
2. **Try alternative terms**: If "deploy" doesn't work, try "deployment" or "ci-cd"
3. **Check popular sources**: Many skills come from `vercel-labs/agent-skills` or `ComposioHQ/awesome-claude-skills`

## When No Skills Are Found

If no relevant skills exist:

1. Acknowledge that no existing skill was found
2. Offer to help with the task directly using your general capabilities
3. Suggest the user could create their own skill with `npx skills init`

Example:

```
I searched for skills related to "xyz" but didn't find any matches.
I can still help you with this task directly! Would you like me to proceed?

If this is something you do often, you could create your own skill:
npx skills init my-xyz-skill
```
