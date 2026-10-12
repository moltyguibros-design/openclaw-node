# B4 installed writer and invoker provenance — 2026-10-12 18:13 EDT

Read-only production-code audit after D168. No launchd command, service, VM,
NATS store, or topology was changed. This is a bounded inventory for hold
design, **not** a pre-stop no-writer certificate or the just-in-time B3 pin.
The separately hashed standalone NATS store and all three physical member
stores, including held `nats-1`, remain the preservation subjects.

## Scope and method

`B4_INSTALLED_ENTRYPOINTS_20261012.json` records freshly read installed
plist hashes, program and absolute argument-file paths/hashes, argv hash,
environment **keys only**, working directory, output paths, and every
launchd activation key checked. It contains no environment values or token.
The 23 labels are exactly the 23 proposed in
`FULL_NODE_BASELINE_CANDIDATE_20261009.json`; a read-only scan found 23
`ai.openclaw.*.plist` files under the home LaunchAgents directory, zero
extra labels and zero missing labels. All direct argument files named in the
October 9 candidate still exist. The new hashes are October 12 observations;
they do not approve the older candidate as window-entry pins. The viewer's
installed plist alone differs from the October 9 candidate.

The observed activation keys are `RunAtLoad`, `KeepAlive`, `StartInterval`
and `StartCalendarInterval`. None of the 23 plists declares `Sockets`,
`MachServices`, `WatchPaths`, `QueueDirectories`, `LaunchEvents`, or
`StartOnMount`. Absence of those triggers does not prevent a manual
`launchctl kickstart`, launchd's `KeepAlive` respawn, or a child spawned by a
running parent. `mesh-agent` has `KeepAlive=false` and `RunAtLoad=false`,
so its on-demand activation is an external caller, not a plist socket event.
Installed location is not proof of loaded domain. The JSON separates the
October 9 candidate's GUI-domain field from a fresh read-only `launchctl
print` of the GUI, user and system domains. At this observation, 21 of the
23 labels were loaded in GUI, none in user, and neither held `nats-1` nor
`federation-tick` was loaded. These states still require a fresh window-entry
check.

## Declared cohort

The table classifies **observed routes**, not all transitive code. `bus` means
the process can cause a NATS server to write through publish, request, KV,
or JetStream; `file` means it writes another local path. A `?` means the
transitive effect remains unresolved and must be treated as a possible writer
by the hold controller. The JSON gives exact paths and hashes for every row.

| Label suffix | Activation | Observed writer/invoker route |
|---|---|---|
| `consolidation-scheduler` | 1800 s | Gated timer delegates to a Node scheduler; memory consolidation/DB work and notifier child; transitive descendants `?`. |
| `federation-tick` | `KeepAlive`, `RunAtLoad`; held | Shell reads environment then runs `federation-tick.sh`; plan/repository writes possible if released. |
| `gateway` | `KeepAlive`, `RunAtLoad` | Bundled OpenClaw gateway; plugin, session, and network write paths `?`; launcher path alone is insufficient. |
| `health-watch` | `KeepAlive`, `RunAtLoad` | Health file write, NATS alert publish, notifier child, and restart/control code. |
| `lane-watchdog` | `KeepAlive`, `RunAtLoad` | Incident-log append, gateway signal, notifier child. |
| `log-rotate` | weekly calendar | Gated shell timer rotates/truncates logs and removes older rotations; no NATS-store write seen in direct script. |
| `memory-daemon` | `KeepAlive`, `RunAtLoad` | Memory DB/file writes, NATS events, knowledge-index child, other subprocesses; descendant completion `?`. |
| `mesh-agent` | external kickstart | NATS task client, Git worktree writes, detached process-group LLM child and shell metric child; any active descendants require their own drain proof. |
| `mesh-bridge` | `KeepAlive`, `RunAtLoad` | NATS task requests/events and active-task/log file writes. |
| `mesh-deploy-listener` | `KeepAlive`, `RunAtLoad` | NATS-triggered Git fetch/reset/merge and deploy commands; may restart other jobs. |
| `mesh-health-publisher` | `KeepAlive`, `RunAtLoad` | NATS JetStream/KV health writes. |
| `mesh-task-daemon` | `KeepAlive`, `RunAtLoad` | NATS JetStream/KV state and event writes. |
| `mesh-tool-discord` | `KeepAlive` on failure, `RunAtLoad` | Currently known-broken; if enabled, registry creates NATS KV registration and heartbeats. |
| `mission-control` | `KeepAlive`, `RunAtLoad` | `npm start` delegates to a Next.js server; HTTP routes and NATS/file effects `?`. |
| `nats` | `KeepAlive`, `RunAtLoad` | Direct writer of the standalone physical JetStream store. |
| `nats-1` | `KeepAlive`; held | Direct writer of the R1 physical member store if re-enabled; its held history must remain separate. |
| `nats-2` | `KeepAlive` | Direct writer of the second physical member store. |
| `nats-3` | `KeepAlive` | Direct writer of the third physical member store. |
| `node-watch` | `KeepAlive`, `RunAtLoad` | Report/HTML file writes and notifier child; probe dependencies `?`. |
| `observer` | `RunAtLoad`, 60 s | Gated timer samples and appends an observation ledger through imported library code. |
| `scheduler-heartbeat` | `RunAtLoad`, 60 s | Gated timer calls the Mission Control scheduler HTTP endpoint; downstream writes `?`. |
| `transcript-archive` | `RunAtLoad`, 3600 s | Gated shell timer copies transcripts with `rsync` and appends an archive log. |
| `workplan-viewer` | `KeepAlive`, `RunAtLoad` | Writes plan/config files, spawns tick commands, and offers launchd controls; currently installed release differs from the October 9 candidate. |

The four installed NATS configs declare distinct `store_dir` paths:
`nats` → `~/.openclaw/nats/jetstream`, `nats-1` → `jetstream-1`,
`nats-2` → `jetstream-2`, and `nats-3` → `jetstream-3` under the same parent.
This is a configuration/path observation, not proof of independent historical
origin or an accepted cold copy.

Direct source examples: installed `mesh-agent.js` uses `spawn(... detached:
true)` for its LLM provider around line 1007; installed `memory-daemon.mjs`
starts the knowledge-index child around line 1095 and other subprocesses
around line 1421; installed `mesh-deploy-listener.js` runs Git and deploy
commands around lines 124–180; the installed viewer spawns plan ticks near
line 2029. The five timers all delegate through the installed
`timer-entry.py` and manifest; the wrapper rejects work under its closed gate
but does not erase already spawned work. These are concrete reasons that
hashing plist argv and stopping only the parent PID is insufficient.

## In-cohort re-entry edges

The installed `mesh-deploy-listener.js` receives a NATS deploy trigger and
executes `bin/mesh-deploy.js --local` from its configured repository
(`mesh-deploy-listener.js:85–171`). That script's `mesh-daemons` and
`shared-lib` components include `ai.openclaw.mesh-agent` among services to
restart (`bin/mesh-deploy.js:202–203,241–242`); its macOS restart path runs
`launchctl unload` then `load` (`:783–795`). A hold must fence the listener
and drain an in-flight deploy before unloading mesh-agent or other affected
jobs. The installed workplan viewer also exposes authenticated plan-automation
load, unload and kickstart routes (`workplan-viewer.mjs:1959–2008`); a hold
must fence that control surface before relying on a stopped plan tick. The
exact target labels read by that route require current plan-config binding;
this audit does not infer that a particular tick was fired.

Out-of-cohort operator/deploy CLIs also contain launchd restart paths, for
example `bin/openclaw-stack.mjs:156` and `bin/openclaw-restart.sh:93`.
Their presence is not evidence of an active writer, but a login session
could invoke them until the approved window closes that access. The held
`federation-tick` plist embeds `workspace-bin/federation-tick.sh` in a shell
command; that delegate is not an absolute argument file in the JSON. B5 must
pin and inspect it before treating that job as controlled.

## Hold-design consequences and unresolved writers

`preservation_checks.py`'s existing `capture_entrypoint_inventory` checks
installed/loaded labels and plist hashes, but does not retain activation
fields or classify writer routes. The B5 controller must use the new
activation inventory, refuse if any reviewed label/trigger or payload changes,
drain/stop parent and descendant writers, and treat manual kickstart, browser
actions, remote NATS clients, deploy commands, timers, and on-demand jobs as
re-entry routes. Its owned negative must force a start between disable and
bootout and require refusal. It must not infer safety from a disabled override
while the job is loaded.

The fresh installed-plist scan found no `ai.openclaw.*` job in
`/Library/LaunchAgents` or `/Library/LaunchDaemons`. It found one
`com.openclaw.*` system daemon: `com.openclaw.tailscale-up`, loaded in the
system domain. Its installed plist invokes `/usr/local/bin/tailscale up`,
with no environment values, delegate script or declared NATS-store path;
the plist SHA is in the JSON. It is a network helper, not a **declared**
direct writer of the four NATS stores. No current OpenClaw-labeled
root-domain NATS writer was found. The root-writer migration document is a
future design, not a current installed job. This bounded statement does not
exclude other root processes or external clients.

The static cohort scan cannot enumerate an SSH/login-shell writer, a
crash-orphaned child, host-side filesystem access, another user's/system's
service, or a retained Mach writable memory entry. A fresh all-domain
inventory, process/holder census, current source pins, and four-store
path/volume match belong at the approved window entry.
The census is diagnostic, not complete physical exclusion (D164). Under
D168, only the clean stopped-VM plus active host boot guard can establish the
definitive physical no-writer boundary. Any failure before that point aborts
without claiming a hold; any failure after it follows the reviewed recovery
sequence.
