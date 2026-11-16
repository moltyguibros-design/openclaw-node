---
name: mesh
description: >
  Multi-node mesh status and coordination over NATS. Use when you need to: see which
  nodes are online, check whether a node (or the whole mesh) is healthy, submit or
  review mesh tasks, or trigger a fleet deploy.
version: 2.0.0
user-invocable: true
metadata:
  openclaw:
    requires:
      bins:
        - mesh
    os:
      - macos
      - linux
---

# Mesh — Multi-Node Coordination

Nodes are connected by NATS (over Tailscale when the multi-node cluster is enabled).
Every node runs `mesh-health-publisher`, which writes its health to the
`MESH_NODE_HEALTH` KV every 15 seconds (entries expire after 2 minutes). `mesh status`
and `mesh health` read that KV — the same source Mission Control and fleet deploy use.

Remote command execution, screenshots and broadcasts (`mesh exec`, `mesh capture`,
`mesh broadcast`) and `mesh repair` were removed: no node runs a responder for them
(federation D4). Work on another node goes through mesh tasks (`mesh submit`).

## CLI — `mesh` command

### Which nodes are online
```bash
mesh status
```
Every node in `MESH_NODE_HEALTH`: ok / degraded / down, platform, role, memory,
uptime, deployed sha and how long ago it last reported.

### Health check
```bash
mesh health              # This node only
mesh health --all        # Every node in MESH_NODE_HEALTH (and this one)
mesh health --json       # {"overall": ..., "nodes": [{"nodeId", "overall", "problems", "services", ...}]}
```
Per node:
- `down` — no health entry, or the last report is older than 60 seconds
- `degraded` — a listed service is not `active` (services `not-found` on that node are ignored), or the disk is ≥ 90% full
- `ok` — otherwise

Exits 1 unless everything reported is `ok`. `problems` says what is wrong; fix it on
that node (restart the named service with launchctl/systemctl).

### Shared folder
```bash
mesh ls [subdir]
mesh put /path/to/file [subdir]
```
Operates on this node's `~/openclaw/shared/`. Nothing syncs it to other nodes.

### Tasks and deploys
```bash
mesh submit task.yaml        # or: mesh submit --id <kanban-task-id>
mesh tasks [--status running]
mesh tasks review | approve <id> | reject <id> --reason "..."
mesh deploy [--force] [--component <id>] [--node <id>]
```

## When to use this skill

- **"Is the other node online?"** -> `mesh status`
- **"Is the mesh healthy?"** -> `mesh health --all`
- **Before delegating work to another node** -> `mesh health --all` first
- **During heartbeat checks** -> `mesh health --json --all` for structured diagnostics
- **"Run this on another machine"** -> submit a mesh task (`mesh submit`)

## Autonomous maintenance pattern

When using the mesh in HEARTBEAT.md or cron jobs:

1. `mesh health --json --all` -- structured status of the mesh
2. If `overall` != "ok", log the failing nodes and their `problems` to
   `~/openclaw/shared/mesh-incidents.log` and alert the user
3. Only delegate work to nodes whose `overall` is "ok"

There is no automatic repair: a down or degraded node needs its services restarted on
that node.

## Anti-patterns — do NOT do these

- **Don't hardcode node ids or Tailscale IPs.** Use `mesh status`; ids come from each node's `OPENCLAW_NODE_ID`.
- **Don't store secrets in `~/openclaw/shared/`.**
