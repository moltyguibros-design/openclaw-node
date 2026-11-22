#!/usr/bin/env bash
# plan-tick.sh — one autonomous tick of ANY siloed workplan under memory-plan/plans/<id>/.
#
# The generic chain engine (PROTOCOL.md §7). Everything per-plan is derived from the
# plan id: dir, prompt, inventory, version, lock, tick-logs, progress digest. The viewer
# and launchd invoke tick commands with no argv, so each plan fronts this engine with a
# generated shim workspace-bin/<id>-tick.sh (`exec plan-tick.sh <id>`), created by new-plan.sh.
#
# Modes:
#   ./workspace-bin/plan-tick.sh <id> --preflight   # dry-run: report next step, do NOT invoke claude
#   ./workspace-bin/plan-tick.sh <id>               # run one real tick (invokes headless claude)
#   DRY_RUN=1 ./workspace-bin/plan-tick.sh <id>     # full pre-flight then stop before claude
#
# Exit codes: 0 ran/short-circuit/blocked-already · 1 wrapper failure, or the agent run
# failed below WORKPLAN_FAIL_LIMIT in a row · 2 BLOCKED.md written (by the tick, a gate,
# or the wrapper after WORKPLAN_FAIL_LIMIT failed agent runs in a row)
#
# Agent-run limits (any agent CLI):
#   WORKPLAN_TICK_TIMEOUT  wall-clock seconds before the agent's process group is killed
#                          (default 2700; must stay below the 3600 s stale-lock reap)
#   WORKPLAN_FAIL_LIMIT    consecutive failed runs that block the plan (default 3)

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PLAN_ID="${1:-}"
[ -n "${PLAN_ID}" ] || { echo "usage: plan-tick.sh <plan-id> [--preflight]"; exit 1; }

PLAN_DIR="${REPO}/memory-plan/plans/${PLAN_ID}"
TICK_LOG_DIR="${PLAN_DIR}/tick-logs"
PROMPT_FILE="${PLAN_DIR}/TICK_PROMPT.md"
BLOCK_FILE="${PLAN_DIR}/BLOCKED.md"
VERSION_FILE="${PLAN_DIR}/VERSION"
INVENTORY_FILE="${PLAN_DIR}/INVENTORY.md"
# One lock for every plan: all ticks share this working tree and git index, so a
# per-plan lock let two chains commit each other's staged files.
LOCK_DIR="${REPO}/memory-plan/.tick.lock"
DIGEST_FILE="${HOME}/.openclaw/workspace/memory/${PLAN_ID}-progress.md"

MODE="run"
case "${2:-}" in
  --preflight) MODE="preflight" ;;
  "") : ;;
  *) echo "unknown arg: $2 (use --preflight or no arg)"; exit 1 ;;
esac

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { printf '[%s] [%s] %s\n' "$(ts)" "${PLAN_ID}" "$*"; }

# The plan's agent CLI: automation.json `agent_provider`, which the viewer exports as
# WORKPLAN_AGENT_PROVIDER. Each profile reads TICK_PROMPT.md on stdin and must be able to
# edit files and run git/npm/node unattended; any other CLI is refused, never run read-only.
AGENT_PROVIDER="${WORKPLAN_AGENT_PROVIDER:-claude}"
case "${AGENT_PROVIDER}" in
  claude|codex|gemini) AGENT_BIN="${AGENT_PROVIDER}" ;;
  *) AGENT_BIN="" ;;
esac
run_agent() {
  case "${AGENT_PROVIDER}" in
    claude)
      claude \
        --print \
        --permission-mode acceptEdits \
        --allowedTools "Bash(node:*),Bash(nats:*),Bash(/opt/homebrew/bin/nats:*),Bash(curl:*),Bash(lsof:*),Bash(npm:*),Bash(git:*),Bash(jq:*),Bash(launchctl:*)" \
        --add-dir "${HOME}/.openclaw/workspace" \
        --add-dir "${HOME}/.openclaw" \
        --output-format stream-json \
        --verbose ;;
    # codex's workspace-write sandbox keeps .git read-only, so a sandboxed tick could
    # never commit its step; claude's Bash(node:*) grant is no narrower in practice.
    codex)
      codex exec --dangerously-bypass-approvals-and-sandbox --json - ;;
    gemini)
      gemini \
        --approval-mode yolo \
        --include-directories "${HOME}/.openclaw/workspace" \
        --include-directories "${HOME}/.openclaw" \
        --output-format stream-json ;;
  esac
}

# Find the first [ ] or [A] inventory row → "next step". Echoes "version|step|desc" or empty.
# Whitespace-tolerant (same tolerance as the viewer and plan-lint — one row format,
# one parse contract). [D] (deferred) rows are never a next step and never block
# plan completion.
next_step() {
  grep -E '^\|[[:space:]]*[0-9]+[[:space:]]*\|[[:space:]]*[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*v[0-9]+\.[0-9]+[[:space:]]*\|[[:space:]]*\[(A| )\]' "${INVENTORY_FILE}" 2>/dev/null \
    | head -1 \
    | awk -F'|' '{ gsub(/^ +| +$/,"",$3); gsub(/^ +| +$/,"",$5); gsub(/^ +| +$/,"",$6); print $4"|"$3"|"$6 }'
}

# ── Wrapper-level pre-flight (cheap, no claude) ───────────────────────────────

[ -d "${REPO}/.git" ] || { log "FATAL: ${REPO} is not a git repo"; exit 1; }
[ -d "${PLAN_DIR}" ] || { log "FATAL: no such plan dir: ${PLAN_DIR}"; exit 1; }
[ -f "${INVENTORY_FILE}" ] || { log "FATAL: ${INVENTORY_FILE} missing"; exit 1; }
[ -f "${VERSION_FILE}" ] || { log "FATAL: ${VERSION_FILE} missing"; exit 1; }

VERSION=$(cat "${VERSION_FILE}" 2>/dev/null || echo "")
NEXT=$(next_step || true)

# --preflight: report and exit WITHOUT invoking claude or taking the lock.
if [ "${MODE}" = "preflight" ]; then
  log "=== plan-tick PREFLIGHT (no claude invoked) ==="
  log "plan dir:    ${PLAN_DIR}"
  log "prompt:      ${PROMPT_FILE} $([ -f "${PROMPT_FILE}" ] && echo present || echo MISSING)"
  log "VERSION:     ${VERSION:-<unset>}"
  if [ -f "${BLOCK_FILE}" ]; then
    log "BLOCKED.md:  PRESENT — a real tick would exit immediately"
  else
    log "BLOCKED.md:  absent"
  fi
  cd "${REPO}"
  DIRTY=$(git status --porcelain | grep -v '^??' || true)
  log "tree:        $([ -n "${DIRTY}" ] && echo dirty || echo clean) (tracked files only)"
  if [ -n "${NEXT}" ]; then
    log "next step:   $(printf '%s' "${NEXT}" | awk -F'|' '{print $2" ("$1") — "$3}')"
  else
    log "next step:   NONE — all steps closed (plan complete)"
  fi
  if [ -z "${AGENT_BIN}" ]; then log "agent CLI:   '${AGENT_PROVIDER}' is not a known agent_provider (real tick would FATAL)"
  elif command -v "${AGENT_BIN}" >/dev/null 2>&1; then log "${AGENT_BIN} CLI:  present"
  else log "${AGENT_BIN} CLI:  MISSING (a real tick would fail with rc=127)"; fi
  LINT="${REPO}/workspace-bin/plan-lint.sh"
  LINT_RC=0
  LINT_LINE="$(bash "${LINT}" "${PLAN_ID}" --summary 2>/dev/null)" || LINT_RC=$?
  case "${LINT_RC}:${LINT_LINE}" in
    0:'conformance: '*' → CONFORMANT'|1:'conformance: '*' → NONCONFORMANT') log "${LINT_LINE}" ;;
    *) log "conformance: ${PLAN_ID} plan-lint did not finish (exit ${LINT_RC}, no verdict)" ;;
  esac
  log "=== end preflight ==="
  exit 0
fi

# ── Real tick ─────────────────────────────────────────────────────────────────

[ -n "${AGENT_BIN}" ] || { log "FATAL: unknown agent_provider '${AGENT_PROVIDER}' (claude, codex or gemini)"; exit 1; }
# A missing agent CLI is not a FATAL here: the run below exits 127 and counts as a
# failed run, so a chain whose CLI vanished blocks after WORKPLAN_FAIL_LIMIT tries
# instead of relaunching forever.
[ -f "${PROMPT_FILE}" ] || { log "FATAL: ${PROMPT_FILE} missing"; exit 1; }
mkdir -p "${TICK_LOG_DIR}"
FAIL_FILE="${TICK_LOG_DIR}/.agent-failures"

TICK_TIMEOUT_DEFAULT=2700
TICK_TIMEOUT="${WORKPLAN_TICK_TIMEOUT:-${TICK_TIMEOUT_DEFAULT}}"
case "${TICK_TIMEOUT}" in
  ''|*[!0-9]*|0) TICK_TIMEOUT=0 ;;
esac
# At or past 3600 s the next launch would reap this tick's lock and run beside it.
if [ "${TICK_TIMEOUT}" -le 0 ] || [ "${TICK_TIMEOUT}" -ge 3600 ]; then
  log "warn: WORKPLAN_TICK_TIMEOUT=${WORKPLAN_TICK_TIMEOUT:-} must be 1..3599 s — using ${TICK_TIMEOUT_DEFAULT}"
  TICK_TIMEOUT=${TICK_TIMEOUT_DEFAULT}
fi
FAIL_LIMIT="${WORKPLAN_FAIL_LIMIT:-3}"
case "${FAIL_LIMIT}" in
  ''|*[!0-9]*|0) log "warn: WORKPLAN_FAIL_LIMIT=${FAIL_LIMIT} is not a positive integer — using 3"; FAIL_LIMIT=3 ;;
esac

# Single-tick lock (mkdir atomicity; macOS has no flock). Reap stale >60min.
# The `plan` file names the holder so the viewer can show which plan is ticking.
if [ -d "${LOCK_DIR}" ]; then
  # GNU first: GNU `stat -f` prints filesystem info to stdout before failing; BSD rejects -c silently.
  LOCK_MTIME=$(stat -c %Y "${LOCK_DIR}" 2>/dev/null || stat -f %m "${LOCK_DIR}" 2>/dev/null || echo 0)
  LOCK_AGE=$(( $(date +%s) - LOCK_MTIME ))
  if [ "${LOCK_AGE}" -lt 3600 ]; then
    log "skip: another tick is already running ($(cat "${LOCK_DIR}/plan" 2>/dev/null || echo '?'), lock age=${LOCK_AGE}s)"; exit 0
  fi
  log "info: reaping stale lock (age=${LOCK_AGE}s)"; rm -rf "${LOCK_DIR}"
fi
mkdir "${LOCK_DIR}" 2>/dev/null || { log "skip: lock race lost"; exit 0; }
# The agent runs in its own process group (so a timeout can kill all of it), which
# also takes it out of the group launchd kills when it stops this job: sweep it here.
AGENT_PGID=""
cleanup() {
  if [ -n "${AGENT_PGID}" ]; then kill -TERM -- "-${AGENT_PGID}" 2>/dev/null || true; fi
  rm -rf "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "${PLAN_ID}" > "${LOCK_DIR}/plan"

maybe_autopause() {
  local reason="$1"
  [ "${WORKPLAN_AUTOPAUSE:-0}" = "1" ] || return 0
  local label="${WORKPLAN_PLIST_LABEL:-ai.openclaw.${PLAN_ID}-tick}"
  local target="gui/$(id -u)/${label}"
  log "auto-pause: ${reason} — disabling ${label}"
  launchctl disable "${target}" >/dev/null 2>&1 || true
  launchctl bootout  "${target}" >/dev/null 2>&1 || true
}

# Safety net: when a tick stalls — exits leaving a dirty tree on a clean VERSION
# without closing the step or writing its own BLOCKED.md — write BLOCKED.md so the
# stall is a LOUD, visible signal (viewer shows blocked + needs-you), never a
# silent auto-pause. The **External action:** field tells the operator what to do.
write_stall_block() {
  local version="$1" dirty="$2"
  [ -f "${BLOCK_FILE}" ] && return 0   # never clobber a real, claude-written block
  local nextdesc; nextdesc=$(printf '%s' "${NEXT}" | awk -F'|' '{print $2": "$3}')
  {
    printf '# CONTINUATION_BLOCKED — %s\n\n' "$(ts)"
    printf '**Step**: %s\n' "${nextdesc:-unknown}"
    printf '**Phase you were in**: unknown — a prior tick exited without closing the step or self-blocking\n'
    printf '**Trigger**: silent stall — tree dirty on clean VERSION=%s\n\n' "${version}"
    printf '## What failed\n\nThe previous tick left uncommitted changes but did not bump VERSION or write BLOCKED.md — the silent half-done state the chain must never enter. The chain auto-paused to avoid compounding it.\n\n'
    printf '**External action:** operator must review the uncommitted work below, then either finish + commit the step or revert it, and delete this file to resume.\n\n'
    printf '## State at block\n\n- VERSION: %s\n- Working tree (git status --short):\n\n  ```\n%s\n  ```\n' "${version}" "$(printf '%s' "${dirty}" | sed 's/^/  /')"
  } > "${BLOCK_FILE}"
  log "wrote ${BLOCK_FILE} — silent-stall safety net (operator action required)"
}

if [ -f "${BLOCK_FILE}" ]; then
  log "skip: ${BLOCK_FILE} present — operator must clear before next tick"
  maybe_autopause "BLOCKED.md present"; exit 0
fi

cd "${REPO}"
# Untracked files are NOT dirt: a stray scratch dir or a concurrent session's new
# files must not trip the stall-block for a chain that never touched them.
# Only dirt inside this plan's own silo is this plan's stall. Tracked edits
# elsewhere (the operator's, or another plan's) skip the tick without blocking
# or pausing it, so a chain re-polls until the tree is clean again.
DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "${DIRTY}" ]; then
  OWN_DIRTY=$(git status --porcelain -- "memory-plan/plans/${PLAN_ID}/" | grep -v '^??' || true)
  case "${VERSION}" in
    *-pre|*-mid) log "info: tree dirty but VERSION=${VERSION} (in-flight); proceeding" ;;
    *) if [ -z "${OWN_DIRTY}" ]; then
         log "skip: tracked changes outside memory-plan/plans/${PLAN_ID}/ — not this plan's stall; not invoking claude"
         printf '%s\n' "${DIRTY}" | sed 's/^/        /'
         exit 0
       fi
       log "skip: tree dirty on clean VERSION=${VERSION} — unexpected; not invoking claude"
       printf '%s\n' "${DIRTY}" | sed 's/^/        /'
       write_stall_block "${VERSION}" "${DIRTY}"
       maybe_autopause "dirty tree on clean VERSION"; exit 0 ;;
  esac
fi

# ── Conformance gate (plan-lint) ─────────────────────────────────────────────
# A nonconformant silo is never driven headless. Before, plan-lint ran only in
# --preflight; the real tick trusted the silo blindly (review: honor-system gate).
# Fails closed: only the lint's two normal endings are a verdict — exit 0 with a
# last line "summary: … → CONFORMANT", exit 1 with "… → NONCONFORMANT". On
# 2026-09-27 the lint aborted under set -e before its summary line, and a gate
# that only looked for NONCONFORMANT let the tick drive the silo.
write_lint_block() {
  local lint_out="$1" trigger="$2" action="$3"
  [ -f "${BLOCK_FILE}" ] && return 0
  {
    printf '# CONTINUATION_BLOCKED — %s\n\n' "$(ts)"
    printf '**Step**: %s\n' "$(printf '%s' "${NEXT}" | awk -F'|' '{print $2": "$3}')"
    printf '**Phase you were in**: pre-tick (wrapper gate)\n'
    printf '**Trigger**: %s\n\n' "${trigger}"
    printf '## What failed\n\n```\n%s\n```\n\n' "${lint_out}"
    printf '**External action:** %s, then delete this file to resume.\n' "${action}"
  } > "${BLOCK_FILE}"
  log "wrote ${BLOCK_FILE} — plan-lint gate (operator action required)"
}
LINT="${REPO}/workspace-bin/plan-lint.sh"
if [ "${WORKPLAN_LINT_GATE:-1}" != "0" ]; then
  LINT_RC=0
  LINT_OUT="$(bash "${LINT}" "${PLAN_ID}" 2>&1)" || LINT_RC=$?
  case "${LINT_RC}:${LINT_OUT##*$'\n'}" in
    0:'summary: '*' → CONFORMANT') ;;
    1:'summary: '*' → NONCONFORMANT')
      log "skip: plan-lint NONCONFORMANT — not invoking claude"
      printf '%s\n' "${LINT_OUT}" | grep -E 'FAIL' | sed 's/^/        /' || true
      write_lint_block "${LINT_OUT}" \
        "plan-lint NONCONFORMANT — the tick refused to drive a silo with FAILs" \
        "fix every FAIL above (run \`workspace-bin/plan-lint.sh ${PLAN_ID}\`)"
      maybe_autopause "plan-lint NONCONFORMANT"; exit 0 ;;
    *)
      log "skip: plan-lint did not finish (exit ${LINT_RC}, no verdict) — not invoking claude"
      write_lint_block "${LINT_OUT}" \
        "plan-lint did not finish (exit ${LINT_RC}, no verdict) — the tick refused to drive a silo it never finished grading" \
        "find why \`workspace-bin/plan-lint.sh ${PLAN_ID}\` stops before its \`summary:\` line (everything it printed is above) and fix it"
      maybe_autopause "plan-lint did not finish"; exit 0 ;;
  esac
fi

if [ -z "${NEXT}" ]; then
  log "skip: no [A]/[ ] rows in inventory — plan fully closed"
  maybe_autopause "plan complete"; exit 0
fi

TICK_LOG="${TICK_LOG_DIR}/$(date '+%Y%m%d-%H%M%S').log"
log "starting tick → ${TICK_LOG}"
log "VERSION=${VERSION:-<unset>}  next=$(printf '%s' "${NEXT}" | awk -F'|' '{print $2}')"

if [ "${DRY_RUN:-0}" = "1" ]; then log "DRY_RUN=1 → not invoking claude"; exit 0; fi

unset CLAUDECODE CLAUDECODE_TICK CLAUDE_CODE_ENTRYPOINT
TICK_RAW="${TICK_LOG%.log}.jsonl"
PRETTY="${REPO}/workspace-bin/memory-plan-pretty-stream.sh"
TICK_START_EPOCH=$(date +%s)
CURRENT_LINK="${TICK_LOG_DIR}/current.log"
ln -sfn "$(basename "${TICK_LOG}")" "${CURRENT_LINK}"
PRE_HEAD=$(git -C "${REPO}" rev-parse -q --verify HEAD 2>/dev/null || true)
# Tracked content, not just clean/dirty: an in-flight -pre/-mid tick starts on a dirty tree.
tree_fingerprint() { { git -C "${REPO}" diff --binary HEAD 2>/dev/null || true; } | cksum; }
PRE_TREE=$(tree_fingerprint)

{
  printf '## Tick started (%s): %s\n' "${PLAN_ID}" "$(ts)"
  printf '## VERSION at start: %s\n' "${VERSION:-<unset>}"
  printf '## Next step: %s\n' "${NEXT}"
  printf '## ─── live %s work ───\n' "${AGENT_PROVIDER}"
  set +e
  # set -m gives the background run its own process group (pgid = its pid), so the
  # wall-clock limit can kill the agent and every tool process it spawned.
  set -m
  (
    run_agent \
      < "${PROMPT_FILE}" \
      | tee "${TICK_RAW}" \
      | { [ -x "${PRETTY}" ] && "${PRETTY}" || cat; }
    exit "${PIPESTATUS[0]}"
  ) &
  AGENT_PGID=$!
  set +m
  AGENT_TIMED_OUT=0
  while kill -0 "${AGENT_PGID}" 2>/dev/null; do
    if [ $(( $(date +%s) - TICK_START_EPOCH )) -ge "${TICK_TIMEOUT}" ]; then
      AGENT_TIMED_OUT=1
      printf '\n## ─── wall-clock limit %ss reached — stopping the agent process group ───\n' "${TICK_TIMEOUT}"
      kill -TERM -- "-${AGENT_PGID}" 2>/dev/null
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        kill -0 -- "-${AGENT_PGID}" 2>/dev/null || break
        sleep 1
      done
      kill -KILL -- "-${AGENT_PGID}" 2>/dev/null
      break
    fi
    sleep 1
  done
  wait "${AGENT_PGID}"
  AGENT_RC=$?
  [ "${AGENT_TIMED_OUT}" = "1" ] && AGENT_RC=124
  set -e
  printf '\n## ─── end %s (rc=%d) ───\n' "${AGENT_PROVIDER}" "${AGENT_RC}"
  printf '## Tick ended: %s\n' "$(ts)"
} >>"${TICK_LOG}" 2>&1

TICK_DURATION=$(( $(date +%s) - ${TICK_START_EPOCH:-0} ))
log "${AGENT_PROVIDER} exited rc=${AGENT_RC:-?} after ${TICK_DURATION}s"

mkdir -p "$(dirname "${DIGEST_FILE}")"
[ -f "${DIGEST_FILE}" ] || printf '# %s plan — Progress digest\n\nOne line per autonomous tick. Newest at bottom.\n\n' "${PLAN_ID}" > "${DIGEST_FILE}"
POST_VERSION=$(cat "${VERSION_FILE}" 2>/dev/null || echo "?")
LATEST_COMMIT=$(git -C "${REPO}" log -1 --format='%h %s' 2>/dev/null || echo "?")

# The tick's own verdict outranks its exit status: a run that wrote BLOCKED.md or moved
# VERSION is a good run, whatever the agent CLI returned.
if [ -f "${BLOCK_FILE}" ] || [ "${POST_VERSION}" != "${VERSION:-}" ]; then
  rm -f "${FAIL_FILE}"
fi

# ── Close gate (mechanical done-contract, MASTER_PLAN §5) ────────────────────
# Before: the wrapper declared a step "closed" because the VERSION string changed
# to something without -pre/-mid — a self-written string, no tests, no evidence
# (review: the tick was judge of its own done-ness). Now a close is accepted only
# if the closing commit carries a Runtime-Evidence: trailer AND the close check
# (default `npm test`; WORKPLAN_CLOSE_CHECK overrides, `none` disables loudly;
# the viewer exports it from the plan's automation.json `close_check`)
# is green. A refused close writes BLOCKED.md so the chain stops and the operator
# decides; nothing is auto-reverted.
close_gate() {
  local reasons=() cmd close_sha
  # The closing commit is the one that last touched VERSION (as plan-lint grades it),
  # not HEAD: HEAD may be an earlier close, or a later commit from elsewhere.
  if ! git -C "${REPO}" diff --quiet HEAD -- "${VERSION_FILE}" 2>/dev/null; then
    reasons+=("VERSION ${POST_VERSION} is not committed")
  fi
  close_sha=$(git -C "${REPO}" log -1 --format='%H' -- "${VERSION_FILE}" 2>/dev/null || true)
  if [ -z "${close_sha}" ] || ! git -C "${REPO}" log -1 --format='%B' "${close_sha}" 2>/dev/null | grep -qE '^Runtime-Evidence:'; then
    reasons+=("closing commit (${close_sha:0:7}) carries no Runtime-Evidence: trailer")
  fi
  cmd="${WORKPLAN_CLOSE_CHECK:-npm test}"
  if [ "${cmd}" = "none" ]; then
    log "close gate: WORKPLAN_CLOSE_CHECK=none — test check DISABLED by operator"
  else
    log "close gate: running '${cmd}'"
    if ! (cd "${REPO}" && OPENCLAW_NO_EMBED_MODEL="${OPENCLAW_NO_EMBED_MODEL:-1}" bash -c "${cmd}") >>"${TICK_LOG}" 2>&1; then
      reasons+=("close check '${cmd}' failed — see ${TICK_LOG}")
    fi
  fi
  [ "${#reasons[@]}" -eq 0 ] && return 0
  # A run can close its step and then block in the macro re-orient: keep the agent's
  # block (its External action stays the headline) and add the refusal below it.
  if [ -f "${BLOCK_FILE}" ]; then
    {
      printf '\n## Close gate refused (post-tick wrapper gate, %s)\n\n' "$(ts)"
      printf -- '- %s\n' "${reasons[@]}"
      printf '\nThe tick advanced VERSION %s → %s but the done-contract does not hold: supply the evidence or revert the close before resuming.\n' "${VERSION:-?}" "${POST_VERSION}"
    } >> "${BLOCK_FILE}"
  else
    {
      printf '# CONTINUATION_BLOCKED — %s\n\n' "$(ts)"
      printf '**Step**: %s\n' "$(printf '%s' "${NEXT}" | awk -F'|' '{print $2": "$3}')"
      printf '**Phase you were in**: close (post-tick wrapper gate)\n'
      printf '**Trigger**: close gate refused VERSION %s → %s\n\n' "${VERSION:-?}" "${POST_VERSION}"
      printf '## What failed\n\n'
      printf -- '- %s\n' "${reasons[@]}"
      printf '\n**External action:** the tick advanced VERSION but the done-contract does not hold. Either supply the evidence (amend the trailer / fix the suite) or revert the close, then delete this file to resume.\n'
    } > "${BLOCK_FILE}"
  fi
  return 1
}

# Ahead of the BLOCKED.md exit, so a run that closed and then blocked is graded too.
CLOSED=0
if [ "${POST_VERSION}" != "${VERSION:-}" ] && printf '%s' "${POST_VERSION}" | grep -qvE -- '-pre$|-mid$'; then
  if close_gate; then
    CLOSED=1
  else
    printf -- '- `%s` CLOSE REFUSED at `%s` — see BLOCKED.md\n' "$(ts)" "${POST_VERSION}" >> "${DIGEST_FILE}"
    log "close gate refused — see ${BLOCK_FILE}"; exit 2
  fi
fi

if [ -f "${BLOCK_FILE}" ]; then
  TRIG=$(grep -m1 '^\*\*Trigger\*\*:' "${BLOCK_FILE}" 2>/dev/null | sed 's/^\*\*Trigger\*\*: //' | cut -c1-120)
  printf -- '- `%s` BLOCKED at `%s` — %s\n' "$(ts)" "${POST_VERSION}" "${TRIG:-see BLOCKED.md}" >> "${DIGEST_FILE}"
  log "tick blocked — see ${BLOCK_FILE}"; exit 2
fi

if [ "${CLOSED}" = 1 ]; then
  printf -- '- `%s` closed `%s` — %s\n' "$(ts)" "${POST_VERSION}" "${LATEST_COMMIT}" >> "${DIGEST_FILE}"
elif [ "${POST_VERSION}" != "${VERSION:-}" ]; then
  printf -- '- `%s` progress: `%s` → `%s`\n' "$(ts)" "${VERSION:-?}" "${POST_VERSION}" >> "${DIGEST_FILE}"
fi

# ── Failed agent runs (any agent CLI) ────────────────────────────────────────
# Before: the exit status was only logged and the wrapper exited 0, so under chain
# mode (launchd KeepAlive, 30 s throttle) a CLI that failed at once — signed out,
# out of quota, crashed, missing — relaunched ~2,880 times a day. A failed run is a
# non-zero exit (124 = wall-clock limit, 127 = could not be started), or exit 0
# that left VERSION, HEAD and the tracked tree as they were without answering.
# "Answering" is the provider's own answer read from its stream (lib/agent-stream.js),
# not any output: init, usage and empty result records counted as output, so a CLI
# that answered nothing reset the count every time. Failures in a row are counted
# in FAIL_FILE; any good run resets it. Below FAIL_LIMIT the wrapper exits 1 so
# launchd's LastExitStatus shows it; at FAIL_LIMIT it blocks and pauses the chain.
AGENT_FAILURE=""
if [ "${POST_VERSION}" = "${VERSION:-}" ]; then
  case "${AGENT_RC}" in
    0)
      if [ "$(git -C "${REPO}" rev-parse -q --verify HEAD 2>/dev/null || true)" = "${PRE_HEAD}" ] \
        && [ "$(tree_fingerprint)" = "${PRE_TREE}" ]; then
        ANSWER_RC=0
        ANSWER_WHY=$(node "${REPO}/lib/agent-stream.js" "${AGENT_PROVIDER}" "${TICK_RAW}" 2>&1) || ANSWER_RC=$?
        ANSWER_WHY=${ANSWER_WHY%%$'\n'*}
        case "${ANSWER_RC}" in
          0) ;;
          1) AGENT_FAILURE="exited 0 without an answer (${ANSWER_WHY}) and changed nothing" ;;
          *) AGENT_FAILURE="exited 0 and changed nothing, and its answer could not be checked (rc=${ANSWER_RC}: ${ANSWER_WHY:-no output})" ;;
        esac
      fi ;;
    124) AGENT_FAILURE="ran past the ${TICK_TIMEOUT}s wall-clock limit and was stopped (rc=124)" ;;
    126|127) AGENT_FAILURE="could not be started (rc=${AGENT_RC})" ;;
    *) AGENT_FAILURE="exited rc=${AGENT_RC}" ;;
  esac
fi

agent_fix_hint() {
  case "${AGENT_RC}" in
    126|127) printf 'the agent CLI `%s` is not installed, not executable, or not on the PATH this job runs with (launchd units get a minimal PATH): install it or add its directory to the unit PATH' "${AGENT_BIN}" ;;
    124) printf 'the run hung past the %ss limit: read the last log for where it stalled, review any uncommitted work it left, and raise WORKPLAN_TICK_TIMEOUT (max 3599) only if the step genuinely needs longer' "${TICK_TIMEOUT}" ;;
    0) printf 'the agent CLI `%s` gave no answer and changed nothing: read its stream (%s), then run it by hand on this plan TICK_PROMPT.md to see what it does' "${AGENT_BIN}" "${TICK_RAW}" ;;
    *) printf 'sign the agent CLI `%s` in again (run it interactively), check the account quota or billing, or read the last log for a crash' "${AGENT_BIN}" ;;
  esac
}

if [ -n "${AGENT_FAILURE}" ]; then
  FAILS=$(cat "${FAIL_FILE}" 2>/dev/null || true)
  case "${FAILS}" in ''|*[!0-9]*) FAILS=0 ;; esac
  FAILS=$(( FAILS + 1 ))
  printf '%s\n' "${FAILS}" > "${FAIL_FILE}"
  if [ "${FAILS}" -lt "${FAIL_LIMIT}" ]; then
    printf -- '- `%s` agent run failed (%s/%s): %s %s\n' "$(ts)" "${FAILS}" "${FAIL_LIMIT}" "${AGENT_BIN}" "${AGENT_FAILURE}" >> "${DIGEST_FILE}"
    log "agent run failed (${FAILS}/${FAIL_LIMIT} in a row): ${AGENT_BIN} ${AGENT_FAILURE} — see ${TICK_LOG}"
    exit 1
  fi
  {
    printf '# CONTINUATION_BLOCKED — %s\n\n' "$(ts)"
    printf '**Step**: %s\n' "$(printf '%s' "${NEXT}" | awk -F'|' '{print $2": "$3}')"
    printf '**Phase you were in**: agent run (post-tick wrapper check)\n'
    printf '**Trigger**: agent CLI %s failed %s runs in a row — last: %s\n\n' "${AGENT_BIN}" "${FAILS}" "${AGENT_FAILURE}"
    printf '## What failed\n\n'
    printf -- '- Agent CLI: `%s`\n- Last exit code: %s\n- Last log: %s\n- Failures in a row: %s (WORKPLAN_FAIL_LIMIT=%s)\n\n' \
      "${AGENT_BIN}" "${AGENT_RC}" "${TICK_LOG}" "${FAILS}" "${FAIL_LIMIT}"
    printf '**External action:** %s, then delete this file to resume.\n' "$(agent_fix_hint)"
  } > "${BLOCK_FILE}"
  rm -f "${FAIL_FILE}"
  printf -- '- `%s` BLOCKED at `%s` — agent CLI %s failed %s runs in a row\n' "$(ts)" "${POST_VERSION}" "${AGENT_BIN}" "${FAILS}" >> "${DIGEST_FILE}"
  log "wrote ${BLOCK_FILE} — agent CLI ${AGENT_BIN} failed ${FAILS} runs in a row (operator action required)"
  maybe_autopause "agent CLI failed ${FAILS} runs in a row"; exit 2
fi
rm -f "${FAIL_FILE}"

log "tick done (rc=${AGENT_RC:-?})"
exit 0
