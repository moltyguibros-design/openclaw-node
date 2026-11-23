#!/usr/bin/env node
/**
 * memory-daemon.mjs — OpenClaw platform-level memory lifecycle daemon (v3)
 *
 * Long-running Node.js process that detects activity from ANY frontend
 * by polling JSONL transcript mtimes. No touchfiles. No hooks required.
 *
 * Session lifecycle: ENDED → BOOT → ACTIVE → IDLE → ENDED
 *
 * Phases:
 *   0. Session-start bootstrap (once per new session)
 *      - Opens the node memory session (memory-budget session events)
 *      - Imports sessions into SQLite archive (session-store)
 *   1. Status sync (every tick when active, ~5ms)
 *   2. Throttled background work (recap 10min, maintenance 30min,
 *      obsidian-sync 30min, session-import 10min)
 *
 * v3 additions (Hermes-inspired):
 *   - Pre-compression memory flush (durable fact extraction before context loss)
 *   - MEMORY.md character budget
 *   - SQLite session archive with FTS5 for episodic recall
 *
 * Install: install.sh (scripts/install/services.sh renders the launchd/systemd unit)
 * Manual:  node bin/memory-daemon.mjs [--verbose]
 */

import { fileURLToPath } from 'url';
import { Worker } from 'worker_threads';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { resolveNodeId } from '../lib/node-id.js';

// --- Tracer ---
const require = createRequire(import.meta.url);
const { createTracer } = require('../lib/tracer');
const tracer = createTracer('memory-daemon');

// --- Hermes-inspired modules ---
import { USE_LLM_EXTRACTION } from '../lib/pre-compression-flush.mjs';
import { createBudget } from '../lib/memory-budget.mjs';
import { createSessionTraceEmitter } from './session-trace-emitter.mjs';
import { SessionTracker, STATES } from '../lib/session-tracker.mjs';
import { renderCompanionState } from '../lib/companion-state.mjs';
import { createLocalEventLog, buildMemoryEvent } from '../lib/local-event-log.mjs';
import { createLlmClient, DEFAULT_MODEL } from '../lib/llm-client.mjs';
import { createExtractionStore } from '../lib/extraction-store.mjs';
import { createExtractionTrigger } from '../lib/extraction-trigger.mjs';
import { ensureSharedStream, inspectSharedStream, verifySharedStreamConfig } from '../lib/shared-event-stream.mjs';
import { NATS_RECONNECT_OPTS } from '../lib/federation-resilience.mjs';
import { createConcurrencyGuard } from '../lib/concurrency-guard.mjs';
import { exportStateSnapshot, setStateObserver, markExternalJob, clearExternalJob, foldWorkerQueueState, applyWorkerLlmMessage } from '../lib/ollama-queue.mjs';
import { loadEventSchemas } from '../lib/event-schemas.mjs';
import { createMemoryWatcher, runStoreHealthProbes, appendWatcherRecord } from '../lib/memory-watcher.mjs';
import { initDatabase as initKnowledgeDb } from '../lib/mcp-knowledge/core.mjs';
import { createGraphCache } from '../bin/obsidian-graph-cache.mjs';
import { memoryDaemonPaths } from '../lib/memory-daemon-paths.mjs';

const traceEmitter = createSessionTraceEmitter(tracer);

// LLM client + extraction store (initialized lazily when USE_LLM_EXTRACTION is true)
let _llmClient = null;
let _extractionStore = null;
function getLlmClient() {
  if (!USE_LLM_EXTRACTION) return null;
  if (!_llmClient) {
    _llmClient = createLlmClient();
    log(`LLM client initialized (USE_LLM_EXTRACTION=true)`);
  }
  return _llmClient;
}
function getExtractionStore() {
  if (!USE_LLM_EXTRACTION) return null;
  if (!_extractionStore) {
    try {
      _extractionStore = createExtractionStore({ dbPath: PATHS.stateDb });
      log(`Extraction store initialized`);
    } catch (err) {
      log(`extraction-store unavailable: ${err.message}`);
      return null;
    }
  }
  return _extractionStore;
}

// HyperAgent store loaded lazily (requires better-sqlite3)
let _haStore = null;
async function getHyperAgentStore() {
  if (_haStore) return _haStore;
  try {
    const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
    _haStore = createHyperAgentStore({ dbPath: PATHS.stateDb });
    console.log('[memory-daemon] HyperAgent store initialized');
    return _haStore;
  } catch (err) {
    log(`hyperagent-store unavailable: ${err.message}`);
    return null;
  }
}

// Knowledge DB loaded lazily (requires sqlite-vec native dep from mcp-knowledge)
let _knowledgeDb = null;
function getKnowledgeDb() {
  if (_knowledgeDb) return _knowledgeDb;
  try {
    _knowledgeDb = initKnowledgeDb(PATHS.knowledgeDb);
    log('Knowledge DB initialized');
    return _knowledgeDb;
  } catch (err) {
    log(`knowledge-db unavailable: ${err.message}`);
    return null;
  }
}

// Graph cache loaded lazily (for spreading-activation channel 5 freshness)
let _graphCache = null;
function getGraphCache() {
  if (_graphCache) return _graphCache;
  try {
    _graphCache = createGraphCache({ dbPath: PATHS.graphCacheDb, extractionStore: getExtractionStore() }); // P2: merge LLM typed edges
    log('Graph cache initialized');
    return _graphCache;
  } catch (err) {
    log(`graph-cache unavailable: ${err.message}`);
    return null;
  }
}

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================

// One derivation for every daemon (lib/node-id). The raw-hostname fallback
// produced ids that failed the event envelope regex and split the node's
// identity across processes (review I13/P10).
const NODE_ID = resolveNodeId();
const PATHS = memoryDaemonPaths();
const WORKSPACE = PATHS.workspace || path.dirname(__dirname);
const HOME = os.homedir();
const CONFIG_PATH = PATHS.config;
const TRANSCRIPT_REGISTRY = PATHS.transcriptSources;
// The unit renders TZ from OPENCLAW_TIMEZONE; daemon.json's timezone, once
// loaded, governs the daemon's dates, its log stamps and its children's TZ.
const TIMEZONE = process.env.OPENCLAW_TIMEZONE || process.env.TZ || 'America/Montreal';
let timezone = TIMEZONE;

function loadConfig() {
  const defaults = {
    timezone: TIMEZONE,
    intervals: {
      pollMs: 30000,
      activityWindowMs: 900000,   // 15 min
      activeThresholdMs: 300000,  // 5 min
      idleThresholdMs: 900000,    // 15 min
      sessionRecapMs: 600000,     // 10 min
      maintenanceMs: 1800000,     // 30 min
      obsidianSyncMs: 1800000,    // 30 min
      synthesisMs: 1800000,       // 30 min — interval synthesis during active sessions (D2)
    },
    contextWindowTokens: 200000,     // active model's context window (override per LLM)
    memoryCharBudget: 2200,           // MEMORY.md character cap
    clawvaultBin: 'bin/clawvault-local',
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      const merged = {
        ...defaults,
        ...loaded,
        intervals: { ...defaults.intervals, ...loaded.intervals },
      };
      console.log(`[memory-daemon] Config loaded from ${CONFIG_PATH}`);
      return merged;
    } catch (err) { console.warn(`[memory-daemon] config parse failed: ${err.message}`); }
  }
  console.log('[memory-daemon] Using default config');
  return defaults;
}

function resolvePath(p) {
  if (p.startsWith('~')) return path.join(HOME, p.slice(1));
  return p;
}

// ============================================================
// LOGGING
// ============================================================

const STATE_DIR = path.join(WORKSPACE, '.tmp');
const LOG_FILE = path.join(STATE_DIR, 'memory-daemon.log');
const VERBOSE = process.argv.includes('--verbose');

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(path.join(STATE_DIR, 'active-sessions'), { recursive: true });
}

function timestamp() {
  return new Date().toLocaleString('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function log(msg) {
  const line = `[${timestamp()}] ${msg}`;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* Intentional: ignore log write failures to avoid recursion */ }
  if (VERBOSE) console.log(line);
}

// ============================================================
// TRANSCRIPT SOURCE REGISTRY
// ============================================================

function loadTranscriptSources() {
  if (fs.existsSync(TRANSCRIPT_REGISTRY)) {
    try {
      const reg = JSON.parse(fs.readFileSync(TRANSCRIPT_REGISTRY, 'utf-8'));
      return (reg.sources || [])
        .filter(s => s.enabled !== false)
        .map(s => ({ ...s, path: resolvePath(s.path) }));
    } catch (err) { console.warn(`[memory-daemon] transcript registry parse failed: ${err.message}`); }
  }

  // Legacy fallback: derive Claude Code paths from workspace
  const workspaceAbs = fs.realpathSync(WORKSPACE);
  const slug = workspaceAbs.replace(/[/.]/g, '-');
  return [
    { name: 'claude-code', path: path.join(HOME, '.claude/projects', slug), format: 'claude-code' },
    { name: 'claude-home', path: path.join(HOME, '.claude/projects', '-' + path.basename(HOME)), format: 'claude-code' },
    { name: 'gateway', path: PATHS.gatewaySessions, format: 'openclaw-gateway' },
  ];
}

// ============================================================
// ACTIVITY DETECTION
// Polls JSONL mtimes from registered transcript sources.
// No touchfiles. No hooks. The JSONL write IS the heartbeat.
// ============================================================

const _missingSourceWarned = new Set();

function _detectActivity(sources, activityWindowMs) {
  const now = Date.now();
  const cutoff = now - activityWindowMs;
  let active = false;
  let newestMtime = 0;
  let newestSource = null;
  const recentFiles = [];
  const activeSessions = [];

  for (const source of sources) {
    if (!fs.existsSync(source.path)) {
      // An enabled source whose dir doesn't exist is a config failure, not a
      // quiet day. Silently skipping these is how a mis-rendered registry
      // (2026-07-14: paths missing Claude Code's leading dash) ran ingest dark
      // for 39h with zero log evidence. Warn once per path, loudly.
      if (!_missingSourceWarned.has(source.path)) {
        _missingSourceWarned.add(source.path);
        log(`[ingest] WARNING: enabled transcript source '${source.name}' points at a nonexistent dir: ${source.path} — no sessions from it will EVER ingest until this is fixed`);
      }
      continue;
    }

    let files;
    try {
      files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
    } catch (err) { console.warn(`[memory-daemon] session readdir failed for ${source.path}: ${err.message}`); continue; }

    for (const f of files) {
      const full = path.join(source.path, f);
      try {
        const stat = fs.statSync(full);
        const mtime = stat.mtimeMs;
        if (mtime > cutoff) {
          active = true;
          recentFiles.push(full);
          if (stat.size >= MIN_SESSION_BYTES) activeSessions.push({ sessionId: path.basename(f, '.jsonl'), path: full });
        }
        if (mtime > newestMtime) {
          newestMtime = mtime;
          newestSource = source.name;
        }
      } catch (err) { console.warn(`[memory-daemon] session file stat failed for ${full}: ${err.message}`); continue; }
    }
  }

  const result = { active, recentFiles, activeSessions };
  if (process.env.OPENCLAW_LOG_LEVEL === 'debug') {
    const ageMs = newestMtime ? Math.round(Date.now() - newestMtime) : -1;
    console.log(`[memory-daemon] Activity: source=${newestSource || 'none'} age=${ageMs}ms`);
  }
  return result;
}
// Runs every tick: smart mode keeps it only when slow or failing.
const detectActivity = tracer.wrap('detectActivity', _detectActivity, { tier: 2, category: 'compute' });

// ============================================================
// MEMORY BUDGET (character cap + node memory session events)
// ============================================================

let memoryBudget = null;
let localEventLog = null;
// The inject server and memory budget are built once, possibly before a NATS
// retry sets localEventLog; they hold this forwarder so a later log reaches them.
const liveEventLog = { publishLocal: (event) => (localEventLog ? localEventLog.publishLocal(event) : Promise.resolve()) };
let extractionTrigger = null;

// Serialize runFlush across all trigger paths (D3 port, deep review 2026-07-03).
// A flush takes 1–15 min; the NATS extract handler used to fire un-awaited and
// could overlap interval/session-end flushes — double LLM work + racing
// MEMORY.md/vault writes. Every completed pass re-arms the idle timer, which
// deliberately does not self-re-arm (R40).
let flushChain = Promise.resolve();
let natsFlushQueued = false;
function serializeFlush(fn) {
  const run = () => Promise.resolve().then(fn).finally(() => extractionTrigger?.resetIdleTimer?.());
  const next = flushChain.then(run, run);
  flushChain = next.catch(() => {});
  return next;
}

// Run the flush OFF this thread. The flush's transcript parse + prompt assembly
// is synchronous string work over a multi-MB JSONL; on the main event loop it
// starved the :7893 inject server for the whole window (thread-sample evidence:
// audits/memory_ingest_remediation). The worker builds its own LLM client +
// extraction store (not structured-cloneable) and returns the plain result.
const FLUSH_WORKER = path.join(__dirname, 'flush-worker.mjs');
const FLUSH_WORKER_TIMEOUT_MS = 30 * 60_000;
function runMemoryWorker(data, timeoutMs = FLUSH_WORKER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    // P5-3: the worker has its own ollama-queue singleton, invisible to this
    // process's idle gate. Register the job here for the lifetime of the
    // worker so consolidation cannot start beside a running extraction.
    const jobId = `${data.kind || 'flush'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const llmJobId = `${jobId}:llm`;
    const detail = data.jsonlPath ? path.basename(data.jsonlPath) : null;
    markExternalJob(jobId, { type: data.kind || 'flush', detail });
    const w = new Worker(FLUSH_WORKER, { workerData: { stateDb: PATHS.stateDb, ...data } });
    let settled = false;
    const clearJobs = () => { clearExternalJob(jobId); clearExternalJob(llmJobId); };
    const timer = setTimeout(() => {
      settled = true;
      clearJobs();
      w.terminate();
      reject(new Error(`memory worker (${data.kind || 'flush'}) timed out after ${timeoutMs / 60_000}min`));
    }, timeoutMs);
    timer.unref();
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); clearJobs(); fn(v); } };
    w.on('message', (m) => {
      if (settled) return;
      if (applyWorkerLlmMessage(llmJobId, m, detail)) return;
      foldWorkerQueueState(m.queue);
      settle(m.ok ? resolve : reject, m.ok ? m.result : new Error(m.error));
    });
    w.once('error', (e) => settle(reject, e));
    w.once('exit', (code) => { if (code !== 0) settle(reject, new Error(`memory worker (${data.kind || 'flush'}) exited with code ${code}`)); });
  });
}
function runFlushInWorker(jsonlPath, memoryMdPath, opts = {}) {
  return runMemoryWorker({ kind: 'flush', jsonlPath, memoryMdPath, vaultPath: PATHS.vault, ...opts });
}
// Session-store imports are serialized: the end-of-session archive, the boot
// pass and the Phase 2 pass all write the current session's rows, and two
// workers doing it at once is a duplicate delete-and-reinsert.
let importChain = Promise.resolve();
function serializeImport(fn) {
  const next = importChain.then(fn, fn);
  importChain = next.catch(() => {});
  return next;
}
function runImportInWorker(jsonlPath, { source, format } = {}) {
  return serializeImport(() => runMemoryWorker({ kind: 'import', jsonlPath, source, format }, 10 * 60_000));
}
// The directory pass parses only files whose size/mtime marker changed, but the
// first pass after an upgrade parses everything once, hence the long timeout.
async function runImportDirInWorker(sources) {
  const present = sources.filter(s => fs.existsSync(s.path)).map(s => ({ path: s.path, name: s.name, format: s.format }));
  if (present.length === 0) return [];
  const { results, failed } = await serializeImport(() => runMemoryWorker({ kind: 'importDir', sources: present }));
  for (const r of results) emitIngestEvent(r.sessionId, r.source, r.messageCount, r.previousCount);
  for (const f of failed) {
    log(`  session-store import of ${path.basename(f.file)} (${f.source}) failed: ${f.error}`);
    emitErrorEvent('ingest', new Error(f.error), path.basename(f.file, '.jsonl'));
  }
  return results;
}

function emitIngestEvent(sessionId, source, messageCount, previousCount = 0) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.ingested', sessionId, 'memory', {
    session_id: sessionId,
    source: source || 'unknown',
    // Clamped: a parser change can re-count a stored session lower, and the schema rejects a negative delta.
    messages_added: Math.max(0, messageCount - previousCount),
    total_messages: messageCount,
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.ingested emit failed: ${err.message}`)
  );
}

function extractedEventData(sessionId, extraction) {
  return {
    session_id: sessionId,
    entities_count: extraction.entities_count,
    themes_count: extraction.themes_count,
    mentions_count: extraction.mentions_count,
    decisions_count: extraction.decisions_count,
    // The actual content extracted (capped samples), not just counts.
    entity_names: extraction.entity_names,
    theme_labels: extraction.theme_labels,
    decision_texts: extraction.decision_texts,
    model: DEFAULT_MODEL,
    duration_ms: extraction.duration_ms,
    // An unchanged tail: recorded (noop, still pipeline liveness) but kept out
    // of the watcher's extraction_failure_rate window.
    ...(extraction.dedup ? { dedup: true } : {}),
  };
}

function emitExtractEvent(sessionId, extraction) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.extracted', sessionId, 'memory', extractedEventData(sessionId, extraction), NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.extracted emit failed: ${err.message}`)
  );
}

// P0: extraction degradation must be LOUD, not silent. When the LLM path fails and the
// regex fallback runs (diverting away from the structured MEMORY.md), emit memory.error
// so the watcher/observer sees the degradation instead of it hiding in a stderr line.
function emitDegradeEvent(sessionId, result) {
  if (!localEventLog) return;
  // MemoryErrorSchema requires {boundary, error_code, error_message} — the original
  // shape ({kind, detail, ...}) never validated, so the "degradation must be LOUD"
  // event failed silently on every single degrade. The details ride error_message.
  const event = buildMemoryEvent('memory.error', sessionId, 'memory', {
    boundary: 'extract',
    error_code: 'EXTRACTION_DEGRADED',
    error_message: (
      `LLM extraction failed; regex fallback used (model ${DEFAULT_MODEL})`
      + (result.extraction_error ? `: ${result.extraction_error}` : '')
      + (result.fallback_path ? ` (diverted to ${result.fallback_path}; structured MEMORY.md protected)` : '')
    ).slice(0, 500),
    ...(sessionId ? { session_id: String(sessionId) } : {}),
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.error emit failed: ${err.message}`)
  );
}

// The schema caps artifacts_written at 100 (R31); a flush that writes more
// sends the first 100 and the count of the rest.
function synthesizedEventData(sessionId, trigger, synthesis) {
  const written = synthesis.artifacts_written;
  return {
    session_id: sessionId,
    trigger,
    artifacts_written: written.slice(0, 100),
    ...(written.length > 100 ? { artifacts_more: written.length - 100 } : {}),
    duration_ms: synthesis.duration_ms,
    ...(synthesis.vault_integrity ? { vault_integrity: synthesis.vault_integrity } : {}),
  };
}

function emitSynthesizeEvent(sessionId, trigger, synthesis) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.synthesized', sessionId, 'memory', synthesizedEventData(sessionId, trigger, synthesis), NODE_ID);
  localEventLog.publishLocal(event).catch(err =>
    log(`[event] memory.synthesized emit failed: ${err.message}`)
  );
}

function emitErrorEvent(boundary, err, sessionId) {
  if (!localEventLog) return;
  const event = buildMemoryEvent('memory.error', sessionId || 'unknown', 'memory', {
    boundary,
    error_code: String(err.code || err.constructor?.name || 'UNKNOWN').slice(0, 100),
    error_message: (err.message || String(err)).slice(0, 500),
    ...(sessionId ? { session_id: sessionId } : {}),
  }, NODE_ID);
  localEventLog.publishLocal(event).catch(emitErr =>
    log(`[event] memory.error emit failed: ${emitErr.message}`)
  );
}

/**
 * The single completion-truth gate for every runFlush() result (protocol 4.5).
 *
 * Five trigger paths reach runFlush — interval, session-end ACTIVE->ENDED,
 * pre-compression ACTIVE->IDLE, session-end IDLE->ENDED, and NATS-triggered.
 * Only the interval path ever read `result.degraded`, so on the other four a
 * failed LLM extraction still emitted a clean memory.synthesized event and the
 * daemon reported success. Degradation is a completion failure, not a variant
 * of success: it emits exactly one memory.error and suppresses the clean
 * extract/synthesize events.
 *
 * `ctx.sessionId` is required rather than derived, because a degraded result
 * returns from the regex fallback in pre-compression-flush.mjs with neither an
 * `extraction` object nor a session id.
 *
 * @param {object|null} result — runFlush() return value
 * @param {{trigger: string, sessionId: string|null, synthesisLabel?: string}} ctx
 * @returns {{skipped: boolean, degraded: boolean, emitted: 'error'|'ok'|null, sessionId: string|null}}
 */
function handleFlushResult(result, ctx = {}) {
  const trigger = ctx.trigger || 'flush';
  const synthesisLabel = ctx.synthesisLabel || trigger;
  const sessionId = result?.extraction?.session_id || ctx.sessionId || null;

  // A missing result is indistinguishable from a failed one; never treat it as success.
  if (!result) {
    log(`  ${trigger}: ⚠ FLUSH RETURNED NO RESULT — treating as degraded`);
    emitDegradeEvent(sessionId, { extraction_error: 'runFlush returned no result' });
    return { skipped: false, degraded: true, emitted: 'error', sessionId };
  }

  // Dedup/threshold skip is not a completion — no events, no verdict.
  if (result.skippedByCheck) {
    return { skipped: true, degraded: false, emitted: null, sessionId };
  }

  if (result.degraded) {
    log(
      `  ${trigger}: ⚠ EXTRACTION DEGRADED — LLM failed, regex fallback used`
      + (result.fallback_path ? ` (diverted to ${result.fallback_path}; structured MEMORY.md protected)` : '')
      + `: ${result.extraction_error || ''}`
    );
    emitDegradeEvent(sessionId, result);
    return { skipped: false, degraded: true, emitted: 'error', sessionId };
  }

  if (result.extraction) {
    emitExtractEvent(result.extraction.session_id || sessionId, result.extraction);
  }
  if (result.synthesis) {
    emitSynthesizeEvent(result.synthesis.session_id || sessionId, synthesisLabel, result.synthesis);
  }
  return { skipped: false, degraded: false, emitted: 'ok', sessionId };
}

function initMemoryBudget(config) {
  if (memoryBudget) return memoryBudget;
  memoryBudget = createBudget(WORKSPACE, {
    charBudget: config.memoryCharBudget || 2200,
    eventLog: liveEventLog,
    nodeId: NODE_ID,
  });
  return memoryBudget;
}

// ============================================================
// PHASE 0: SESSION-START BOOTSTRAP
// ============================================================

async function runPhase0Bootstrap(sessionId, config, { othersLive = false, previousJsonl = null } = {}) {
  log(`Phase 0: Bootstrap for session ${sessionId?.slice(0, 8) || 'unknown'}`);

  const recap = path.join(WORKSPACE, 'bin/session-recap');
  const clawvault = path.join(WORKSPACE, config.clawvaultBin);
  const compileBoot = path.join(WORKSPACE, 'bin/compile-boot');
  const maintenance = path.join(WORKSPACE, 'bin/memory-maintenance.mjs');
  const memoryDir = path.join(WORKSPACE, 'memory');

  // 1. Session recap of the last session that ended
  if (fs.existsSync(recap) && previousJsonl) {
    try {
      await runSubprocess('node', [recap, '--file', previousJsonl], 30000);
      log(`  session-recap of previous session ${path.basename(previousJsonl).slice(0, 8)} done`);
    } catch (e) { log(`  session-recap of previous session failed: ${e.message}`); }
  }

  // 2. ClawVault wake
  if (fs.existsSync(clawvault)) {
    try {
      await runSubprocess(clawvault, ['wake'], 15000);
      log('  clawvault wake done');
    } catch (e) { log(`  clawvault wake failed: ${e.message}`); }
  }

  // 3. Ensure today's daily file exists
  const today = new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
  const todayFile = path.join(memoryDir, `${today}.md`);
  if (!fs.existsSync(todayFile)) {
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(todayFile, `# ${today} — Daily Log\n\n`);
    log(`  created daily file: ${today}.md`);
  }

  // A transcript that appears beside a live session (a plan tick, a second
  // conversation) gets only the steps above: the node-wide ones below already
  // ran for the boot that opened the node session, and Phase 2's import keeps
  // the archive current.
  if (othersLive) {
    log('Phase 0: Bootstrap complete (node-wide steps already ran for a live session)');
    return;
  }

  // 4. Run maintenance (force)
  if (fs.existsSync(maintenance)) {
    try {
      await runSubprocess('node', [maintenance, '--force'], 60000);
      log('  memory-maintenance --force done');
    } catch (e) { log(`  memory-maintenance failed: ${e.message}`); }
    // Phase 2 forces maintenance on this stamp alone; without it the boot tick runs it twice.
    const throttle = loadThrottleState();
    throttle.lastMaintenance = Date.now();
    saveThrottleState(throttle);
  }

  // 5. Compile boot artifacts
  if (fs.existsSync(compileBoot)) {
    try {
      // Use /usr/bin/python3 explicitly — Homebrew python lacks pyyaml
      const py = fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
      await runSubprocess(py, [compileBoot, '--all'], 30000);
      log('  compile-boot done');
    } catch (e) { log(`  compile-boot failed: ${e.message}`); }
  }

  // 6. ClawVault doctor — vault health check + auto-fix
  if (fs.existsSync(clawvault)) {
    try {
      await runSubprocess(clawvault, ['doctor', '--fix'], 30000);
      log('  clawvault doctor done');
    } catch (e) { log(`  clawvault doctor failed: ${e.message}`); }
  }

  // 7. Open the node memory session (memory.session_started)
  try {
    const budget = initMemoryBudget(config);
    budget.startSession();
    log(`  memory session started, MEMORY.md ${budget.getStats().meterDisplay}`);
  } catch (e) { log(`  memory session start failed: ${e.message}`); }

  // 8. Import changed sessions into SQLite archive (memory worker)
  try {
    const imported = await runImportDirInWorker(loadTranscriptSources());
    if (imported.length > 0) log(`  session-store: imported ${imported.length} sessions`);
  } catch (e) { log(`  session-store import failed: ${e.message}`); emitErrorEvent('ingest', e); }
  stampThrottle('lastSessionImport');

  log('Phase 0: Bootstrap complete');
}

// R-floor fix (repair 4.6): below this a session file is header-only noise.
// The old floor was a bare 50KB literal, which silently excluded every
// short-but-real conversation from the interval/NATS flush paths and from
// ended-session targeting; the 1.4 extraction dedup makes re-considering
// small sessions cheap.
const { MIN_SESSION_BYTES } = require('../lib/session-floor');

function findJsonlBySessionId(sources, sessionId) {
  if (!sessionId) return null;
  const target = `${sessionId}.jsonl`;
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;
    const full = path.join(source.path, target);
    try {
      const stat = fs.statSync(full);
      if (stat.size >= MIN_SESSION_BYTES) return full;
    } catch { /* file doesn't exist in this source */ }
  }
  return null;
}

// The transcripts of the tracked sessions in the given states: each flush
// targets its own session, never "the newest file", which belongs to whichever
// of several concurrent sessions wrote last.
function sessionTranscripts(sessions, states) {
  const sources = loadTranscriptSources();
  return sessions
    .filter(s => states.includes(s.state))
    .map(s => ({ sessionId: s.sessionId, jsonl: findJsonlBySessionId(sources, s.sessionId) }))
    .filter(s => s.jsonl);
}

function sourceOfJsonl(sources, jsonlPath) {
  const dir = path.resolve(path.dirname(jsonlPath));
  return sources.find(s => path.resolve(s.path) === dir) || null;
}

// ============================================================
// PHASE 1: STATUS SYNC
// Updates .daemon-state-${NODE_ID}.md from active-tasks.md (~5ms)
// ============================================================

function runPhase1StatusSync(config, status, { newSession = false } = {}) {
  const activeTasks = path.join(WORKSPACE, 'memory/active-tasks.md');
  const companion = path.join(WORKSPACE, `.daemon-state-${NODE_ID}.md`);

  let runningTasks = 'Standing by';
  let runningCount = 0;
  let doneCount = 0;

  if (fs.existsSync(activeTasks)) {
    try {
      const content = fs.readFileSync(activeTasks, 'utf-8');
      const lines = content.split('\n');

      // Extract running task titles
      const running = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('status: running')) {
          // Look backwards for the title
          for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
            const titleMatch = lines[j].match(/title:\s*"?(.+?)"?\s*$/);
            if (titleMatch) {
              running.push(titleMatch[1]);
              break;
            }
          }
        }
      }

      runningCount = (content.match(/status: running/g) || []).length;
      doneCount = (content.match(/status: done/g) || []).length;

      if (running.length > 0) {
        runningTasks = running.slice(0, 3).join('\n');
      }
    } catch (err) { console.warn(`[memory-daemon] active-tasks read failed: ${err.message}`); }
  }

  const now = new Date().toLocaleString('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).replace(', ', 'T').replace(/\//g, '-');

  let existing = '';
  try { existing = fs.readFileSync(companion, 'utf-8'); } catch {}
  fs.writeFileSync(companion, renderCompanionState(existing, { status, newSession, now, runningTasks, runningCount, doneCount }));
}

// ============================================================
// PHASE 2: THROTTLED BACKGROUND WORK
// ============================================================

const THROTTLE_STATE_FILE = path.join(STATE_DIR, 'daemon-throttle.json');
const THROTTLE_DEFAULTS = Object.freeze({
  lastRecap: 0, lastMaintenance: 0, lastObsidianSync: 0,
  lastSessionImport: 0, lastHyperagentReflect: 0, lastSynthesis: 0,
  lastKnowledgeIndex: 0, lastGraphCacheRefresh: 0,
});

function loadThrottleState() {
  if (fs.existsSync(THROTTLE_STATE_FILE)) {
    try {
      return { ...THROTTLE_DEFAULTS, ...JSON.parse(fs.readFileSync(THROTTLE_STATE_FILE, 'utf-8')) };
    } catch (err) { console.warn(`[memory-daemon] throttle state parse failed: ${err.message}`); }
  }
  return { ...THROTTLE_DEFAULTS };
}

function saveThrottleState(state) {
  fs.writeFileSync(THROTTLE_STATE_FILE, JSON.stringify(state, null, 2));
}

// A transition pipeline that runs a Phase 2 step stamps it, or the same tick's
// Phase 2 / vault maintenance repeats it.
function stampThrottle(...keys) {
  const throttle = loadThrottleState();
  const now = Date.now();
  for (const key of keys) throttle[key] = now;
  saveThrottleState(throttle);
}

async function runHyperagentMaintenance(config) {
  const now = Date.now();
  const throttle = loadThrottleState();
  if (now - throttle.lastHyperagentReflect < (config.intervals.hyperagentReflectMs || 1800000)) return;

  const ha = await getHyperAgentStore();
  if (!ha) return;
  let succeeded = true;
  try {
    const reflections = ha.createPendingReflections(5);
    if (reflections.length > 0) {
      const summary = reflections.map((r) => `#${r.id}:${r.node_id}/${r.soul_id}=${r.telemetry_count}`).join(', ');
      log(`  HyperAgent: reflections created (${summary})`);
    }
  } catch (e) {
    succeeded = false;
    log(`  HyperAgent: reflection failed: ${e.message}`);
  }
  try {
    const expired = ha.expireStalePending();
    if (expired > 0) log(`  HyperAgent: stale reflections expired=${expired}`);
  } catch (e) {
    succeeded = false;
    log(`  HyperAgent: expiry failed: ${e.message}`);
  }
  try {
    const observed = ha.checkObservationWindows();
    if (observed > 0) log(`  HyperAgent: observations closed=${observed}`);
  } catch (e) {
    succeeded = false;
    log(`  HyperAgent: observation failed: ${e.message}`);
  }
  try {
    // 1.1: pending reflections/proposals owe the operator exactly one durable
    // signal — the ledger's stable-id dedup makes redelivery retries harmless.
    const { notify } = await import('../lib/notify.mjs');
    const drained = await ha.drainNotifyOutbox((evt) => notify({
      id: evt.id,
      source: 'hyperagent',
      kind: 'info',
      title: evt.item_type === 'reflection'
        ? 'HyperAgent: reflection awaits synthesis (24h window)'
        : 'HyperAgent: proposal awaits review',
      message: evt.item_type === 'reflection'
        ? `Reflection #${evt.item?.id} (${evt.item?.node_id}/${evt.item?.soul_id}, ${evt.item?.telemetry_count} tasks) — run the synthesis runbook.`
        : `Proposal #${evt.item?.id}: ${evt.item?.title}`,
      url: `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/hyperagent`,
    }));
    if (drained.delivered > 0) log(`  HyperAgent: operator signals delivered=${drained.delivered}`);
  } catch (e) {
    succeeded = false;
    log(`  HyperAgent: notify drain failed: ${e.message}`);
  }

  if (succeeded) {
    throttle.lastHyperagentReflect = now;
    saveThrottleState(throttle);
    log('  HyperAgent: maintenance tick complete');
  }
}

async function runPhase2ThrottledWork(config, sessions) {
  const now = Date.now();
  const throttle = loadThrottleState();

  // Stage 1: Parallel — recap, maintenance, session import, indexing, synthesis
  // These produce data. They run before Obsidian sync so fresh data gets pushed.
  const stage1 = [];

  // Session recap (every 10min)
  if (now - throttle.lastRecap >= config.intervals.sessionRecapMs) {
    throttle.lastRecap = now;
    const recap = path.join(WORKSPACE, 'bin/session-recap');
    if (fs.existsSync(recap)) {
      stage1.push(
        runSubprocess('node', [recap], 30000)
          .then(() => log('  Phase 2: session-recap done'))
          .catch(e => log(`  Phase 2: session-recap failed: ${e.message}`))
      );
    }
  }

  // Memory maintenance (every 30min)
  if (now - throttle.lastMaintenance >= config.intervals.maintenanceMs) {
    throttle.lastMaintenance = now;
    const maint = path.join(WORKSPACE, 'bin/memory-maintenance.mjs');
    if (fs.existsSync(maint)) {
      stage1.push(
        runSubprocess('node', [maint, '--force'], 60000)
          .then(() => log('  Phase 2: memory-maintenance done'))
          .catch(e => log(`  Phase 2: memory-maintenance failed: ${e.message}`))
      );
    }
  }

  // Session archive import — incremental (every 10min, aligned with recap).
  // This one pass also keeps the live session fresh in state.db (the mem.ingest
  // freshness probe): its transcript is the file whose marker keeps changing.
  if (now - throttle.lastSessionImport >= config.intervals.sessionRecapMs) {
    throttle.lastSessionImport = now;
    stage1.push(
      (async () => {
        try {
          const imported = await runImportDirInWorker(loadTranscriptSources());
          if (imported.length > 0) log(`  Phase 2: session-store imported ${imported.length} sessions`);
        } catch (e) { log(`  Phase 2: session-import failed: ${e.message}`); emitErrorEvent('ingest', e); }
      })()
    );
  }

  // Knowledge DB incremental indexing (every 10min, aligned with session-import)
  if (now - (throttle.lastKnowledgeIndex || 0) >= config.intervals.sessionRecapMs) {
    throttle.lastKnowledgeIndex = now;
    stage1.push(
      (async () => {
        try {
          const stateDbPath = PATHS.stateDb;
          if (!fs.existsSync(stateDbPath)) return;
          // Child process, NOT the flush worker and NOT this thread: the
          // transformers embedder pinned the daemon's microtask queue for
          // minutes per grown session and deafened :7893, and its
          // onnxruntime-node native addon fatally crashes the whole process
          // when loaded in a worker_thread (both observed —
          // audits/inject_hang).
          const jobArgs = [
            path.join(WORKSPACE, 'bin/knowledge-index-job.mjs'),
            stateDbPath,
            PATHS.knowledgeDb,
          ];
          let out = '';
          try {
            const r = await execFileAsync(process.execPath, jobArgs,
              { timeout: 30 * 60_000, maxBuffer: 4 * 1024 * 1024, cwd: WORKSPACE });
            out = r.stdout;
          } catch (e) {
            // onnxruntime-node aborts in C++ static teardown AFTER the job has
            // printed its result (dispose() doesn't prevent it — repro'd in
            // audits/inject_hang). The trailing JSON line is the completion
            // certificate; the exit code of this job is noise.
            out = e.stdout || '';
            if (!out.trim()) throw e;
          }
          const { indexed, chunks } = JSON.parse(out.trim().split('\n').pop());
          if (indexed > 0) log(`  Phase 2: knowledge-index: ${indexed} sessions indexed (${chunks} chunks)`);
        } catch (e) { log(`  Phase 2: knowledge-index failed: ${e.message}`); emitErrorEvent('knowledge_index', e); }
      })()
    );
  }

  // 30-min interval synthesis of every active session (D2, step 4.5)
  const activeTranscripts = sessionTranscripts(sessions, [STATES.ACTIVE]);
  if (activeTranscripts.length > 0 && now - throttle.lastSynthesis >= config.intervals.synthesisMs) {
    throttle.lastSynthesis = now;
    stage1.push(
      (async () => {
        const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
        const budget = initMemoryBudget(config);
        for (const { sessionId, jsonl } of activeTranscripts) {
          try {
            const result = await serializeFlush(() => runFlushInWorker(jsonl, memoryMd, {
              charBudget: budget.charBudget,
            }));
            log(`  Phase 2: interval synthesis [${result.mode || 'regex'}]: ${result.facts} facts found, ${result.added} added (session ${sessionId.slice(0, 8)})`);
            handleFlushResult(result, {
              trigger: 'Phase 2: interval synthesis',
              sessionId,
              synthesisLabel: 'interval',
            });
          } catch (e) { log(`  Phase 2: interval synthesis of ${sessionId.slice(0, 8)} failed: ${e.message}`); emitErrorEvent('extract', e, sessionId); }
        }
      })()
    );
  }

  if (stage1.length > 0) {
    await Promise.allSettled(stage1);
  }

  saveThrottleState(throttle);
}

// A NATS extract request names no session: it flushes every live one.
async function runRequestedFlush(sessions, config) {
  if (natsFlushQueued) {
    log('[nats] flush already queued — coalescing request');
    return;
  }
  const live = sessionTranscripts(sessions, [STATES.ACTIVE, STATES.IDLE]);
  if (live.length === 0) {
    log('[nats] skipping extraction — no live session');
    return;
  }
  natsFlushQueued = true;
  try {
    const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
    const budget = initMemoryBudget(config);
    for (const { sessionId, jsonl } of live) {
      try {
        // shouldFlush only stats the transcript; the flush that may follow
        // parses it, so both run IN the worker (checkShouldFlush) and the
        // event loop never touches the JSONL.
        const result = await serializeFlush(() => runFlushInWorker(jsonl, memoryMd, {
          charBudget: budget.charBudget,
          checkShouldFlush: true,
          contextWindowTokens: config.contextWindowTokens || 200000,
        }));
        if (!result.skippedByCheck) {
          log(`  nats-triggered flush [${result.mode || 'regex'}]: ${result.facts} facts, ${result.added} added, ${result.merged} merged (session ${sessionId.slice(0, 8)})`);
          handleFlushResult(result, {
            trigger: 'nats-triggered flush',
            sessionId,
            synthesisLabel: 'manual',
          });
        }
      } catch (e) { log(`  nats-triggered flush of ${sessionId.slice(0, 8)} failed: ${e.message}`); emitErrorEvent('extract', e, sessionId); }
    }
  } finally { natsFlushQueued = false; }
}

async function runNodeVaultMaintenance(config) {
  const now = Date.now();
  const throttle = loadThrottleState();

  // Stage 2: Obsidian sync — runs AFTER stage 1 so fresh synthesis notes
  // and recaps are picked up and pushed to vault.
  if (now - throttle.lastObsidianSync >= config.intervals.obsidianSyncMs) {
    throttle.lastObsidianSync = now;
    const obsSync = path.join(WORKSPACE, 'bin/obsidian-sync.mjs');
    if (fs.existsSync(obsSync)) {
      await runSubprocess('node', [obsSync], 60000)
        .then(() => log('  Phase 2: obsidian-sync done'))
        .catch(e => log(`  Phase 2: obsidian-sync failed: ${e.message}`));
    }
  }

  // Stage 3: Graph-cache refresh — runs AFTER obsidian sync so vault notes
  // written during synthesis (stage 1) and sync (stage 2) are reflected.
  // Aligned with synthesis cadence (30 min, D2).
  if (now - (throttle.lastGraphCacheRefresh || 0) >= config.intervals.maintenanceMs) {
    throttle.lastGraphCacheRefresh = now;
    try {
      const gc = getGraphCache();
      if (gc) {
        const result = await gc.refreshCache();
        if (result) log(`  Phase 2: graph-cache refreshed: ${result.nodeCount} nodes, ${result.edgeCount} edges`);
      }
    } catch (e) { log(`  Phase 2: graph-cache refresh failed: ${e.message}`); emitErrorEvent('graph_cache_refresh', e); }
  }

  saveThrottleState(throttle);
}

// ============================================================
// TRANSITION HANDLERS
// Actions triggered by state machine transitions
// ============================================================

// Returns the ids of the sessions whose bootstrap finished.
async function handleTransitions(transitions, config) {
  const booted = [];
  for (const t of transitions) {
    log(`State: ${t.from} → ${t.to} (session: ${t.sessionId?.slice(0, 8) || '?'})`);

    // ENDED → BOOT: Full bootstrap
    if (t.from === STATES.ENDED && t.to === STATES.BOOT) {
      if (!t.othersLive) runPhase1StatusSync(config, 'active', { newSession: true });
      await runPhase0Bootstrap(t.sessionId, config, { othersLive: t.othersLive, previousJsonl: t.previousJsonl });
      booted.push(t.sessionId);
    }

    // ACTIVE → IDLE: Pre-compression flush + recap + checkpoint
    if (t.from === STATES.ACTIVE && t.to === STATES.IDLE) {
      log('Entering idle — running flush + recap + checkpoint');
      const recap = path.join(WORKSPACE, 'bin/session-recap');
      const clawvault = path.join(WORKSPACE, config.clawvaultBin);

      // Pre-compression flush: extract durable facts before context may be lost
      const sources = loadTranscriptSources();
      const currentJsonl = findJsonlBySessionId(sources, t.sessionId);
      if (currentJsonl) {
        try {
          // shouldFlush only stats the transcript; the flush that may follow
          // parses it, so both run IN the worker (checkShouldFlush) and the
          // event loop never touches the JSONL.
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await serializeFlush(() => runFlushInWorker(currentJsonl, memoryMd, {
            charBudget: budget.charBudget,
            checkShouldFlush: true,
            contextWindowTokens: config.contextWindowTokens || 200000,
          }));
          if (!result.skippedByCheck) {
            log(`  pre-compression flush triggered (${result.check?.pctUsed}% of ${result.check?.threshold} token threshold)`);
            log(`  flush [${result.mode || 'regex'}]: ${result.facts} facts found, ${result.added} added, ${result.merged} merged, ${result.skipped} skipped`);
            // R10 (repair 2.11): this is the ACTIVE→IDLE pre-compression
            // flush — its own label, not 'interval'.
            handleFlushResult(result, {
              trigger: 'pre-compression flush',
              sessionId: path.basename(currentJsonl, '.jsonl'),
              synthesisLabel: 'idle',
            });
          }
        } catch (e) { log(`  pre-compression flush failed: ${e.message}`); emitErrorEvent('extract', e, path.basename(currentJsonl, '.jsonl')); }
      }

      const tasks = [];
      if (fs.existsSync(recap) && currentJsonl) {
        tasks.push(runSubprocess('node', [recap, '--file', currentJsonl], 30000).catch(() => {}));
      }
      if (fs.existsSync(clawvault)) {
        tasks.push(runSubprocess(clawvault, ['checkpoint', '--working-on', 'idle'], 15000).catch(() => {}));
      }
      await Promise.allSettled(tasks);
      stampThrottle('lastRecap');
    }

    // IDLE → ENDED: Full cleanup pipeline
    if (t.from === STATES.IDLE && t.to === STATES.ENDED) {
      if (t.jsonlPath) traceEmitter.forget(t.jsonlPath);
      log('Session ended — running full cleanup pipeline');
      const clawvault = path.join(WORKSPACE, config.clawvaultBin);
      const obsSync = path.join(WORKSPACE, 'bin/obsidian-sync.mjs');

      // 0. Pre-compression flush (final chance to capture facts).
      // R17 fix (repair 4.4): flush the ENDED session's own transcript; with
      // concurrent sessions the newest JSONL belongs to another one.
      const sources = loadTranscriptSources();
      const currentJsonl = findJsonlBySessionId(sources, t.sessionId);
      if (currentJsonl) {
        try {
          const memoryMd = path.join(WORKSPACE, 'MEMORY.md');
          const budget = initMemoryBudget(config);
          const result = await serializeFlush(() => runFlushInWorker(currentJsonl, memoryMd, {
            charBudget: budget.charBudget,
          }));
          const verdict = handleFlushResult(result, {
            trigger: 'end-of-session flush',
            sessionId: t.sessionId || path.basename(currentJsonl, '.jsonl'),
            synthesisLabel: 'session_end',
          });
          if (!verdict.degraded && result.synthesis) {
            log(`  session-end synthesis [${result.mode}]: ${result.synthesis.artifacts_written.length} artifacts, ${result.synthesis.duration_ms}ms`);
          }
          if (result.added > 0 || result.merged > 0) {
            log(`  end-of-session flush [${result.mode || 'regex'}]: ${result.added} added, ${result.merged} merged`);
          }
        } catch (e) { log(`  end-of-session flush failed: ${e.message}`); emitErrorEvent('extract', e, path.basename(currentJsonl, '.jsonl')); }
      }

      // 0b. Archive current session to SQLite
      if (currentJsonl) {
        try {
          const src = sourceOfJsonl(sources, currentJsonl);
          const result = await runImportInWorker(currentJsonl, {
            source: src?.name || 'unknown',
            format: src?.format,
          });
          if (result.imported) {
            log(`  session-store: archived ${result.sessionId.slice(0, 8)} (${result.messageCount} msgs)`);
            emitIngestEvent(result.sessionId, src?.name || 'unknown', result.messageCount, result.previousCount);
          }
        } catch (e) { log(`  session-store archive failed: ${e.message}`); emitErrorEvent('ingest', e); }
      }

      // 0c. The last live session ends the node memory session (memory.session_ended)
      if (memoryBudget && !t.othersLive) {
        memoryBudget.endSession();
        log('  memory session ended');
      }

      // 1. Final Obsidian sync — push all changes
      if (fs.existsSync(obsSync)) {
        await runSubprocess('node', [obsSync], 60000).catch(() => {});
        log('  final obsidian-sync done');
        stampThrottle('lastObsidianSync');
      }

      // 2. ClawVault sleep — handoff + clean exit
      if (fs.existsSync(clawvault)) {
        await runSubprocess(clawvault, ['sleep', 'session ended'], 15000).catch(() => {});
        log('  clawvault sleep done');
      }

      // Written last: a node left at active/idle with no live session is the
      // crash signal the session-start hook shows the next session.
      if (!t.othersLive) runPhase1StatusSync(config, 'ended');
    }
  }
  return booted;
}

// ============================================================
// SUBPROCESS RUNNER
// ============================================================

function runSubprocess(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: WORKSPACE,
      env: {
        ...process.env,
        OPENCLAW_WORKSPACE: WORKSPACE,
        // Children resolve OPENCLAW_TIMEZONE before TZ, so both carry the daemon's zone.
        OPENCLAW_TIMEZONE: timezone,
        TZ: timezone,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`exit ${code}: ${stderr.trim().slice(0, 200)}`));
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ============================================================
// DAEMON STATE PERSISTENCE
// ============================================================

const DAEMON_STATE_FILE = path.join(STATE_DIR, 'daemon-state.json');

function saveDaemonState(sm) {
  const state = {
    ...sm.toJSON(),
    pid: process.pid,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(DAEMON_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) { console.warn(`[memory-daemon] daemon state write failed: ${err.message}`); }
}

// The saved PID is not checked: whether the previous daemon crashed, was
// restarted or its PID was reused, it no longer drives these sessions, and
// forcing ENDED here dropped their end-of-session pipeline (restore parks them
// IDLE instead).
function loadDaemonState() {
  if (!fs.existsSync(DAEMON_STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DAEMON_STATE_FILE, 'utf-8'));
  } catch (err) {
    console.warn(`[memory-daemon] daemon state parse failed: ${err.message}`);
    return null;
  }
}

// ── Tracer wrapping ──────────────────────────────────
runPhase0Bootstrap = tracer.wrapAsync('runPhase0Bootstrap', runPhase0Bootstrap, { tier: 1, category: 'lifecycle' });
// Per-tick work: recorded only when slow or failing, so the feed keeps real transitions.
runPhase1StatusSync = tracer.wrap('runPhase1StatusSync', runPhase1StatusSync, { tier: 2, category: 'compute' });
runHyperagentMaintenance = tracer.wrapAsync('runHyperagentMaintenance', runHyperagentMaintenance, { tier: 2, category: 'compute' });
runPhase2ThrottledWork = tracer.wrapAsync('runPhase2ThrottledWork', runPhase2ThrottledWork, { tier: 2, category: 'compute' });
handleTransitions = tracer.wrapAsync('handleTransitions', handleTransitions, { tier: 1, category: 'state_transition' });
runSubprocess = tracer.wrapAsync('runSubprocess', runSubprocess, { tier: 2 });

// ============================================================
// FEDERATION SUBSYSTEMS — OPT-IN (OPENCLAW_FEDERATION=1)
//
// Folded in from the retired bin/openclaw-memory-daemon.mjs (the dormant
// "federation-hardened variant" that shipped without a service unit and never
// ran). One daemon now owns everything; the federation wiring below is
// dormant by design until multi-node lands. Default (env unset) is OFF —
// none of this section executes and no federation module is even imported.
// One federation piece is outside it: initNatsSubsystems ensures the
// OPENCLAW_SHARED stream on every node (fatal on mismatch only when ON).
//
// What starts when OPENCLAW_FEDERATION=1:
//   - startFederation (lib/federation-startup.mjs): identity + strict trust
//     registry + seen-event replay cache + broadcaster/offerer/acceptor
//     (F-N1/N2/N3). Offerer+acceptor need both DBs; broadcast-only otherwise.
//     The :7893 inject server drives it per prompt (broadcast, acceptance,
//     [peer-memory] block) and a timer below broadcasts consolidated context.
//   - memory-subscriber (bin/memory-subscriber.mjs): still gated on
//     OPENCLAW_SUBSCRIBER_PROJECTION=stub (F-P107/F-P113 — no Block 11
//     projection yet).
//   - a consolidation broadcast every DEFAULT_INTERVAL_MS. The cycle itself is
//     the openclaw-consolidation-scheduler timer every node runs, federation
//     on or off: a second, in-process scheduler ran cycles beside it on the
//     same state.db and vault, without events.
// The graph cache and extraction trigger are NOT duplicated here — the live
// daemon already wires both (getGraphCache above, createExtractionTrigger in
// initNatsSubsystems); federation reuses the same graphCache instance.
// ============================================================

const federationState = {
  started: false,
  federation: null,
  subscriber: null,
  broadcastTimer: null,
  knowledgeDb: null,
  extractionDb: null,
};

async function initFederationSubsystems(nc) {
  if (federationState.started) return;
  federationState.started = true;
  log('[federation] OPENCLAW_FEDERATION=1 — initializing federation subsystems');

  // The stores the daemon's own knowledge indexing writes; extraction tables
  // live in state.db (C1 fix — one DB for reads and writes).
  const knowledgeDbPath = PATHS.knowledgeDb;
  const extractionDbPath = PATHS.stateDb;
  try {
    const { openStore } = await import('../lib/sqlite-store.mjs');
    federationState.knowledgeDb = fs.existsSync(knowledgeDbPath) ? openStore(knowledgeDbPath) : null;
    federationState.extractionDb = fs.existsSync(extractionDbPath) ? openStore(extractionDbPath) : null;
    if (!federationState.knowledgeDb || !federationState.extractionDb) {
      log(`[federation] WARNING: missing DB (knowledge=${federationState.knowledgeDb ? 'ok' : knowledgeDbPath} ` +
          `extraction=${federationState.extractionDb ? 'ok' : extractionDbPath}) — ` +
          `federation will run in broadcast-only mode (no offerer/acceptor)`);
    }
  } catch (err) {
    log(`[federation] DB open failed (${err.message}) — broadcast-only mode`);
  }

  // Broadcast trio + identity + registry + replay cache (F-N1/N2/N3).
  try {
    const { startFederation } = await import('../lib/federation-startup.mjs');
    federationState.federation = await startFederation(nc, NODE_ID, {
      extractionDb: federationState.extractionDb,
      knowledgeDb: federationState.knowledgeDb,
      graphCache: getGraphCache(),
      llmClient: getLlmClient(),
      log: (m) => log(m),
    });
  } catch (err) {
    log(`[federation] startFederation failed (${err.message}) — continuing without broadcast/offer/accept`);
  }

  // Memory subscriber — consumes shared-stream events. F-P107/F-P113: still
  // DISABLED unless OPENCLAW_SUBSCRIBER_PROJECTION=stub (no Block 11
  // projection exists; stub mode acks WITHOUT projecting, for testing only).
  try {
    if (process.env.OPENCLAW_SUBSCRIBER_PROJECTION === 'stub') {
      const { createSubscriber } = await import('../bin/memory-subscriber.mjs');
      federationState.subscriber = await createSubscriber(nc, NODE_ID, {
        onIngest: (event, parsed) => {
          log(`[federation] SUBSCRIBER-STUB acked-without-projection ${parsed.category} ${event.event_id}`);
        },
        onSkip: (_event, result) => {
          if (result.reason !== 'deferred_to_block_9') {
            log(`[federation] subscriber skipped (${result.reason})`);
          }
        },
        onError: (ctx, err) => log(`[federation] subscriber error in ${ctx}: ${err.message}`),
      });
      log(`[federation] subscriber started in STUB mode — events will be ACKED WITHOUT PROJECTION`);
    } else {
      log(`[federation] subscriber DISABLED (Block 11 projection not yet implemented). ` +
          `Set OPENCLAW_SUBSCRIBER_PROJECTION=stub to ack-without-project for testing.`);
    }
  } catch (err) {
    log(`[federation] subscriber startup failed (${err.message}) — continuing without subscriber`);
  }

  const { DEFAULT_INTERVAL_MS } = await import('../bin/consolidation-scheduler.mjs');
  federationState.broadcastTimer = setInterval(() => {
    federationState.federation?.broadcastConsolidation()
      .catch((err) => log(`[federation] consolidation broadcast failed: ${err.message}`));
  }, DEFAULT_INTERVAL_MS);
  federationState.broadcastTimer.unref();

  log('[federation] init complete');
}

// ============================================================
// MAIN LOOP
// ============================================================

async function main() {
  ensureDirs();
  // P5-7: a missing/unbuilt event-schemas package used to surface as a
  // per-message NAK loop hours later. It is a deployment error — fail here.
  try {
    await loadEventSchemas();
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  }
  const config = loadConfig();
  timezone = config.timezone;
  const sources = loadTranscriptSources();

  log(`Daemon starting (pid: ${process.pid}, workspace: ${WORKSPACE})`);
  log(`Transcript sources: ${sources.map(s => s.name).join(', ')}`);

  const sm = new SessionTracker(config);
  const stopQueueStateObserver = setStateObserver(() => {
    try { exportStateSnapshot(); } catch (snapErr) { log(`queue snapshot export failed: ${snapErr.message}`); }
  });
  // P5-3: export on a timer as well. The observer fires on state CHANGES, so a
  // quiet daemon's snapshot aged past readStateSnapshot's 120s window and the
  // out-of-process scheduler read "stale" → never idle → never consolidated.
  const snapshotTimer = setInterval(() => {
    try { exportStateSnapshot(); } catch (snapErr) { log(`queue snapshot export failed: ${snapErr.message}`); }
  }, 30_000);
  snapshotTimer.unref();

  // Restore state from previous run (crash recovery)
  const savedState = loadDaemonState();
  if (savedState) {
    sm.restore(savedState);
    log(`Restored state: ${sm.state} (sessions: ${sm.sessions.map(x => `${x.sessionId.slice(0, 8)}=${x.state}`).join(', ') || 'none'})`);
  }

  // Optional NATS subscription for external compaction signals
  let natsConn = null;
  let memoryWatcher = null;
  let healthProbeTimer = null;

  // Store-health probes — periodic snapshots of DB row counts, WAL sizes,
  // drift. R16 fix (repair 4.2): they probe SQLite, not NATS — they used to
  // live inside the NATS try block and silently died whenever the broker
  // was down at boot, exactly when disk-level visibility matters most.
  const HEALTH_PROBE_INTERVAL = 5 * 60 * 1000;
  const watcherOutputPath = PATHS.watcherLog;
  const runProbe = async () => {
    try {
      const probe = await runStoreHealthProbes({
        stateDb: PATHS.stateDb, knowledgeDb: PATHS.knowledgeDb, graphCacheDb: PATHS.graphCacheDb,
        workspaceLib: path.join(WORKSPACE, 'lib'),
        workspaceDaemon: path.join(WORKSPACE, 'bin', 'memory-daemon.mjs'),
      });
      appendWatcherRecord(watcherOutputPath, probe);
      log(`[watcher] health probe: ${Object.entries(probe.stores).filter(([,v]) => v).length} stores checked`);
    } catch (err) {
      log(`[watcher] health probe failed: ${err.message}`);
    }
  };
  runProbe();
  healthProbeTimer = setInterval(runProbe, HEALTH_PROBE_INTERVAL);

  // R16 fix (repair 4.3): NATS init is retryable. A broker down at boot used
  // to permanently disable the event spine (event log, watcher, extraction
  // trigger) until a manual restart; now the daemon retries every 60s.
  let running = true;
  let tickInterval = null;
  let inFlightTick = null;
  let natsRetryTimer = null;
  async function initNatsSubsystems() {
  try {
    const { connect: natsConnect } = require('nats');
    const { natsConnectOpts } = require('../lib/nats-resolve');
    natsConn = await natsConnect(natsConnectOpts({ name: 'memory-daemon', timeout: 5000, ...NATS_RECONNECT_OPTS }));

    // Monitor NATS connection status events (reconnect, disconnect, etc.)
    (async () => {
      for await (const s of natsConn.status()) {
        if (s.type === 'reconnect') {
          log(`[nats] reconnected to ${s.data || 'server'}`);
        } else if (s.type === 'disconnect') {
          log(`[nats] disconnected — will auto-reconnect`);
        } else if (s.type === 'error') {
          log(`[nats] connection error: ${s.data}`);
        }
      }
    })().catch(() => {}); // status iterator ends on close

    log(`NATS connected (reconnect: infinite, wait: ${NATS_RECONNECT_OPTS.reconnectTimeWait}ms)`);

    // Initialize local event log for dual-write shadow mode
    try {
      localEventLog = await createLocalEventLog(natsConn, NODE_ID);
      log(`Local event log initialized (stream: ${localEventLog.streamName})`);
    } catch (evtErr) {
      log(`Local event log unavailable (${evtErr.message}) — continuing without event log`);
    }

    // Initialize memory watcher (subscribes to event stream, persists per-op JSONL)
    if (localEventLog) {
      try {
        memoryWatcher = await createMemoryWatcher(natsConn, NODE_ID, {
          outputPath: watcherOutputPath,
          log: (m) => log(`[watcher] ${m}`),
        });
      } catch (watchErr) {
        log(`Memory watcher unavailable (${watchErr.message}) — continuing without watcher`);
      }
    }

    // Ensure shared federation stream (OPENCLAW_SHARED, R=3). This runs even
    // with federation off; a config mismatch is fatal only when federation is
    // on, since the stream protects nothing else and a crash loop for an
    // opt-in feature is worse than an idle, misconfigured stream.
    try {
      await ensureSharedStream(natsConn);
      const streamInfo = await inspectSharedStream(natsConn);
      const verification = verifySharedStreamConfig(streamInfo);
      if (!verification.valid) {
        const reasons = verification.reasons.join('; ');
        if (process.env.OPENCLAW_FEDERATION === '1') {
          log(`FATAL: Shared stream config mismatch: ${reasons}`);
          process.exit(1);
        }
        log(`WARNING: Shared stream config mismatch: ${reasons} — federation is off, continuing`);
      } else {
        log(`Shared stream OPENCLAW_SHARED verified (R=${streamInfo.config.num_replicas}, storage=${streamInfo.config.storage})`);
      }
    } catch (streamErr) {
      log(`Shared stream unavailable (${streamErr.message}) — continuing without federation stream`);
    }

    // Initialize agnostic extraction trigger (mesh.memory.extract_request.<NODE_ID>)
    try {
      extractionTrigger = createExtractionTrigger(natsConn, NODE_ID, {
        log,
        onExtract: async (payload) => {
          log(`[nats] extraction requested by ${payload.triggered_by || 'unknown'}`);
          await runRequestedFlush(sm.sessions, config);
        },
      });
      await extractionTrigger.start();
      log(`Extraction trigger initialized (idle threshold: ${process.env.EXTRACTION_IDLE_THRESHOLD_SEC || 2700}s)`);
    } catch (trigErr) {
      log(`Extraction trigger unavailable (${trigErr.message}) — continuing without trigger`);
    }

    // Federation subsystems — OPT-IN, default OFF. See section banner above.
    if (process.env.OPENCLAW_FEDERATION === '1') {
      try {
        await initFederationSubsystems(natsConn);
      } catch (fedErr) {
        log(`[federation] init failed (${fedErr.message}) — daemon continues without federation`);
      }
    }
    return true;
  } catch (e) {
    log(`NATS unavailable (${e.message}) — retrying every 60s until the broker is reachable`);
    return false;
  }
  }
  if (!(await initNatsSubsystems())) {
    natsRetryTimer = setInterval(async () => {
      if (!running) return;
      if (await initNatsSubsystems()) {
        clearInterval(natsRetryTimer);
        natsRetryTimer = null;
        log('NATS subsystems initialized on retry');
      }
    }, 60_000);
  }

  // ── Memory injection HTTP endpoint (Block 7 amendment B+D) ──────────
  // Loopback-only HTTP server at :7893 that companion-bridge calls per
  // prompt to fetch the [memory: ...] block. Shares the daemon's loaded
  // BGE-M3 model + SQLite handles + ollama-queue state, so BGE-M3 stays
  // warm across thousands of prompts (solves amendment D for free).
  // Opt out by setting MEMORY_INJECT_DISABLED=1.
  let injectionServer = null;
  if (process.env.MEMORY_INJECT_DISABLED !== '1') {
    try {
      const { startInjectionServer } = await import('../lib/memory-inject-server.mjs');
      injectionServer = await startInjectionServer(
        {
          knowledgeDb: getKnowledgeDb(), graphCache: getGraphCache(), llmClient: getLlmClient(),
          extractionDb: getExtractionStore()?.db, eventLog: liveEventLog, nodeId: NODE_ID,
          // A getter: federation starts with NATS, which can come up after this server.
          getFederation: () => federationState.federation,
        },
        { port: PATHS.injectPort, log: (m) => log(`[inject-server] ${m}`) },
      );
    } catch (injErr) {
      log(`Memory inject server unavailable (${injErr.message}) — companion-bridge injection will be silent`);
    }
  }

  // Graceful shutdown
  const shutdown = async (signal) => {
    log(`Received ${signal} — shutting down`);
    running = false;
    // R15 fix (repair 4.1): fence in-flight work BEFORE closing handles, and
    // own the exit instead of deferring it to the next interval fire — which
    // routinely outlived launchd's patience (every restart exited -9/-6 with
    // a native mutex abort in .err).
    if (tickInterval) clearInterval(tickInterval);
    if (natsRetryTimer) clearInterval(natsRetryTimer);
    stopQueueStateObserver();
    if (inFlightTick) {
      const drained = await Promise.race([
        inFlightTick.then(() => true).catch(() => true),
        new Promise((r) => setTimeout(r, 8000, false)),
      ]);
      log(drained ? 'in-flight tick drained' : 'tick still in flight after 8s grace — closing anyway');
    }
    if (extractionTrigger) {
      extractionTrigger.stop();
    }
    // Federation teardown (no-ops unless OPENCLAW_FEDERATION=1 wired them):
    // broadcast timer, subscriber, then federation.
    if (federationState.broadcastTimer) clearInterval(federationState.broadcastTimer);
    if (federationState.subscriber) {
      try { await federationState.subscriber.stop(); } catch (_) {}
    }
    if (federationState.federation) {
      try { await federationState.federation.stop(); } catch (_) {}
    }
    saveDaemonState(sm);
    if (healthProbeTimer) clearInterval(healthProbeTimer);
    if (memoryWatcher) {
      try { await memoryWatcher.stop(); } catch (_) {}
    }
    if (injectionServer) {
      try { await injectionServer.close(); } catch (_) {}
    }
    if (_graphCache) {
      try { _graphCache.close(); } catch (_) {}
    }
    if (_knowledgeDb) {
      try { _knowledgeDb.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
      try { _knowledgeDb.close(); } catch (_) {}
    }
    if (_extractionStore) {
      try { _extractionStore.close(); } catch (_) {}
    }
    if (_haStore) {
      try { _haStore.close(); } catch (_) {}
    }
    if (natsConn) {
      try { await natsConn.drain(); } catch (_) {}
    }
    if (federationState.knowledgeDb) {
      try { federationState.knowledgeDb.close(); } catch (_) {}
    }
    if (federationState.extractionDb) {
      try { federationState.extractionDb.close(); } catch (_) {}
    }
    log('Daemon stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Main tick loop
  async function tick() {
    if (!running) return;

    try {
      // 1. Detect activity. Sources are re-read from the registry every tick —
      // every other consumer already does; a startup-frozen copy made registry
      // edits invisible until restart (a stale entry hid a whole project's
      // sessions from extraction for a day, 2026-07-03).
      const activity = detectActivity(loadTranscriptSources(), config.intervals.activityWindowMs);

      // 2. Per-session state machine tick
      const transitions = sm.tick(activity);

      // 3. Handle transitions
      if (transitions.length > 0) {
        const booted = await handleTransitions(transitions, config);
        for (const sessionId of booted) sm.completeBoot(sessionId);
      }

      // 4. Phase 1: Status sync (when ACTIVE or IDLE)
      if (sm.state === STATES.ACTIVE || sm.state === STATES.IDLE) {
        runPhase1StatusSync(config, sm.state === STATES.ACTIVE ? 'active' : 'idle');
      }

      // 4.1. Reset extraction trigger idle timer on activity
      if (extractionTrigger && activity.active) {
        extractionTrigger.resetIdleTimer();
      }

      // 4.5. Phase 1.5: Session trace emission (real-time JSONL → observability feed)
      // Every recently-modified JSONL across ALL sources, as found by step 1's
      // scan: multiple agents may be active at once (Claude Code + gateway + etc.).
      // processNewEntries reads by offset, so a file that turned recent during
      // the transitions above is caught up on the next tick.
      if (sm.state === STATES.ACTIVE) {
        for (const full of activity.recentFiles) {
          try { traceEmitter.processNewEntries(full); } catch { /* skip unreadable files */ }
        }
      }

      // 5. HyperAgent maintenance is node-scoped, not session-scoped.
      await runHyperagentMaintenance(config);

      // 5.1. Phase 2: Throttled work (when ACTIVE or IDLE)
      if (sm.state === STATES.ACTIVE || sm.state === STATES.IDLE) {
        await runPhase2ThrottledWork(config, sm.sessions);
      }
      await runNodeVaultMaintenance(config);

      // 6. Persist state
      saveDaemonState(sm);

      // 6.5. Export the LLM queue snapshot for health-watch (R12, repair 3.3):
      // queue state is in-process memory; without this file a separate
      // process can only ever see its own empty queue.
      try { exportStateSnapshot(); } catch (snapErr) { log(`queue snapshot export failed: ${snapErr.message}`); }

    } catch (err) {
      log(`Tick error: ${err.message}`);
    }
  }

  // R3 fix: ticks routinely outlive pollMs (LLM extraction, Phase 0 bootstrap);
  // unguarded overlap re-runs the same throttled work off stale on-disk state.
  // Only a run that actually started is fenced: a skipped call must not
  // replace (and then null) the in-flight run shutdown waits for.
  const trackedTick = () => {
    const run = tick();
    inFlightTick = run;
    return run.finally(() => { if (inFlightTick === run) inFlightTick = null; });
  };
  // One legitimate tick can chain a 30-min flush worker, a 30-min
  // knowledge-index child and flushes queued behind them; force-clearing it
  // at 30 min started an overlapping tick that lost throttle-state updates.
  // The bound only recovers a truly wedged tick.
  const guardedTick = createConcurrencyGuard(trackedTick, { maxAgeMs: 2 * 60 * 60_000, log });

  // Run first tick immediately
  await guardedTick();

  // Schedule recurring ticks. Shutdown owns the exit (R15, repair 4.1).
  tickInterval = setInterval(async () => {
    if (!running) return;
    const result = await guardedTick();
    if (result?.skipped) log('tick skipped (in-flight)');
  }, config.intervals.pollMs);

  // setInterval handle above prevents Node from exiting
}

if (process.env.OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART !== '1') {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}

export { runNodeVaultMaintenance, handleFlushResult, sourceOfJsonl, extractedEventData, synthesizedEventData, detectActivity, handleTransitions, runPhase2ThrottledWork, runRequestedFlush };
