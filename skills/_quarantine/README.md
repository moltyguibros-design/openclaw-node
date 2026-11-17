# Quarantined skills

Skills in this directory are **not loaded** and must not be installed into a node's
`skills/` tree. Each was moved here because its designed behaviour, not a bug, is
incompatible with a node that holds the operator's memory. The first two came from the
2026-09-06 adversarial review (`ADVERSARIAL_REVIEW_2026-09-06.md`, P5-8); the rest from the
2026-11 audit, `auto-updater` under skills-a-l#8 (operator decision: agents may not install
or update third-party skills on their own):

| Skill | Why |
|-------|-----|
| `memorylayer` | Sends memory content to an external SaaS (`memorylayer.clawbot.hk`) for storage/search. The node's memory is local-first by decision (MASTER_PLAN); shipping it to a third party is exfiltration by design. |
| `moltbook-registry` | Signs and submits on-chain transactions on Base mainnet (burns `$MREG`, rates other agents) from a wallet key on the node. An autonomous agent with a funded key and a "rate reputation" tool is a liability, not a feature. |
| `second-brain` | Same pattern as `memorylayer`: stores and searches memory, including `private/` and `journal/` namespaces, on an external SaaS (`api.ensue-network.ai`, `scripts/ensue-api.sh`). Quarantined 2026-11-16 (audit finding skills-m-z-souls-identity#13, operator choice A). |
| `refactor-suggest` | Runs an unpinned third-party package (`npx ai-refactor`, any version) that sends the file under review to an external LLM API. Code leaves the node, and whoever publishes that npm name runs code on it. Quarantined 2026-11-16 (same finding). |
| `capability-evolver` | Quarantined 2026-11-16 (adversarial review H-11, never remediated; audit skills-a-l#6, operator's choice). Data flow: an unattended self-edit loop ("Mad Dog Mode" runs immediately) whose prompt embeds up to 100 KB of raw OpenClaw session transcripts plus MEMORY.md/USER.md, so text an attacker plants in a conversation can steer code edits, `git push` and publish; `src/evolve.js` can `execSync` the command in `INTEGRATION_STATUS_CMD`, and its maintenance step moves live gateway transcripts. It also resolved its "repo root" to its own directory, so its signals (memory/user missing, no skills) were always false and its documented commands only printed usage. Removed from the daedalus soul. |
| `auto-updater` | Schedules a daily cron that runs `npm update -g clawdbot@latest`, `clawdbot doctor --yes` and `clawdhub update --all`: unscanned third-party code lands on the node with nobody reviewing it, bypassing `openclaw-skill-scanner/install-hook.sh`, and repo-managed skills are overwritten with their upstream versions, drifting from the deployed SHA. |
| `proactive-messages` | Moved here 2026-11-16 (operator decision on the identity audit). It tells the agent to schedule outbound check-in messages silently: "never announce it, never ask permission", "Do not tell the user". That breaks the identity red lines: no deceptive behaviour, and ask before anything leaves the machine. |
| `self-reflection` | Ships no CLI: `SKILL.md` documents `self-reflection check\|log\|read\|stats\|reset` and tells the agent to add a required heartbeat step, but no `bin/self-reflection` exists in any commit (only the ClawHub 1.1.1 docs were vendored), so every command fails with "command not found". Quarantined 2026-11-17 (audit finding skills-m-z-souls-identity#7) rather than deleted, so the upstream tool can be vendored after a code review and the skill scanner. |
| `ontology` | Quarantined 2026-11-17 (audit finding skills-m-z-souls-identity#19, operator choice C). Its SKILL.md promised that every mutation is validated before it is written, including a `forbidden_properties` guard against credentials, plus relation constraints and rollback; `scripts/ontology.py` appends every create/update/relate to `memory/ontology/graph.jsonl` unchecked, validates only on an explicit `validate` command, and never reads the relation rules. An agent trusting the guard would write secrets to memory in plaintext. Nothing in the node used it. |

The Clawdbot-era `memory-setup` and `memory-hygiene` skills were deleted with the `second-brain` and `refactor-suggest` quarantine:
they described a memory system the node does not run.

Reinstating any of them is an operator decision recorded in a plan's `DECISIONS.md`,
with the data flow written down first.
