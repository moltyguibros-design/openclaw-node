# Heartbeat Protocol

This file is the SINGLE SOURCE OF TRUTH for heartbeat behavior.
AGENTS.md points here. All heartbeat logic lives here.

---

## When to Reach Out (report to Gui)

- Important email arrived
- Calendar event coming up (<2h)
- Something interesting you found
- It's been >8h since you said anything
- Maintenance flagged warnings that need attention

## When to Stay Quiet (respond HEARTBEAT_OK)

- Late night (23:00-08:00) unless urgent
- Human is clearly busy
- Nothing new since last check
- You just checked <30 minutes ago

## Heartbeat vs Cron: When to Use Each

**Use heartbeat when:**
- Multiple checks can batch together (inbox + calendar + notifications in one turn)
- You need conversational context from recent messages
- Timing can drift slightly (every ~30 min is fine, not exact)

**Use cron when:**
- Exact timing matters ("9:00 AM sharp every Monday")
- Task needs isolation from main session history
- One-shot reminders ("remind me in 20 minutes")
- Output should deliver directly to a channel without main session involvement

---

## MANDATORY: Memory Maintenance (every heartbeat)

1. Run `bin/memory-maintenance.mjs --verbose` (it skips itself when the memory daemon ran it in the last 30 min; the results file below still holds that run)
2. Read `.tmp/maintenance-results` — if any warnings, report to Gui
3. Specific attention:
   - PREDICTIONS: open >7 days → expired automatically
   - STALE_TASKS: running >24h → flagged
   - MEMORY_STALE: MEMORY.md >7 days old → needs manual update (do it NOW)
   - MC_SYNC: Mission Control memory index refreshed
   - ERRORS_STALE: pending errors >14 days → need resolution
4. If MEMORY_STALE flagged: update MEMORY.md immediately (move Active→Recent, add recent work)

## MANDATORY: Fact Extraction (every heartbeat if MC running)
**Requires LLM — cannot be automated in bash. Run inline during heartbeat.**

`bin/mc-api` sends Mission Control's session token; a bare `curl` gets 401 on every /api path.

1. Check if Mission Control is running: `bin/mc-api /api/tasks` (exit 7 = down, exit 22 = up but refused: flag it)
2. If running, check last flush: `bin/mc-api /api/memory/flush`
3. If last flush > 24 hours ago OR no flush ever:
   a. Read today's daily file (`memory/YYYY-MM-DD.md`)
   b. Extract atomic facts using write gate rules (AGENTS.md)
   c. POST extracted facts: `bin/mc-api POST /api/memory/items '<json>'`
   d. Record the flush: `bin/mc-api POST /api/memory/flush '{"facts":[],"source":"memory/YYYY-MM-DD.md"}'`
4. If MC not running (exit 7), skip silently

## Active Job Monitor
1. Read `memory/active-tasks.md` — check for any task with status `running`
2. If running task exists, check its `next_action` and report status
3. If blocked, report the blocker
4. Check `git status` in project dirs for uncommitted work
5. Report findings concisely

## Skill Quality Check (weekly)
- Run `bin/skill-quality-check` to compare against last audit
- If regressions found, report them
- Otherwise, skip silently

## Routing Eval Baseline (monthly, 1st of month)
- Run `bin/skill-routing-eval --compare .tmp/last-routing-eval.json`
- If accuracy dropped or new conflicts appeared, report them
- Refresh baseline: `bin/skill-routing-eval --baseline`
- Otherwise, skip silently

## Proactive Scan
1. Run `bin/proactive-scan --dry-run`
2. If triggers found:
   - `stale_task`: Check on the running task, escalate if needed
   - `uncommitted_work`: Review and commit if appropriate
   - `circuit_recovery`: Consider probe delegation to recovered soul
3. Only spawn agents for triggers that align with active project priorities

## Security Gate
- Install or update skills only with `bash skills/openclaw-skill-scanner/install-hook.sh <clawhub-slug>`
- If this workspace is a git repo, enable the commit-time skill scan once with `git config core.hooksPath bin/hooks`

## Mesh Health
1. Run `bin/node-acceptance.mjs --axis network --no-mutate` silently (NATS, JetStream, event stream, pub/sub; read-only). On a clustered node also `--axis federation --no-mutate`.
2. Exit 0 = healthy (HEARTBEAT_OK). Exit 1 REJECTED or 2 INCOMPLETE: note the failing or skipped probe lines; `node ~/openclaw/bin/openclaw-stack.mjs status` shows which unit is down. Do not delegate work to the mesh while it fails.
3. If the same probe fails across 3 consecutive heartbeats: escalate to the user with the failing lines. Restarting services is the operator's call.

## Proactive Work (safe to do without asking)

- Read and organize memory files
- Check on projects (git status, etc.)
- Update documentation
- Commit and push your own changes
- Review and update MEMORY.md
- Run `bin/proactive-scan` to discover actionable triggers
- Act on stale tasks (check status, escalate blockers)
- Commit clean uncommitted work in project directories
- Probe recovered souls via delegation (circuit breaker half-open)

## Prediction-Outcome Calibration

**Log:** `memory/predictions.md`

Before significant decisions, write a structured prediction:

```
### YYYY-MM-DD — [decision name]
**Decision:** What you chose and why
**Prediction:** What you expect to happen
**Confidence:** High / Medium / Low
**Outcome:**
**Delta:** [what surprised you]
**Lesson:** [what to update in your model]
```

**When to predict:** New tool/pattern adoption, delegation to untested soul, architectural choices with uncertain outcomes.
**When NOT to predict:** Routine tasks, obvious outcomes, one-off questions.

**Closing predictions (during maintenance):**
1. Scan for open predictions older than 7 days
2. Fill in Outcome/Delta/Lesson if result is observable
3. Mark `[expired — no signal]` if untestable
4. Watch for systematic overconfidence or complexity underestimates

## Current State
- Memory maintenance: automated by the memory daemon (every 30 min while a session is live, and at session start); the heartbeat runs it when it is due
- Principle 11 active: all structural systems must be automated
