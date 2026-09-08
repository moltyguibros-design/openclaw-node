# SCOPE — integrations plan

**Status:** idle
**Status note:** no step in flight. Blocks 1 and 2's runnable rows are closed (2.1–2.2 need the operator's macOS box). The next fully-runnable work is Block 5.2 (agent-state detector) or Block 6.1 (tool calling); Block 3 and 4 open with operator installs. Set the next goal with the operator before editing.
**Set at:** 2026-09-08
**Expires:** 2026-09-15T23:59:00Z

```files block0 closed
memory-plan/plans/integrations/ROADMAP.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/TICK_PROMPT.md
memory-plan/plans/integrations/automation.json
```

```files step11 closed
workspace-bin/web-fetch.mjs
package.json
package-lock.json
config/harness-rules.json
test/web-fetch-markdown.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step11_web_fetch_markdown/*
```

```files step12 closed
workspace-bin/web-fetch.mjs
test/web-fetch-guard.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/DECISIONS.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step12_web_fetch_pinning/*
```

```files step13 closed
config/harness-rules.json
bin/check-added-deps.sh
test/harness-lazy-senior.test.mjs
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step13_lazy_senior_ladder/*
```

```files step14 closed
skills/ponytail-review/*
workspace-bin/multi-review
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step14_ponytail_review/*
```

```files step15 closed
skills/debugging-and-error-recovery/*
skills/incremental-implementation/*
skills/doubt-driven-development/*
skills/interview-me/*
skills/deprecation-and-migration/*
skills/code-review-and-quality/*
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step15_agent_skills_ports/*
```

```files step16 closed
skills/summarize/SKILL.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/BLOCKED.md
memory-plan/plans/integrations/audits/step16_summarize_ytdlp/*
```

```files step23 closed
skills/archify/**
openclaw.env.example
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step23_archify_skill/*
```

```files step24 closed
docs/diagrams/**
docs/ARCHITECTURE.md
memory-plan/plans/integrations/INVENTORY.md
memory-plan/plans/integrations/COMPONENT_REGISTRY.md
memory-plan/plans/integrations/VERSION
memory-plan/plans/integrations/audits/step24_architecture_diagrams/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Batch lifecycle:** label each batch's block (` ```files <label> `) and, when the batch
  ships, append the word `closed` to the fence (` ```files <label> closed `) — the hook prunes
  closed blocks, so finished work re-locks while the record stays. One open block per
  in-flight batch.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
