# Node Watch Spec — the elements to watch, and how

**Status:** LOCKED list (2026-06-15; the HyperAgent and Federation rows were added later to match
`lib/node-watch.mjs`), watcher BUILT (2026-06-15). `bin/node-watch.mjs` + `lib/node-watch.mjs`
report the real per-element status; 12 mocked tests green. **Not yet run against a live node** — the
operator runs it on the deployment to get real status. Reuses `lib/health-check.mjs` + the read-only
`node-acceptance` probes (no parallel implementation, MASTER_PLAN §4.6).

This is the single source of truth for *what the node watches to know it works*. Companion to
`docs/NODE_ACCEPTANCE.md` (the one-shot deploy gate); both consume the same probes. Watch observes
the node continuously and writes only its own reports and private ingest-lag ledger.

---

## Verdict model (the honesty invariant)

Every element resolves to exactly one of:

| Verdict | Meaning |
|---|---|
| **WORKING** | a probe **observed** the working signal. |
| **BROKEN** | a probe observed a failure (should be working, isn't). |
| **OFF** | intentionally not active on this node (not configured / not deployed / on-demand). |
| **UNKNOWN** | could not observe — no probe yet, probe errored, or a dependency for the probe is absent. |

**The rule that fixes the lie:** nothing is ever WORKING without an observation. A target with no
implemented probe returns **UNKNOWN, never green**. Staleness of a daemon-guaranteed signal (e.g. graph
cache refresh) is **BROKEN**; absence of activity for an activity-driven signal (e.g. no recent sessions)
is **not** BROKEN. Watch mode does not change the systems it observes; it writes its own reports
and a private `~/.openclaw/.node-watch-ingest.sqlite` ledger to time import stalls across restarts.
Pending transcript sessions stay UNKNOWN for their first two hours without archive progress,
even when a copied transcript contains old timestamps. Archive inconsistency is BROKEN immediately.
If a restore leaves a transcript and its archive consistently caught up at a smaller count,
the prior ingest-lag clock clears.
An interrupted SQLite write can leave a hot ledger journal; the read-only recovery inventory
refuses it until a writer recovers the journal, and losing this derived ledger restarts the two-hour clock.
Heavy probes (LLM
generate/embed/extract) run one-shot or with `--deep`; in the continuous loop they report
UNKNOWN("not probed this cycle"), never a stale WORKING.

---

## Running it

```bash
node bin/node-watch.mjs            # one-shot, ALL probes incl. heavy; exit 1 if any BROKEN
npm run node-watch                 # same
openclaw-node-watch                # same, after npm i -g / link (bin entry)
node bin/node-watch.mjs --watch                  # continuous, every 60s, heavy probes skipped
node bin/node-watch.mjs --watch --interval 30 --deep
node bin/node-watch.mjs --json --report ~/.openclaw/.node-watch.md
```

Portable: every path/URL/port resolves from the node's own env (`OPENCLAW_HOME`, `OPENCLAW_NODE_ID`,
`LLM_MODEL`, `MEMORY_INJECT_PORT`, `NATS_MONITOR_URL`, `OBSIDIAN_VAULT_PATH`, …), L1 state.db and
workspace checks included. Writes an evidence report to `~/.openclaw/.node-watch.md` whatever
`OPENCLAW_HOME` says, because Mission Control reads it there; pass `--report` for a spawn tree.

---

## The locked watch list

`probe` column is the honest coverage today: **live** = real read-only probe implemented · **reuse** =
delegates to a `node-acceptance` probe · **applic.** = applicability gate (OFF when not configured) ·
**UNKNOWN-stub** = declared but no probe yet (reports UNKNOWN until built — does not lie).

### Memory
| Element | Watch signal | Probe |
|---|---|---|
| Memory daemon | process alive | reuse (health) |
| Session ingest | configured transcript turns match archived counts and last timestamps | live |
| LLM extraction | entities present, latest `last_seen` | live |
| Knowledge index | `.knowledge.db` `last_session_index_time` < 2h (stamped by the daemon's knowledge-index-job on every run; `last_index_time` is MCP-client driven and not graded) | live |
| Inject server :7893 | light tick: authorized `GET /health` answers (no retrieval, no events); deep sweep / one-shot: authorized POST returns block + items | live (light) / reuse (`MEM-L2-INJECT`) |
| Memory watcher | `watcher.jsonl` fresh < 30min | live |

### Obsidian (memory subsystem)
| Element | Watch signal | Probe |
|---|---|---|
| Local vault notes | newest Markdown note in a managed vault directory written < 2h | live |
| Graph cache (retrieval ch.5) | `graph-cache.db` `last_refresh_at` < 30min | live |
| Vault link integrity | no dangling wikilinks | live (wraps read-only `checkVaultLinks`; heavy → one-shot/`--deep`) |

### LLM — local
| Element | Watch signal | Probe |
|---|---|---|
| Ollama model present | `LLM_MODEL` in `/api/tags` | reuse |
| Local generation | `/api/generate` non-empty completion | reuse (heavy) |
| Embedder (BGE-M3) | 1024-dim finite vector | reuse (heavy) |
| Structured extraction | schema-valid extraction | reuse (heavy) |

### LLM — cloud
| Element | Watch signal | Probe |
|---|---|---|
| Cloud LLM (via companion-bridge) | bridge `:8787` `/health` reports healthy served sessions | live (via bridge `/health`) |

> Wired **through companion-bridge** (the bridge proxies to the upstream cloud LLM). The probe reads the
> bridge's free `/health` (no tokens): WORKING if it reports sessions with completed turns and no
> zombie-retry/context failures; BROKEN if sessions are degraded; OFF if the bridge isn't running
> (it's on-demand); UNKNOWN if up but no completed turns. The watcher never sends a billable
> generation, so a definitive live upstream check requires an operator-initiated test prompt.

### Network
| Element | Watch signal | Probe |
|---|---|---|
| NATS + JetStream | `:8222/jsz` stats | reuse (`NET-L2-JSZ`) |
| Per-node event stream | `local-events-<node>` exists | reuse |
| Pub/sub round-trip | published msg echoed < 1.5s | reuse |
| Mesh services | observed running PIDs; explicitly disabled Discord loaded/not-running/exit0 is optional OFF | live (OFF if none active) |
| Federation (cross-node) | identity-registry + shared stream | applic. (OFF if not deployed) |

The mesh aggregate reads Discord's effective `HOME/.openclaw/openclaw.json`
from the HOME observed in its loaded launchd environment (on Linux, the
`HOME=` its systemd unit sets). Strict
`channels.discord.enabled=false`, loaded/not-running state and observed exit0
are all required to report its optional OFF detail; healthy running peers can
then make the aggregate WORKING. A disabled running tool, failure exit or another
loaded stopped peer remains BROKEN. Missing state/normal-exit/config evidence
cannot authorize the exception; unreadable/malformed policy is UNKNOWN. Missing
enabled retains the legacy expectation. This does not enable Discord, assert
its API works, or turn other node failures into healthy results. An observed
service failure keeps BROKEN even when another service or policy is unobservable.

### Storage

| Element | Watch signal | Probe |
|---|---|---|
| state.db / knowledge.db / graph-cache.db | light tick: opens and answers `SELECT 1`, showing the last deep `integrity_check` verdict; deep sweep / one-shot: `integrity_check` ok | live |

`integrity_check` is a synchronous full scan the probe timeout cannot bound,
so the 60s light tick does not run it (repair 5.6 / R22 removed the same scan
from the health poll). A light result that only carries the last deep verdict
is flagged `lightTick` and does not drive BROKEN/recovered notifications; a DB
that fails to open on a light tick is still BROKEN at once.

### Agent runtime
| Element | Watch signal | Probe |
|---|---|---|
| OpenClaw gateway | fresh session JSONLs produced | live |
| companion-bridge :8787 | HTTP responds below 500 (BROKEN on 5xx; OFF if on-demand/down) | live |

### Operations & planning surfaces
| Element | Watch signal | Probe |
|---|---|---|
| Task board (kanban) | `active-tasks.md` parses | live |
| HyperAgent evidence loop | the deployed CLI and store import, and the daemon's HyperAgent scheduler ticked within 90 min (`.tmp/daemon-throttle.json` `lastHyperagentReflect`); BROKEN on a stale or missing tick or unreadable `ha_*` tables | reuse (`L0-HYPERAGENT`) + live |
| Calendar / scheduler | `/api/scheduler/status` reachable; no overdue triggers | live (read-only GET `/api/scheduler/status`) |
| Workplan viewer :7892 | HTTP 200 + plans discovered | live |
| Diagnostics (MC + health report) | `/api/diagnostics` 200 + `.daemon-health.md` fresh | live |

### Node fabric
| Element | Watch signal | Probe |
|---|---|---|
| Core services | required labels have running PIDs; known duplicate NATS jobs absent in other domains | live |
| Deploy in sync | `diff -rq` repo lib ↔ workspace lib empty | live |
| Identity + token + config | token `0600`, identity keypair present | live |

The installer declares the single `nats` job on a fresh node. A node using
the documented `nats-1..3` cluster or the `nats`, `nats-2`, `nats-3` layout declares
`{"schema":1,"activeLabels":[...]}` in
`~/.openclaw/config/nats-writer-cohort.json`. After a protected writer
handoff, the root-owned marker pins the active labels and selects launchd's
`system` domain. A missing declaration reports UNKNOWN; an update to an
existing NATS installation does not guess its cohort. The watcher reports PID
liveness and checks the four known
NATS labels in `gui`, `user` and `system`; it does not prove binary, UID,
config, store, JetStream health, or absence of unlisted/unmanaged processes.

Service state comes from launchd on macOS and from systemd user units on Linux.
For mesh services, core services, the gateway, the grappe coordinator and the
`FED-L2-COORD` acceptance probe, a label `ai.openclaw.<name>` maps to
`openclaw-<name>.service` and `systemctl --user show` is read into the same
record the launchd graders take. A unit counts as loaded when it is enabled or
currently started (an installed, disabled, inactive unit is not loaded);
`inactive` is launchd's "not running" and `ExecMainCode`/`ExecMainStatus` give
the last exit. On Linux, the cohort comes only from `nats-writer-cohort.json`,
and the other known NATS labels must not be loaded as user units. Other
platforms stay UNKNOWN.

### Federation
| Element | Watch signal | Probe |
|---|---|---|
| Grappe coordinator | `mesh-task-daemon` launchd/systemd unit has a running PID (OFF when not loaded: worker or standalone node; BROKEN when loaded without a PID; UNKNOWN when the service manager is unobservable) | live |
| NATS bus quorum | `:8222/jsz` `meta_cluster` has an elected raft leader, so a majority is reachable (a single-node bus with no raft cluster is WORKING; BROKEN when jsz is unreachable or no leader is elected; UNKNOWN when its body does not parse) | live |
| Grappe member heartbeats | every member of each non-dissolved `GRAPPE_REGISTRY` grappe heartbeated in `MESH_NODE_HEALTH` within 90 s (OFF when no grappe is formed; BROKEN on a stale member; UNKNOWN when the registry is unreadable) | live |
| Collab session liveness | no active or recruiting `MESH_COLLAB` session is idle past its budget: 15 min per round, 32 min per circling step (OFF when none is active; UNKNOWN when the session KV is unreadable) | live |

---

## Honest coverage today

- **Implemented (live or reused):** every element above.
- **UNKNOWN-stub (no probe yet — reports UNKNOWN, never green):** none — all targets now have a probe.
  (Vault link integrity wraps the read-only `checkVaultLinks`; calendar reads `/api/scheduler/status`;
  cloud-LLM reachability is wired through companion-bridge — see above.)
- **Heavy probes** (local generation, embedder, structured extraction) run one-shot/`--deep` only.

The watcher's status of any element is whatever it **observes at runtime** — this doc declares the
targets and signals; it does not assert any element currently works.
