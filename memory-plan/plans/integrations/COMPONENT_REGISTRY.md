# COMPONENT_REGISTRY — integrations plan

Current state of every component this plan touches. **Reality, not aspiration** — record only
what a runtime probe (ps / curl / sql / log / launchctl) verified, and date it. Updated at every
step close (PROTOCOL §3 Phase 9) and re-verified wholesale at every macro re-orient (§5.2).
Claims older than 14 days decay (MASTER_PLAN §4.9): re-probe before acting on them.

**Format is load-bearing:** the viewer's Master Plan tab parses `## Family N: <name>` sections
containing `### <component>` headings with a `| **Status** | <value> |` row — flat tables render
empty (PROTOCOL §10).

Probe context for the 2026-09-08 rows: a cloud session on the repo tree at commit `29847ac`
(branch `claude/hermes-essential-skills-ch3s0o`), Node v22.22.2. No `~/.openclaw` runtime exists
in that session, so runtime rows for launchd units, VoiceStudio, Orca and God's Eye View are
recorded as UNKNOWN until the operator probes the design box; repo-tree rows are verified.

## Family 1: Web reach

### workspace-bin/web-fetch.mjs

| | |
|---|---|
| **Status** | LIVE — `--markdown` readability path |
| **Verified** | 2026-09-08 (step 1.1) — `node workspace-bin/web-fetch.mjs https://pypi.org/project/requests/ --markdown` exit 0, header `# requests` + `words: 378 (defuddle 194ms)`, nav labels absent that the raw fetch carries; bundle delivered by `addInitScript` before navigation; `chromiumBypassList()` strips CIDR entries from NO_PROXY; `WEB_FETCH_CHROMIUM` overrides the browser path. Step 1.2: `resolvePublicUrl` returns the vetted addresses and the document host is pinned with `--host-resolver-rules`; private literals refused with exit 2; the pin proven to bind (MAP to 192.0.2.1 → ERR_CONNECTION_REFUSED, unpinned → 200). Sub-requests remain check-time only |

### defuddle dependency

| | |
|---|---|
| **Status** | LIVE — ^0.19.3 |
| **Verified** | 2026-09-08 (step 1.1) — in package.json + package-lock.json; resolved at run time through the `defuddle/full` export; exercised in-page against a served fixture and against a live public page |

## Family 2: Harness rules and skills

### config/harness-rules.json

| | |
|---|---|
| **Status** | LIVE — 14 rules |
| **Verified** | 2026-09-08 — ids: build-before-done, no-silent-failure, no-assume-running, session-boot-context, git-conventional-commits, no-hardcoded-secrets, playwright-fallback, scope-enforcement, block-sudo-in-scripts, block-rm-rf, hyperagent-task-close, hyperagent-task-start, hyperagent-reflection-ready. 2026-09-08 (step 1.3): `lazy-senior-ladder` added (tier 2, local+mesh, `post_validate` → `bash ./bin/check-added-deps.sh`); injection and the advisory both proven against a real worktree. Mesh workers read the deployed `~/.openclaw/harness-rules.json`, so the rule is inert there until `harness-sync` runs. `git-conventional-commits` is blocked by exec-safety on every commit (OUT_OF_SCOPE) |

### skills/ tree

| | |
|---|---|
| **Status** | LIVE — 115 skills |
| **Verified** | 2026-09-08 — `ls skills | wc -l` → 108; `skills/_quarantine/` holds memorylayer and moltbook-registry. 2026-09-08 (step 1.4): `ponytail-review` added (audit 100/100 grade A, scanner clean, routing 100.0% with no new collision) and wired as `multi-review`'s fourth perspective. 2026-09-08 (step 1.5): the six agent-skills ports added — debugging-and-error-recovery, incremental-implementation, interview-me, doubt-driven-development, deprecation-and-migration, code-review-and-quality (audit five A one B, scanner clean, routing 100.0% with zero regressed). Still absent: archify, codebase-memory, gods-eye-view |

## Family 3: MCP servers

### .mcp.json

| | |
|---|---|
| **Status** | LIVE — one server |
| **Verified** | 2026-09-08 — `mcpServers` keys → `['knowledge']` (node `lib/mcp-knowledge/server.mjs`); no `codebase-memory`; `.gitignore` has no `.codebase-memory/` line |

### codebase-memory-mcp binary

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — not present under the repo or the session; upstream v0.10.8 release read in source (stdio only, no runtime network, C11) |

## Family 4: Mission Control TTS

### mission-control/src/lib/tts

| | |
|---|---|
| **Status** | LIVE — cloud only |
| **Verified** | 2026-09-08 — `ls mission-control/src/lib/tts/` → edge.ts google.ts index.ts types.ts; `synthesizeWithFallback` default preferred `"google"`; route whitelists `edge` and `google` only |

### VoiceStudio (external, :3900)

| | |
|---|---|
| **Status** | UNKNOWN |
| **Verified** | 2026-09-08 — not probeable from the cloud session; operator to run `curl -s 127.0.0.1:3900/health` on the design box before step 3.1 |

## Family 5: Stack launcher

### bin/openclaw-stack.mjs

| | |
|---|---|
| **Status** | LIVE — five ports |
| **Verified** | 2026-09-08 — PORTS map lines 33–37: nats 4222, mission-control 3000, workplan-viewer 7892, memory-daemon 7893, companion-bridge 8787; only companion-bridge has an external-app row; no voicestudio or gods-eye-view rows |

## Family 6: God's Eye View (external, :4173)

### gods-eye-view checkout and Node 24 runtime

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — no clone under `~/Documents/openclaw infrastructure/` is known; upstream `package.json` engines `>=24.14.0 <25 \|\| >=26 <27`; session Node is v22.22.2 (node baseline); default server `localhost:4173`; keyless Esri/OSM fallback confirmed in `src/mapStackController.js` |

### docs/runbooks/

| | |
|---|---|
| **Status** | UNBUILT |
| **Verified** | 2026-09-08 — `ls docs/runbooks` → no such directory |

## Family 7: Mesh agent state

### bin/mesh-agent.js worktree and heartbeat

| | |
|---|---|
| **Status** | LIVE — no agent-state signal |
| **Verified** | 2026-09-08 — `createWorktree` at `~/.openclaw/worktrees/<taskId>` on `mesh/<taskId>` (lines 489–540); cleanup deletes the branch unconditionally; no hook listener, no `activity_state` in the heartbeat; `lib/agent-status.js` absent |

## Family 8: Local LLM client

### lib/llm-client.mjs

| | |
|---|---|
| **Status** | LIVE — no tool calling |
| **Verified** | 2026-09-08 — `grep -c tools lib/llm-client.mjs` → 0; native `/api/chat` with `think:false`, no `tools` or `tool_calls` handling |
