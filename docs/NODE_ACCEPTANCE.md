# Node Acceptance Protocol

**Status:** BUILT for single-node (2026-06-15) — `bin/node-acceptance.mjs` + `lib/node-acceptance.mjs` +
`lib/node-acceptance-probes.mjs` implement L0, L1, L2 and L4 checks across the memory, LLM, network,
storage and federation axes; §4–§6 list each check under the ID the evidence report prints, and §11
lists the designed checks that were not built. A node's runtime evidence is its run's report (§7.2).
Inter-node L3 is specified but deferred (§8).
**Owner principle:** MASTER_PLAN §4.1 (code on disk ≠ shipped), §4.7 (tests are not done-criteria),
§5 (done requires runtime evidence). This protocol is the operational instance of §5 applied to a
*whole node* rather than a single step.

---

## 0. Running it (the built global system check)

```bash
node bin/node-acceptance.mjs            # full single-node gate, hard-tests every component
npm run node-check                      # same, via package script
openclaw-node-check                     # same, after `npm i -g` / link (bin entry)
node bin/node-acceptance.mjs --axis llm # one axis: memory | llm | network | storage | federation
node bin/node-acceptance.mjs --no-mutate# skip probes that write synthetic data
node bin/node-acceptance.mjs --deep     # include invasive probes (e.g. extract-trigger)
node bin/node-acceptance.mjs --json --report /path/report.md
```

Exit codes: **0** ACCEPTED · **1** REJECTED · **2** INCOMPLETE · **3** harness error. Writes an evidence
report to `~/.openclaw/.node-acceptance.md` by default. **Portable:** every path/URL/port/model resolves
from the same env vars the deployed components read (`OPENCLAW_HOME`, `OPENCLAW_WORKSPACE`,
`OPENCLAW_NODE_ID`, `LLM_BASE_URL`, `LLM_MODEL`, `MEMORY_INJECT_PORT`, `NATS_MONITOR_URL`,
`OPENCLAW_NATS`, …), so the same binary self-tests any node, including `spawn-node` trees via
`OPENCLAW_HOME=~/.openclaw-<id>`: the L1 state.db and workspace checks follow it too. The default
evidence report stays at `~/.openclaw/.node-acceptance.md` (Mission Control reads it there), so pass
`--report` for a spawn tree, and a `~` in a transcript source means the user's home, as in the daemon.

**Deployment integration:** run as a post-deploy gate (CI / `mesh-deploy-listener`), or schedule
periodically alongside `health-watch`. A non-zero exit means the node is not 100% — see §10.

---

## 1. Why this exists

A node has three independent notions of "working", and the existing tooling only covers two:

| Question | Answered by today | Gap |
|---|---|---|
| Is the code *correct*? | 69 test files / 1414 unit+integration tests (mocked NATS, in-process) | proves logic, not a deployed node |
| Is each part *running*? | `lib/health-check.mjs` `runHealthCheck()` + the `health-watch` daemon (6 liveness probes) | proves a PID exists, not that the function works |
| Does the whole node *function* end-to-end? | **nothing** | **this protocol** |

The failure mode this guards against is the May-2026 one (MASTER_PLAN intro): "the daemon starts and
prints *startup complete* while hiding three disabled subsystems." A green PID and a passing test suite
both reported success while the node produced ~0 working behavior. **Liveness ≠ acceptance.**

`bin/openclaw-status.mjs` is *not* an acceptance gate either: it greps daemon **source** statically and
(per COMPONENT_REGISTRY cross-component issues) introspects the *wrong* daemon, reporting false
`NOT_WIRED`. **This protocol probes the running runtime, never source.**

"100%" is defined precisely here: every **required** check in the node's profile returns `PASS` **with
captured runtime evidence**. Anything unobservable is `SKIP`/`BLOCK`, never `PASS` — fake-passing is the
cardinal failure (same rule the tick-chain runs on, PROTOCOL §7).

---

## 2. Scope of this round

- **In scope:** single-node acceptance — layers **L0, L1, L2, L4** across the **memory**, **LLM-backing**,
  and **network (local)** axes.
- **Deferred (operator decision 2026-06-15):** layer **L3 inter-node / federation**. It is *specified*
  here (§8) so the later round starts from a contract, but it is not built this round and is reported
  `N/A (deferred)` on a single node — never `PASS`, never `FAIL`. Rationale: federation is `ABSENT` in the
  live runtime (COMPONENT_REGISTRY 1.5; NATS is loopback-only single-node per 7.1; redesign D4 deferred it).
- **Since then:** a `federation` axis ships two advisory L2 probes, `FED-L2-COORD` and `FED-L2-QUORUM`
  (`required: false`, `lib/node-acceptance-probes.mjs`); inter-node L3 (NODE-1..7) stays `N/A (deferred)`.

### Profiles

| Profile | Layers run | Use |
|---|---|---|
| `single-node` (default) | L0, L1, L2, L4; L3 → `N/A` | Accept one deployed node (today's reality). |
| `federated` (future) | + L3 against a real or `spawn-node` peer | Accept a node's links to other nodes (§8). |

The harness also accepts `--axis memory|llm|network|storage|federation` to run one axis in isolation.

---

## 3. The gate model

Five layers, ascending in integration. A node is accepted only when **all required checks across all
active-profile layers** are `PASS`.

| Layer | Proves | Evidence class |
|---|---|---|
| **L0 Presence** | every part is *deployed* (no deploy gap, §4.1) | file stat · `readlink` · `diff -rq` · `launchctl list` · perms |
| **L1 Liveness** | every part is *running* | PID · port listen · `launchctl` PID · HTTP `healthz` |
| **L2 Functional** | each part *does its job* in isolation | SQL row-delta · HTTP body · generated text · vector dims |
| **L3 Inter-node** | the link to *other nodes* is real + reliable | observed offer/accept · rejected forgery · reconnect log *(deferred §8)* |
| **L4 End-to-end** | the *whole loop* works | a unique fact ingested becomes retrievable / injected upstream |

### Check verdicts

- `PASS` — observed, threshold met, evidence captured.
- `FAIL` — observed, threshold missed (gate goes red).
- `SKIP` — a precondition for *this* probe is absent in this profile (e.g. companion-bridge off); recorded, not counted against the gate, **must state why**.
- `N/A` — out of profile (e.g. all of L3 on `single-node`).
- `BLOCK` — the probe *should* run but cannot observe (tool missing, headless-only). Treated as `FAIL` for the gate. Never silently downgraded to `PASS`.

### Gate rule

```
accepted  ⇔  (no FAIL) ∧ (no BLOCK) ∧ (every required check is PASS)
```

The harness runs **all** layers (no early abort) so one report shows the full picture, then computes the
gate. Exit code: `0` accepted, `1` rejected, `2` incomplete, `3` harness error.

---

## 4. Axis: Memory function (the deepest)

The pipeline under test: `JSONL session → ingest → state.db → extraction (LLM) → entities/themes/mentions/
decisions → indexing (knowledge.db FTS+vec, graph-cache.db) → retrieval (5 channels) → inject :7893`.
Acceptance is a **round-trip**, not "the database opens".

All synthetic data is tagged with a per-run nonce (`acceptance-<runId>`) in an isolated synthetic session
so probes never pollute real memory, and is deleted in teardown (§7.4).

| ID | Proves | Method | PASS threshold | Evidence captured | Builds on |
|---|---|---|---|---|---|
| L0-DB | DBs deployed (storage axis) | stat the 3 DB files | `state.db`, `knowledge.db`, `graph-cache.db` all present + non-empty | size per DB | COMPONENT_REGISTRY 6.1 |
| L0-DEPLOY | daemon deployed | access `workspace/bin/memory-daemon.mjs`, `workspace/lib/`, `workspace/packages/event-schemas/dist/index.js` | all present (the daemon exits at startup without the schemas) | daemon path | MASTER_PLAN §4.1 deploy gap |
| L0-HYPERAGENT | HyperAgent deployed | access `workspace/bin/hyperagent.mjs` + `workspace/lib/hyperagent-store.mjs`, run the CLI with `--help` | both present; the CLI exits 0 and prints `hyperagent` | CLI path or stderr | HyperAgent plan |
| L0-TOKEN | inject token deployed | stat `config/memory-injection-token` | exists; a mode other than `600` is a warning in the PASS detail, not a FAIL | path, mode, size | 1.3 |
| MEM-L1-1 | daemon up | health-check `checkDaemon` (service PID) | PID present | PID | health-check |
| MEM-L1-3 | state.db readable (storage axis) | health-check `checkSqlite`: open read-only, `SELECT 1` | answers | path | health-check |
| STO-L1-1 | workspace writable (storage axis) | health-check `checkWorkspaceWritable`: write a probe file | write succeeds | path | health-check |
| MEM-L2-INGEST | **ingest works** | import a synthetic nonce transcript through the session store | `messages` count for the synthetic session ≥ 2 | session id + count | session-store, append-delta 3.1 |
| MEM-L2-INJECT | **retrieval answers** | authorized `POST /memory/inject` with a known query | HTTP 200, well-formed `items`, items > 0; SKIP while the store holds no entities, FAIL if it holds some and none come back | concepts/decisions/snippets counts + ms | 1.3 |
| MEM-L4-ROUNDTRIP | **gold round-trip** | write a nonce transcript into the first configured transcript source, publish an extract trigger, poll `mentions` for the session (`ACCEPT_ROUNDTRIP_POLL_MS`, default 60 s), then query inject for the nonce | the nonce appears in the injected block | the matching block | full pipeline |

MEM-L2-INJECT and MEM-L4-ROUNDTRIP need the LLM axis and are skipped with `--skip-axis llm`.

> **MEM-L4-ROUNDTRIP is the crown probe.** It is the single check that proves *the memory function actually
> works* on this node: a fact that did not exist before the run is created, extracted, indexed, and
> retrieved by content. If only one memory check could run, it is this one.

---

## 5. Axis: LLM backing

Ollama-served generation + BGE-M3 embedding, model selected by `LLM_MODEL` (default `qwen3:8b`),
serialized through `lib/ollama-queue.mjs`. Acceptance proves the model **runs**, not that the server
answers `/api/tags`.

| ID | Proves | Method | PASS threshold | Evidence | Builds on |
|---|---|---|---|---|---|
| LLM-L1-1 | server up | health-check `checkOllama`: `GET :11434/api/tags` | HTTP 200 | model list | health-check |
| LLM-L1-3 | embedder available | health-check `checkEmbedder`: the transformers package loads | loads | detail | health-check |
| LLM-L2-MODEL | **configured model present** | the model named by `LLM_MODEL` is in `/api/tags` | exact name match (not "some model") | matched tag | MASTER_PLAN 3.2 |
| LLM-L2-GEN | **generation runs** | `POST :11434/api/generate` with a short prompt | non-empty `response`, `eval_count>0`, within `ACCEPT_GEN_BUDGET_MS` (default 30 s) | response text + eval_count | llm-client |
| LLM-L2-EMBED | **embedder runs** | embed a string with BGE-M3 | vector length = 1024, all finite, L2-norm > 0 | dim + norm | embed-benchmark |
| LLM-L2-EXTRACT | **production task works** | run the structured-extraction path on a tiny synthetic transcript | schema-valid extraction | entity/decision/theme counts | extraction-prompt/schema 3.4 |

> LLM-L2-EXTRACT is the LLM analogue of the gold round-trip: it proves the backing works for the *real* task
> (schema-valid structured extraction), not just freeform text. A model that generates prose but fails
> structured extraction is a failed LLM backing for this node's purpose.

---

## 6. Axis: Network connection (local)

Local NATS (loopback `:4222`, monitor `:8222`, JetStream on), the per-node stream
`local-events-<NODE_ID>`, and the daemon's connection to it. Acceptance proves messages **flow**, not
that a server is listening.

| ID | Proves | Method | PASS threshold | Evidence | Builds on |
|---|---|---|---|---|---|
| NET-L1-2 | monitor healthy | health-check `checkNats`: `GET :8222/healthz` | HTTP 200 | body | health-check |
| NET-L2-JSZ | **JetStream enabled** | `GET :8222/jsz` | HTTP 200 with JetStream stats | streams + memory | 7.1 |
| NET-L2-STREAM | per-node stream exists | stream info for `local-events-<NODE_ID>` | present, subjects exactly `local.<NODE_ID>.>` (a legacy `local.>` stream fails: it blocks every other node's stream) | subjects + message count | 1.7 |
| NET-L2-PUBSUB | **core pub/sub round-trip** | subscribe a probe subject, publish a nonce, await delivery | payload echoed within 1.5 s | subject | nats-resolve |
| NET-L2-TRIGGER | extraction trigger publishes (advisory, `--deep` only) | publish `mesh.memory.extract_request.<nodeId>` | publish succeeds; the flush is not awaited | subject | 1.6 |
| FED-L2-COORD | coordinator present (federation axis, advisory) | `mesh-task-daemon` unit state from systemd/launchd | running PID; a node without the coordinator (worker/standalone) is SKIP, not FAIL | unit state | node-watch `fed.coordinator` |
| FED-L2-QUORUM | bus quorum (federation axis, advisory) | `GET :8222/jsz` `meta_cluster` | a single-node bus, or a raft leader elected; no leader is FAIL; bus unreachable is SKIP (NET-L2-JSZ owns it) | jsz detail | node-watch `fed.cluster.quorum` |

> **Legacy `local.>` stream.** A node that ran the memory daemon before the per-node layout keeps a
> stream on `local.>`, which claims every node's subjects. When it carries another node id (a renamed
> node, e.g. `local-events-daedalus`), this node's stream cannot be created: the memory daemon logs
> `Local event log unavailable (cannot create local-events-<NODE_ID> … stream local-events-<old-id> owns local.> …)`
> and runs without an event log, and NET-L2-STREAM fails "not found" naming the same stream and command.
> The code never edits that stream. Preserve its history first, then narrow it with
> `nats stream edit local-events-<old-id> --subjects 'local.<old-id>.>'` (or remove it) and restart the
> memory daemon. Narrowing deletes no stored message.

> NET-L2-JSZ/NET-L2-PUBSUB distinguish "server up" (L1) from "messaging works" (L2). The wire driving
> the pipeline is proven end to end by MEM-L4-ROUNDTRIP, which publishes the extract trigger and waits
> for its mentions; NET-L2-TRIGGER alone only shows the publish succeeds.

---

## 7. The harness

### 7.1 Contract

```
bin/node-acceptance.mjs [--profile single-node|federated] [--axis <axis>] [--json] [--report <path>] [--quiet]
```

- Default profile `single-node`. `--axis` runs one axis; otherwise all in-profile axes.
- Each check is a pure async fn returning
  `{ id, layer, axis, status, required, threshold, evidence, detail, latency_ms }`.
- Runs all layers (no early abort), then computes the §3 gate.
- Exit `0` accepted · `1` rejected · `2` incomplete · `3` harness error.
- **Reality-first (§4.5):** every value is re-probed live. The harness trusts no doc, including this one
  and COMPONENT_REGISTRY.
- **Composition, not duplication:** reuses `lib/health-check.mjs` for L1 liveness; the `ollama-queue`
  snapshot check is not built (§11); `node-identity` for L3 (future), `spawn-node` for the `federated` peer.

### 7.2 Output

Human table (default) + `--json` machine object. Always writes a dated report to
`~/.openclaw/.node-acceptance.md` and `--report` if given. The report
embeds the captured evidence verbatim — it **is** the §5 runtime-evidence artifact for a deploy.

```
Node Acceptance — node=daedalus profile=single-node — 2026-06-15T18:22:04Z
  L0 Presence   ████████  8/8   PASS
  L1 Liveness   ███████░  7/8   FAIL (companion-bridge :8787 down)
  L2 Functional ████████ 14/14  PASS
  L3 Inter-node  —  N/A (deferred this round)
  L4 End-to-end ███████░  1/2   PASS (gold round-trip MEM-L4-ROUNDTRIP ✓)
GATE: REJECTED — 1 FAIL. Evidence → ~/.openclaw/.node-acceptance.md
```

### 7.3 Determinism + safety

- Synthetic-only writes, tagged `acceptance-<runId>`; no mutation of real sessions/entities.
- Idempotent: a second run produces the same verdicts (modulo real drift).
- Read-mostly: the only writes are the synthetic session JSONL, its derived rows, a probe NATS message,
  and the report file.

### 7.4 Teardown

Always-run cleanup (even on failure): delete the synthetic JSONL, `DELETE` synthetic rows from
`state.db`/`knowledge.db`/`graph-cache.db` by nonce, purge the probe NATS subject. A `--keep` flag
preserves fixtures for debugging. Teardown failures are themselves reported (a node that can't clean up
is a finding).

---

## 8. Inter-node reliability — L3 (DEFERRED this round; contract for the next)

Federation is `ABSENT` in the live runtime, so these are specified, not built, and report `N/A (deferred)`
on `single-node`. They activate under `--profile federated`, validated against a `bin/spawn-node.mjs`
peer on one machine or a real second node. This honors the original "be thorough about other-node
reliability" intent by leaving the next round a complete contract; it does **not** authorize build now.
Since then a `federation` axis ships two advisory L2 probes, `FED-L2-COORD` and `FED-L2-QUORUM`
(`required: false`, `lib/node-acceptance-probes.mjs`); the L3 checks below stay `N/A (deferred)`.

| ID | Proves | Method | PASS threshold | Builds on |
|---|---|---|---|---|
| NODE-1 | identity | each node has ed25519 `identity.{key,pub}`; `identity-registry.json` lists the peer | signature verify succeeds for a trusted peer | node-identity, 1.5 |
| NODE-2 | **broadcast→offer→accept** | node A broadcasts a context theme; B offers; A accepts | a `[peer-memory:]` block surfaces in A's next injection | broadcast-emitter/offerer/acceptor, 1.5 done-criterion |
| NODE-3 | signature enforcement | inject an unsigned/forged broadcast | it is **rejected**, not surfaced | broadcast-schemas, federation-startup |
| NODE-4 | replay dedup | resend a broadcast with a seen event id | ignored (seenIds cache) | `createSeenEventCache` |
| NODE-5 | **resilience to peer drop** | kill peer B mid-exchange | A degrades gracefully (no crash, local-first continues) then reconnects when B returns | federation-resilience |
| NODE-6 | heartbeat/liveness | each node observes the other's heartbeat | dead-node detection fires when a peer drops | mesh-health-publisher (MESH_NODES KV TTL) |
| NODE-7 | **partition / offline tolerance** | make *all* peers unreachable | full local function continues (local-first guarantee) | MASTER_PLAN 3.2 local-first |

Observability for these already exists: `bin/dogfood-council.mjs` (docs/DOGFOOD_PROTOCOL.md) subscribes to
the federation subjects and records round-trips — the L3 harness should *drive* the exchange and let the
dogfood harness *witness* it. Cluster/peer setup: docs/MULTI_NODE_DEPLOY.md, docs/NATS_CLUSTER.md.

---

## 9. End-to-end — L4

| ID | Proves | Method | PASS threshold | Note |
|---|---|---|---|---|
| E2E-L4-1 | memory loop closes | = MEM-L4-ROUNDTRIP gold round-trip | nonce fact retrievable | the deployable single-node e2e |
| E2E-L4-2 | harness→LLM injection | with companion-bridge `:8787` up, send a prompt; inspect the upstream request | a memory block is present in the request to the LLM | not built (§11) |

E2E-L4-2 depends on companion-bridge running as a daemon, which it currently is not (COMPONENT_REGISTRY
2.1). Until it is, the gold round-trip (E2E-L4-1) is the binding end-to-end acceptance.

---

## 10. How it enforces "100%"

This protocol has teeth only if a deploy is *not done* until the gate is green:

1. **Manual gate** — `node bin/node-acceptance.mjs` after any deploy/restart. Non-zero exit = not done.
2. **Deploy-listener gate — not built.** `mesh-deploy-listener` does not run the harness; run
   `openclaw-node-check` (or `node bin/node-acceptance.mjs`) after a mesh deploy. Whether a red gate
   should block the listener is open decision D2 (§12).
3. **Done-contract binding** — the harness report at `~/.openclaw/.node-acceptance.md` is the
   `Runtime-Evidence:` artifact (MASTER_PLAN §5.4) any node-touching step cites.
4. **Continuous** — optionally schedule the harness (cron / launchd) so acceptance is re-verified, not
   assumed; it complements `health-watch` (liveness, 60 s) with deep functional acceptance (e.g. hourly).

It does **not** replace the unit suite (correctness) or `health-watch` (liveness) — it sits above both as
the deployed-node truth gate.

---

## 11. Build plan record (2026-06-15)

Steps 1–5 shipped as the harness; step 6's deploy-listener hook and schedule are not built (§10).

Each step is atomic, runtime-verifiable, and maps to a layer — suitable as a `node-acceptance` plan silo
(`new-plan.sh`) or a single scoped feature, operator's call:

1. **Harness skeleton** — `bin/node-acceptance.mjs` runner, verdict/report types, gate computation,
   `--json`/report writer; wire L1 by delegating to `runHealthCheck`. *Verify:* runs, reports L1, exit code reflects gate.
2. **L0 presence** — deploy-surface probes (files, symlinks, `diff -rq`, plists, token perms). *Verify:* a deliberately-removed symlink flips MEM-L0 red.
3. **Network axis (L1/L2)** — NATS port/monitor/jsz/stream, pub/sub + JetStream round-trip, trigger round-trip. *Verify:* round-trip nonce echoed; stopping NATS flips it red.
4. **LLM axis** — model-present, generation, embedding, structured-extraction, queue. *Verify:* real generation text + 1024-dim vector captured.
5. **Memory axis incl. gold round-trip** — synthetic ingest→extract→index→inject, MEM-L4-1, teardown. *Verify:* nonce fact retrieved by content; fixtures gone after.
6. **Enforcement wiring** — deploy-listener hook + optional schedule + done-contract reference. *Verify:* a red gate blocks deploy-complete.

L3 (§8) is a **separate future block**, gated on federation being deployed.

### Not built

Checks this design specified that the gate does not run (their original IDs, so older reports and notes
can be matched):

- MEM-L0-3 — watched transcript sources configured (MEM-L4-ROUNDTRIP BLOCKs without one; there is no separate check)
- MEM-L1-2 — the inject server refuses a request without the token (`401`)
- MEM-L2-3 — mentions carry `turn_index`
- MEM-L2-4 — `knowledge.db` FTS + vector index picked up the synthetic session
- MEM-L2-5 — `graph-cache.db` refreshed within 1 h
- MEM-L2-6 — each of the 5 retrieval channels returns ≥1 (MEM-L2-INJECT checks only the total)
- MEM-L2-7 — inject latency p95 < 500 ms
- MEM-L2-8 — `watcher.jsonl` fresh with no open `watcher.alert`
- LLM-L0-1 — RAM headroom advisory (`bin/check-llm-baseline.mjs`)
- LLM-L2-4 — `ollama-queue` not stuck
- NET-L0-1 — the NATS service is loaded
- NET-L1-1 — TCP connect to `:4222`
- NET-L1-5 — the `mesh-*` services are loaded
- NET-L2-2 — JetStream publish + read-back durability
- NET-L2-3 — the daemon log shows NATS connected and the stream initialized at boot
- NET-L2-4 — trigger → flush round-trip (NET-L2-TRIGGER only publishes)
- E2E-L4-2 — harness → LLM injection through companion-bridge

The other designed IDs were built under new names: MEM-L0-1 → L0-DB, MEM-L0-2 → L0-TOKEN, MEM-L2-1 →
MEM-L2-INGEST, MEM-L2-2/MEM-L4-1 → MEM-L4-ROUNDTRIP, MEM-L2-6 (total only) → MEM-L2-INJECT, LLM-L1-2 →
LLM-L2-MODEL, LLM-L2-1 → LLM-L2-GEN, LLM-L2-2 → LLM-L2-EMBED, LLM-L2-3 → LLM-L2-EXTRACT, NET-L1-3 →
NET-L2-JSZ, NET-L1-4 → NET-L2-STREAM, NET-L2-1 → NET-L2-PUBSUB.

---

## 12. Open decisions for the operator

- **D1** — Build vehicle: a dedicated `node-acceptance` **plan silo** (full protocol/tick/viewer treatment)
  vs a **single scoped feature** (`bin/node-acceptance.mjs` + this doc). (You chose design-doc-first; this
  is the next fork.)
- **D2** — Should a red acceptance gate *hard-block* the `mesh-deploy-listener`, or only warn? (§10.2)
- **D3** — Generation latency budget (`ACCEPT_GEN_BUDGET_MS`) default — 30 s tolerates cold model load;
  too loose to catch a degraded GPU. Set per-hardware?
- **D4** — Schedule cadence for continuous acceptance (§10.4), or manual/CI only?
