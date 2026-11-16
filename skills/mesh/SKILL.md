---
name: mesh
description: >
  Multi-node mesh over NATS: see which nodes are online and healthy, submit and
  review tasks for the mesh task daemon, manage multi-step plans, trigger a signed
  fleet deploy, and check mesh health. Use when you need to: see whether a node (or
  the whole mesh) is healthy, hand work to a mesh worker, see or approve mesh tasks,
  create or approve a plan, deploy the repo to every node, or check whether the
  NATS bus and federation are healthy before delegating.
version: 2.0.0
user-invocable: true
metadata:
  openclaw:
    os:
      - macos
      - linux
---

# Mesh — Multi-Node Coordination

Nodes share one NATS bus. On it run the **mesh task daemon** (coordinator, on the lead),
**mesh agents** (workers that claim and execute tasks) and a **deploy listener** on every node.

## The CLI

There is no `mesh` on PATH. The CLI is `bin/mesh.js`, which install.sh and mesh deploy put in
`~/openclaw/bin/`:

```bash
node ~/openclaw/bin/mesh.js help
```

Every example below writes `mesh` for `node ~/openclaw/bin/mesh.js`.

### Nodes

Every node runs `mesh-health-publisher`, which writes its health to the `MESH_NODE_HEALTH`
KV every 15 seconds (entries expire after 2 minutes) — the same source Mission Control and
fleet deploy read.

```bash
mesh status                 # every node: ok / degraded / down, platform, role, memory, uptime, deployed sha
mesh health                 # this node only
mesh health --all           # every node in MESH_NODE_HEALTH (and this one)
mesh health --json          # {"overall": ..., "nodes": [{"nodeId", "overall", "problems", "services", ...}]}
```

Per node: `down` — no health entry, or the last report is older than 60 seconds;
`degraded` — a listed service is not `active` (services `not-found` on that node are
ignored), or the disk is ≥ 90% full; `ok` — otherwise. `mesh health` exits 1 unless
everything reported is `ok`; `problems` says what is wrong on that node.

### Tasks

```bash
mesh submit task.yaml                 # submit a task YAML
cat task.yaml | mesh submit           # from stdin
mesh submit --id T-20260220-001       # a queued card from memory/active-tasks.md
mesh tasks                            # list mesh tasks
mesh tasks --status running           # filter by status
mesh tasks review                     # tasks waiting for human review
mesh tasks approve <task-id>          # approve a pending_review task
mesh tasks reject <task-id> --reason "..."   # reject and re-queue
```

To run something on another node, submit it as a task: a worker claims it and reports back.

### Plans

```bash
mesh plan templates                                   # available templates
mesh plan create --template <id> --context "<text>"   # [--parent-task <id>] [--set subtask.field=value]
mesh plan list [--status <status>]
mesh plan show <plan-id>                              # full plan with subtask tree
mesh plan approve <plan-id>                           # approve and start executing
mesh plan abort <plan-id> --reason "..."
```

### Deploy

```bash
mesh deploy                               # deploy the repo HEAD to every node
mesh deploy --node ubuntu                 # one node (alias or node id)
mesh deploy --component mesh-daemons      # one component
mesh deploy --force                       # reinstall even when nothing changed
```

The trigger carries the repo's current sha and branch, read from `$OPENCLAW_REPO_DIR`
(else `~/openclaw-node`, else `~/openclaw`). Each node's listener checks out that sha and
reports to the `MESH_DEPLOY_RESULTS` store; the CLI waits about 15 s for answers.

## Health

```bash
bin/node-acceptance.mjs --axis network --no-mutate      # NATS, JetStream, local event stream, pub/sub
bin/node-acceptance.mjs --axis federation --no-mutate   # coordinator present, raft quorum (clustered nodes)
node ~/openclaw/bin/openclaw-stack.mjs status           # which openclaw units are up on this node
```

`node-acceptance` exits 0 ACCEPTED, 1 REJECTED, 2 INCOMPLETE (a probe could not run), 3 error.
`openclaw-stack status` exits 1 when any unit is DOWN. Both only read; neither restarts anything.
The node-watch service keeps a live map at Mission Control's `/node-watch` page.

Check health (`mesh health --all` and the probes above) before delegating work to the mesh. If
a probe is REJECTED or a node is not `ok`, do the work locally or queue it, and tell the user
what failed. Restarting services is the operator's call.

## Security model

- Approve, reject and plan actions are signed with this node's identity key
  (`~/.openclaw/identity.key`), and the task daemon refuses unsigned ones. Run them on the lead.
- Deploy triggers are signed the same way; listeners accept only triggers signed by a key in
  `OPENCLAW_DEPLOY_TRUSTED_KEYS` unless an operator disabled that check.
- The bus itself uses the install's NATS auth (`~/.openclaw/config/nats-auth.conf`).
- Task metrics and shell tasks go through the shared command filter (`lib/exec-safety.js`).

## Not available

Remote `exec`, screenshot `capture`, `broadcast`, `repair`, and the `~/openclaw/shared/` sync
folder (`ls`, `put`) are gone. Their responder, `~/openclaw/agent.js`, was retired on 2026-10-02,
and the repair script was never in this repo. Use a task for remote work, and `mesh status` /
`mesh health` or the probes above for status.
