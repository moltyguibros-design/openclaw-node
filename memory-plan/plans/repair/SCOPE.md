# SCOPE — repair plan

**Status:** active
**Set at:** 2026-08-24 (operator selection, "Full fix — 4 files", after a fresh-machine install
of `openclaw-node` failed to install ollama, Homebrew, Tailscale, Node, and Python)
**Expires:** 2026-08-26T00:00:00Z
**Goal (2026-08-24 batch — fresh-install dependency bootstrap):** `install.sh` claims in the
README that Node.js, Python 3, Git, SQLite3, build tools, nats-server and ollama are
"auto-installed". On macOS only nats-server and ollama actually are; Git/SQLite3/curl hit empty
`if [ "$OS" = "linux" ]` branches and no-op silently, build tools are never checked at all, and
Node/Python `exit 1`. On Linux, `apt-get update` runs only inside the node-missing branch, so a
box that already ships Node 22 installs against stale lists and dies mid-run under `set -e`.
Separately, the README's recommended entrypoint `npx openclaw-node-harness` cannot bootstrap
Node, because npx requires Node — and `engines: >=22` contradicts the documented "Node.js 18+"
baseline. Fix: add a dependency-free `scripts/install/prereqs.sh` bootstrap (Homebrew +
Tailscale included), wire it into `install.sh`, repair the macOS/Linux branches in
`system-deps.sh`, and correct the README's false claims and entrypoint ordering. Verification is
`bash scripts/install/prereqs.sh --check` plus `bash install.sh --dry-run`.

**Prior goal (v7.8, idle):** ALL ACTIVE BLOCKS COMPLETE at v7.8 (Blocks 1–7, 49/49 steps, every Proof runtime-captured; suite 1550/0). Remaining scope: Block P (parked security R34–R38, operator-held — the 'working prototype' precondition is now met). Next action is an operator decision: open Block P, commission captured OUT_OF_SCOPE items, or close the plan. (2026-06-11: one labeled hotfix ran under this scope — hydration-mismatch skeleton widths, see git log — scope returned to idle.)

```files 2026-08-24-bootstrap
bootstrap.sh
scripts/install/prereqs.sh
scripts/install/system-deps.sh
install.sh
README.md
```

```files
services/launchd/*
test/*
packages/event-schemas/*
workspace-bin/memory-daemon.mjs
lib/pre-compression-flush.mjs
lib/memory-inject-server.mjs
bin/consolidate.mjs
bin/memory-promoter.mjs
lib/memory-budget.mjs
memory-plan/plans/repair/*
```

## How this file works

- **Status:** must be `active` for the hook to allow edits to listed files.
- **Expires:** ISO-8601 UTC. Past `Expires` -> blocked. `no-expiry` disables the check.
- **`files` block:** one repo-relative path per line; exact or shell-glob; `#` comments.
- **Override:** `**Override:** true` bypasses the hook (operator emergency escape).
