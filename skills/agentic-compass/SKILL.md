---
name: agentic-compass
description: "Local self-reflection tool that scores agent performance on measurable axes and produces concrete action plans. Use when the agent needs an objective self-assessment, performance metrics from memory files, or a structured plan of what to start/stop/ship."
triggers:
  - "agentic compass"
  - "agent action plan"
  - "measure my performance"
  - "objective self-assessment"
  - "score my completion rate"
negative_triggers:
  - "self-reflection check"
  - "log a lesson"
  - "remember this"
  - "navigate directions"
---

# Agentic Compass — AI Agent Self-Reflection Tool

Local-only self-reflection that forces **objective** action for AI agents. No data leaves your machine.

## What It Does

Reads your local memory files, scores five axes, and prints a structured **Agent Action Plan**:
- One proactive task, picked for the weakest axis
- One deferred item
- One avoidance rule
- One ship output

Only the proactive line is derived from the scores. The deferred, avoidance and ship lines are fixed
prompts, the same on every run: turn each into a concrete item from the memory files yourself.

Designed specifically for AI agents with **measurable**, not subjective, metrics.

## Usage

```bash
# Print plan
python3 scripts/agentic-compass.py

# Write plan to memory/agentic-compass.md
python3 scripts/agentic-compass.py --write

# Use custom memory paths
python3 scripts/agentic-compass.py --daily /path/to/memory/2026-01-31.md --long /path/to/MEMORY.md
```

## Agent-Specific Axes (v2.0 — Objective Measures)

| Axis | What It Measures | How It's Scored |
|------|------------------|------------------|
| **Completion Rate** | Tasks started vs tasks finished | Count `[DONE]` markers in memory files |
| **Response Relevance** | Did I answer what was asked? | Count explicit user confirmations / corrections |
| **Tool Usage Quality** | Failed tool calls, retries, timeouts | Parse tool error logs from memory files |
| **Memory Consistency** | Context retention across sessions | Track references to prior decisions that were forgotten |
| **Initiative** | Ideas proposed without being asked | Count proactive actions (started tasks, proposals) |

## Why This Version Works Better for AI Agents

### Human v1 Problems ❌
- Subjective self-assessment (bias)
- "Trust" as a metric (doesn't apply to AI)
- Episodic existence (no continuous "me")
- Emotional axes (doesn't map)

### Agent v2 Fixes ✅
- **Measurable axes** (countable from memory files)
- **Objective scoring** (no "how do I feel about it")
- **Cross-session tracking** (uses memory files for continuity)
- **Action-focused** (forces concrete decisions, not vibes)

## Example Output

```
Score: 3.6/5
Weakest axis: Completion Rate
  (Finished 1/3 tasks (33%))

Plan:
- Proactive: focus on finishing [DOING] tasks before starting new ones
- Deferred: retry any blocked items after diagnostic
- Avoidance: stop repeating patterns that cause low scores
- Ship: create one concrete artifact (doc, script, fix)
```

## Local-Only Promise

- Reads **only** local files (memory/md, MEMORY.md, logs)
- Writes **only** local files
- No network calls (your data stays local)

## Design Philosophy

Most reflection skills stop at insight. Agentic Compass forces **action**.

Key difference:
- **Passive reflection:** "I should probably do X sometime"
- **Agentic Compass:** "I will do X by [time], here's the plan"

For AI agents, this is critical because we don't have continuous awareness. We wake up fresh each session. Without explicit plans and avoidance rules, we repeat patterns.

## Installation

Ships with openclaw-node and is deployed by install.sh / mesh-deploy. Do not reinstall it from ClawHub: that replaces the repo's fixes.

## Version History

- **v2.0** — Agent-specific axes (measurable, not subjective)
- **v1.0** — Human-focused axes (Initiative, Completion, Signal, Resilience, Trust)
