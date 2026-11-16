# Quarantined skills

Skills in this directory are **not loaded** and must not be installed into a node's
`skills/` tree. They were moved here on 2026-09-06 by the adversarial review
(`ADVERSARIAL_REVIEW_2026-09-06.md`, P5-8) because their designed behaviour, not a
bug, is incompatible with a node that holds the operator's memory:

| Skill | Why |
|-------|-----|
| `memorylayer` | Sends memory content to an external SaaS (`memorylayer.clawbot.hk`) for storage/search. The node's memory is local-first by decision (MASTER_PLAN); shipping it to a third party is exfiltration by design. |
| `moltbook-registry` | Signs and submits on-chain transactions on Base mainnet (burns `$MREG`, rates other agents) from a wallet key on the node. An autonomous agent with a funded key and a "rate reputation" tool is a liability, not a feature. |
| `second-brain` | Same pattern as `memorylayer`: stores and searches memory, including `private/` and `journal/` namespaces, on an external SaaS (`api.ensue-network.ai`, `scripts/ensue-api.sh`). Quarantined 2026-11-16 (audit finding skills-m-z-souls-identity#13, operator choice A). |
| `refactor-suggest` | Runs an unpinned third-party package (`npx ai-refactor`, any version) that sends the file under review to an external LLM API. Code leaves the node, and whoever publishes that npm name runs code on it. Quarantined 2026-11-16 (same finding). |
| `capability-evolver` | Quarantined 2026-11-16 (adversarial review H-11, never remediated): an unattended self-edit loop ("Mad Dog Mode" runs immediately) whose prompt embeds up to 100 KB of raw session transcript plus MEMORY/USER, so text an attacker plants in a conversation can steer code edits, `git push` and publish; `src/evolve.js` also runs `INTEGRATION_STATUS_CMD` through a shell. Removed from the daedalus soul. |

The Clawdbot-era `memory-setup` and `memory-hygiene` skills were deleted with the `second-brain` and `refactor-suggest` quarantine:
they described a memory system the node does not run.

Reinstating any of them is an operator decision recorded in a plan's `DECISIONS.md`,
with the data flow written down first.
