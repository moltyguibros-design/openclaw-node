#!/usr/bin/env node

/**
 * consolidation-scheduler.mjs — Schedules consolidation cycles during quiet periods.
 *
 * Launchd (StartInterval 1800) or the systemd timer fires this script every 30 minutes.
 * The script checks whether the system is idle (no active LLM inference),
 * then requests cancellation after 5 minutes and waits for local completion.
 *
 * Idle detection has two paths:
 *   - In-process: reads ollama-queue.getState() directly (an importer passes getStateFn)
 *   - Standalone: reads the daemon's fresh exported queue-state snapshot
 *
 * Usage:
 *   node bin/consolidation-scheduler.mjs [--db <path>] [--vault-path <path>] [--interval <ms>] [--daemon] [--no-events]
 */

import { resolveNodeId } from '../lib/node-id.js';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { QUEUE_STATE_PATH, readStateSnapshot } from '../lib/ollama-queue.mjs';
import { cycleRemovals, formatRemoval, summarizeRemovals } from '../lib/consolidation.mjs';

const _require = createRequire(import.meta.url);

// A failed consolidation cycle breaks the memory cadence silently (launchd
// just restarts the one-shot) — escalate it to a ledgered desktop popup.
const NOTIFY_CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'openclaw-notify.mjs');
const MC_MEMORY_URL = `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/memory`;
function notifyCycleFailure(message) {
  return new Promise(resolve => {
    execFile(process.execPath, [
      NOTIFY_CLI, '--source', 'consolidation', '--kind', 'error',
      '--title', 'Consolidation cycle FAILED', '--message', message,
      '--url', MC_MEMORY_URL, '--foreground',
    ], () => resolve());
  });
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Quiet period after the last finished extraction (queue extraction or worker flush). */
export const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Cancellation deadline; local cleanup still owns the invocation. */
export const HARD_CAP_MS = 5 * 60 * 1000; // 5 minutes

/** No analysis activity within this window to qualify as idle. */
export const ANALYSIS_QUIET_MS = 60 * 1000; // 60 seconds

/** Default scheduler interval (30 minutes). */
export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

// ─── Idle Detection: In-process Queue ───────────────────────────────────────

/**
 * Check if the ollama-queue reports idle state.
 * Requires a getState function from the in-process ollama-queue singleton.
 *
 * @param {() => object} getStateFn — ollama-queue.getState
 * @returns {{ idle: boolean, reason: string|null }}
 */
export function isQueueIdle(getStateFn) {
  const state = getStateFn();

  // Current job running → not idle
  if (state.current_job) {
    return { idle: false, reason: `active ${state.current_job.type} job (elapsed ${state.current_job.elapsed_ms}ms)` };
  }

  // Pending jobs → not idle
  if (state.queue_depth > 0) {
    return { idle: false, reason: `${state.queue_depth} pending jobs` };
  }

  // Worker-thread jobs (P5-3): extraction runs off the main thread with its
  // own queue; the parent registers them as external jobs. Consolidating
  // while one is open means two writers on the same DB.
  const external = Array.isArray(state.external_jobs) ? state.external_jobs : [];
  if (external.length > 0) {
    const j = external[0];
    return { idle: false, reason: `${external.length} worker ${j.type} job(s) running (elapsed ${j.elapsed_ms}ms)` };
  }

  // Quiet periods after the last finished extraction (a queue extraction or a
  // worker flush) and the last finished analysis. A worker import is a parse,
  // not an extraction, and holds no quiet period.
  const now = Date.now();
  const last = state.last_completed_at || {};
  const lastExtraction = Math.max(last.extraction || 0, last.flush || 0);
  if (lastExtraction && now - lastExtraction < IDLE_THRESHOLD_MS) {
    return { idle: false, reason: `extraction finished ${Math.round((now - lastExtraction) / 1000)}s ago (quiet period ${IDLE_THRESHOLD_MS / 1000}s)` };
  }
  if (last.analysis && now - last.analysis < ANALYSIS_QUIET_MS) {
    return { idle: false, reason: `analysis finished ${Math.round((now - last.analysis) / 1000)}s ago (quiet period ${ANALYSIS_QUIET_MS / 1000}s)` };
  }

  // Recent analysis activity — check recent fallbacks/alarms for recency
  const recentAnalysis = state.recent_fallbacks.filter(
    f => (now - f.ts) < ANALYSIS_QUIET_MS
  );
  if (recentAnalysis.length > 0) {
    return { idle: false, reason: `analysis activity within last ${ANALYSIS_QUIET_MS / 1000}s` };
  }

  return { idle: true, reason: null };
}

// ─── Combined Idle Check ────────────────────────────────────────────────────

/**
 * Determine if the system is idle enough to run a consolidation cycle.
 *
 * @param {object} [opts]
 * @param {() => object} [opts.getStateFn] — in-process queue state function
 * @param {(path: string) => object|null} [opts.readStateSnapshotFn]
 * @param {string} [opts.queueStatePath]
 * @returns {Promise<{ idle: boolean, reason: string|null }>}
 */
export async function isSystemIdle(opts = {}) {
  if (opts.getStateFn) {
    return isQueueIdle(opts.getStateFn);
  }

  const readSnapshot = opts.readStateSnapshotFn || readStateSnapshot;
  const snapshot = readSnapshot(opts.queueStatePath || QUEUE_STATE_PATH);
  if (!snapshot) return { idle: false, reason: 'daemon queue snapshot missing or stale' };
  return isQueueIdle(() => snapshot);
}

// ─── Run With Timeout ───────────────────────────────────────────────────────

/**
 * Request cancellation at the deadline and wait for cycle settlement.
 *
 * @param {object} [opts]
 * @param {string} [opts.dbPath] — extraction store DB path
 * @param {string} [opts.vaultPath] — Obsidian vault path
 * @param {number} [opts.hardCapMs] — timeout in ms (default HARD_CAP_MS)
 * @param {object} [opts.db] — pre-opened database (for testing)
 * @param {(opts: object) => Promise<object>} [opts.runCycle] — injectable cycle function (for testing)
 * @returns {Promise<{ ok: boolean, result?: object, error?: string, durationMs: number }>}
 */
export async function runScheduledCycle(opts = {}) {
  const hardCap = opts.hardCapMs ?? HARD_CAP_MS;
  const startMs = Date.now();

  // Dynamically import runConsolidationCycle unless injected
  const runCycle = opts.runCycle || (await import('./consolidate.mjs')).runConsolidationCycle;

  // The summary stage was structurally LLM-less: no caller ever passed a
  // client, so every scheduled cycle ran data-only and concept prose could
  // never arrive (found 2026-07-16). The idle gate has already verified
  // Ollama is free by the time a cycle starts — hand the cycle a client.
  let client = opts.client ?? null;
  if (!client) {
    try { client = (await import('../lib/llm-client.mjs')).createLlmClient(); } catch { /* data-only */ }
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('hard cap')), hardCap);

  let result;
  try {
    result = await runCycle({
      dbPath: opts.dbPath,
      vaultPath: opts.vaultPath,
      db: opts.db,
      // Every 30 min, synchronous, inside the hard cap: quick_check, not the
      // full scan the daemon ran at boot.
      integrityCheck: 'quick',
      client,
      signal: ac.signal,
      eventLog: opts.eventLog,
      nodeId: opts.nodeId,
    });

    if (ac.signal.aborted || Date.now() - startMs >= hardCap) {
      throw new Error(`consolidation cycle exceeded hard cap (${hardCap}ms)`);
    }
    return { ok: true, result, durationMs: Date.now() - startMs };
  } catch (err) {
    return {
      ok: false,
      error: ac.signal.aborted ? `consolidation cycle exceeded hard cap (${hardCap}ms)` : err.message,
      durationMs: Date.now() - startMs,
      // An overrun still settles with the phases it ran: the profile of the overrun.
      ...(result ? { result } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** ` [phases: decay=12ms summaries=290100ms ...]`, or '' when the cycle reported none. */
export function formatPhaseTimes(result) {
  const phases = Object.entries(result?.phaseMs || {});
  return phases.length ? ` [phases: ${phases.map(([name, ms]) => `${name}=${ms}ms`).join(' ')}]` : '';
}

// ─── Scheduler Factory ──────────────────────────────────────────────────────

/**
 * Create an interval-based consolidation scheduler.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] — check interval (default 30 min)
 * @param {string} [opts.dbPath]
 * @param {string} [opts.vaultPath]
 * @param {() => object} [opts.getStateFn] — in-process queue state
 * @param {(path: string) => object|null} [opts.readStateSnapshotFn]
 * @param {string} [opts.queueStatePath]
 * @param {number} [opts.hardCapMs]
 * @param {(msg: string) => void} [opts.log] — logger
 * @param {(opts: object) => Promise<object>} [opts.runCycle] — injectable cycle function (for testing)
 * @param {boolean} [opts.keepAlive] — keep the interval ref'd (CLI --daemon; NATS may be absent)
 * @param {(result: object) => Promise<unknown>} [opts.onCycleComplete] — after each successful cycle
 * @returns {{ start: () => void, stop: () => Promise<void>, runOnce: () => Promise<object> }}
 */
export function createConsolidationScheduler(opts = {}) {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const log = opts.log || console.log;
  let timer = null;
  let activeRun = null;
  let stopped = false;

  async function performRun() {
    const idleCheck = await isSystemIdle({
      getStateFn: opts.getStateFn,
      readStateSnapshotFn: opts.readStateSnapshotFn,
      queueStatePath: opts.queueStatePath,
    });

    if (!idleCheck.idle) {
      log(`[consolidation-scheduler] skipping: ${idleCheck.reason}`);
      return { skipped: true, reason: idleCheck.reason };
    }

    log('[consolidation-scheduler] system idle — starting consolidation cycle');
    const result = await runScheduledCycle({
      dbPath: opts.dbPath,
      vaultPath: opts.vaultPath,
      hardCapMs: opts.hardCapMs,
      eventLog: opts.eventLog,
      nodeId: opts.nodeId,
      runCycle: opts.runCycle,
    });

    if (result.ok) {
      // The audit trail: every row this cycle took out of the live tables,
      // then the counts, in the launchd log that outlives the process.
      for (const r of cycleRemovals(result.result)) log(`[consolidation-scheduler] ${formatRemoval(r)}`);
      const summary = summarizeRemovals(result.result);
      log(`[consolidation-scheduler] cycle complete (${result.durationMs}ms)${summary ? `: ${summary}` : ''}${formatPhaseTimes(result.result)}`);
      if (opts.onCycleComplete) {
        try {
          await opts.onCycleComplete(result.result);
        } catch (err) {
          log(`[consolidation-scheduler] post-cycle hook failed: ${err.message}`);
        }
      }
    } else {
      log(`[consolidation-scheduler] cycle failed: ${result.error} (${result.durationMs}ms)${formatPhaseTimes(result.result)}`);
      await (opts.notifyFailure || notifyCycleFailure)(`${result.error} (${result.durationMs}ms)`);
    }

    return result;
  }

  async function runOnce() {
    if (stopped) return { skipped: true, reason: 'scheduler stopped' };
    if (activeRun) return { skipped: true, reason: 'consolidation already running' };
    activeRun = Promise.resolve().then(performRun);
    try {
      return await activeRun;
    } finally {
      activeRun = null;
    }
  }

  function start() {
    if (timer || stopped) return;
    log(`[consolidation-scheduler] started (interval: ${intervalMs / 1000}s)`);
    timer = setInterval(() => {
      runOnce().catch(err => log(`[consolidation-scheduler] error: ${err.message}`));
    }, intervalMs);
    // Embedded in the memory daemon the timer must not hold the process open;
    // the CLI --daemon has nothing else holding it when NATS is absent.
    if (!opts.keepAlive) timer.unref();
  }

  async function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    await activeRun;
    log('[consolidation-scheduler] stopped');
  }

  return { start, stop, runOnce };
}

// ─── CLI Summary ────────────────────────────────────────────────────────────

/** The single-shot run's summary, one line per stage (unstamped). */
export function cliSummaryLines(result) {
  const lines = [`Consolidation complete (${result.durationMs}ms)`];
  const r = result.result;
  if (!r) return lines;
  lines.push(`  Decayed: ${r.decayed?.decayedEntities ?? '?'} entities, ${r.decayed?.decayedDecisions ?? '?'} decisions, ${r.decayed?.archivedEntities ?? '?'} entities archived`);
  if (r.pruned?.skipped) lines.push(`  Pruned: skipped (${r.pruned.skipped})`);
  else lines.push(`  Pruned: ${r.pruned?.archivedDecisions ?? '?'} decisions archived, ${r.pruned?.prunedThemes ?? '?'} idle themes deleted${r.pruned?.themesSkipped ? ` — idle themes kept (${r.pruned.themesSkipped})` : ''}${r.pruned?.backup ? ` — backup ${r.pruned.backup.path}` : ''}`);
  lines.push(`  Reinforced: ${r.reinforced?.reinforcedEntities ?? '?'} entities`);
  lines.push(`  Clusters: ${r.clusters?.clusters?.length ?? '?'} detected`);
  lines.push(`  Contradictions: ${r.contradictions?.total ?? '?'} found`);
  lines.push(`  Promotion: ${r.promotionCandidates?.entityCandidates?.length ?? '?'} entities, ${r.promotionCandidates?.decisionCandidates?.length ?? '?'} decisions`);
  return lines;
}

// The observer's activity feed (lib/observer.mjs) only records log lines that
// carry the memory daemon's `[YYYY-MM-DD, HH:MM:SS]` stamp, read as the same
// local time, so the zone follows the daemon's chain (memory-daemon.mjs).
export function stampLine(msg, date = new Date(), timeZone = process.env.OPENCLAW_TIMEZONE || process.env.TZ || 'America/Montreal') {
  const ts = date.toLocaleString('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  return `[${ts}] ${msg}`;
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consolidation-scheduler.mjs')) {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  const vaultIdx = args.indexOf('--vault-path');
  const intervalIdx = args.indexOf('--interval');
  const daemon = args.includes('--daemon');
  const noEvents = args.includes('--no-events');

  const natsUrl = process.env.NATS_URL || undefined; // URL override only; resolver supplies URL + credentials
  const nodeId = resolveNodeId();

  const cliOpts = { nodeId, keepAlive: daemon };
  if (dbIdx !== -1 && args[dbIdx + 1]) cliOpts.dbPath = args[dbIdx + 1];
  if (vaultIdx !== -1 && args[vaultIdx + 1]) cliOpts.vaultPath = args[vaultIdx + 1];
  if (intervalIdx !== -1 && args[intervalIdx + 1]) cliOpts.intervalMs = Number(args[intervalIdx + 1]);

  let nc = null;

  if (!noEvents) {
    try {
      const { connect } = await import('nats');
      const { createLocalEventLog } = await import('../lib/local-event-log.mjs');
      const { natsConnectOpts } = _require('../lib/nats-resolve.js');
      const connectOpts = natsConnectOpts({ servers: natsUrl, name: 'consolidation-scheduler', timeout: 5000 });
      nc = await connect(connectOpts);
      cliOpts.eventLog = await createLocalEventLog(nc, nodeId);
      console.log(`NATS connected (${connectOpts.servers}), events will be emitted.`);
    } catch (err) {
      console.warn(`NATS unavailable (${err.message}); running without event emission.`);
    }
  }

  const scheduler = createConsolidationScheduler(cliOpts);

  const cleanup = async () => {
    if (nc) { try { await nc.flush(); await nc.close(); } catch {} }
  };

  if (daemon) {
    // Long-running mode: run on interval
    scheduler.start();

    const shutdown = async () => {
      await scheduler.stop();
      await cleanup();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    // Single-shot mode (default for launchd): check idle → run → exit
    scheduler.runOnce()
      .then(async result => {
        if (result.skipped) {
          console.log(`Skipped: ${result.reason}`);
        } else if (result.ok) {
          for (const line of cliSummaryLines(result)) console.log(stampLine(line));
        } else {
          console.error(`Consolidation failed: ${result.error} (${result.durationMs}ms)`);
          await cleanup();
          process.exit(1);
        }
        await cleanup();
      })
      .catch(async err => {
        console.error(`Fatal: ${err.message}`);
        await cleanup();
        process.exit(1);
      });
  }
}
