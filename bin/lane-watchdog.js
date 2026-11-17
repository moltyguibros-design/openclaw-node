#!/usr/bin/env node
/**
 * lane-watchdog.js — Gateway Lane Deadlock Recovery
 *
 * Monitors gateway logs for stuck lanes (agent timeout → lane deadlock).
 * When a lane is blocked beyond threshold, sends SIGUSR1 to trigger
 * resetAllLanes() inside the gateway process.
 *
 * Created: 2026-03-08 22:10 America/Montreal
 *
 * Pattern: same as gateway health-monitor (stale Discord socket → restart).
 * Difference: this catches lane-level deadlocks the health-monitor misses.
 *
 * Signals:
 *   - "embedded run timeout" in logs → agent timed out
 *   - "lane wait exceeded" with waitedMs > threshold → lane is stuck
 *   - Both together within window → deadlock confirmed, send SIGUSR1
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFile } = require('child_process');

// Every watchdog intervention (SIGUSR1 → resetAllLanes) is operator-worthy:
// if these recur, the gateway is deadlocking under load.
const NOTIFY_CLI = path.join(__dirname, 'openclaw-notify.mjs');
const MC_DIAG_URL = `${process.env.OPENCLAW_MC_URL || 'http://127.0.0.1:3000'}/diagnostics`;
function notifyIntervention(message) {
  try {
    execFile(process.execPath, [
      NOTIFY_CLI, '--source', 'lane-watchdog', '--kind', 'warn',
      '--title', 'Gateway lanes reset (SIGUSR1)', '--message', message,
      '--url', MC_DIAG_URL,
    ], { timeout: 10_000 }, () => {});
  } catch { /* best-effort */ }
}

// --- Configuration ---
const GATEWAY_LOG = process.env.GATEWAY_LOG
  || path.join(process.env.HOME, '.openclaw/logs/gateway.log');
// The launchd plist writes gateway.err.log; the systemd unit writes gateway.err.
const GATEWAY_ERR_LOG = process.env.GATEWAY_ERR_LOG
  || path.join(process.env.HOME, process.platform === 'darwin'
    ? '.openclaw/logs/gateway.err.log' : '.openclaw/logs/gateway.err');

const LANE_STUCK_THRESHOLD_MS = 5 * 60 * 1000;   // 5 min before intervention
const POLL_INTERVAL_MS = 15_000;                   // re-check for a missing or rotated log every 15s
const COOLDOWN_MS = 60_000;                        // 1 min cooldown after SIGUSR1
const INCIDENT_LOG = path.join(process.env.HOME, 'openclaw/shared/lane-watchdog.log');

// --- State ---
let lastInterventionAt = 0;
let logWatcher = null;
let errWatcher = null;

// Track detected events
const events = {
  agentTimeout: null,    // timestamp of last "embedded run timeout"
  laneWaitExceeded: null // { timestamp, waitedMs, lane }
};

// --- Helpers ---
function log(msg) {
  const ts = new Date().toISOString();
  const line = `${ts} [lane-watchdog] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(INCIDENT_LOG, line + '\n');
  } catch { /* best effort */ }
}

function getGatewayPid() {
  try {
    // Gateway runs as "openclaw-gateway" process (renamed by the framework)
    const out = execSync(
      'pgrep -x openclaw-gateway',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    const pids = out.split('\n').filter(Boolean);
    return pids.length > 0 ? parseInt(pids[0], 10) : null;
  } catch {
    return null;
  }
}

function sendSigusr1(pid, reason) {
  const now = Date.now();
  if (now - lastInterventionAt < COOLDOWN_MS) {
    log(`SKIP: cooldown active (${Math.round((COOLDOWN_MS - (now - lastInterventionAt)) / 1000)}s remaining)`);
    return false;
  }

  log(`INTERVENTION: sending SIGUSR1 to gateway pid=${pid} reason="${reason}"`);
  try {
    process.kill(pid, 'SIGUSR1');
    lastInterventionAt = now;
    log(`SIGUSR1 sent successfully. Gateway will resetAllLanes().`);
    notifyIntervention(`pid=${pid} reason="${reason}"`);
    // Clear tracked events after intervention
    events.agentTimeout = null;
    events.laneWaitExceeded = null;
    return true;
  } catch (err) {
    log(`ERROR: failed to send SIGUSR1: ${err.message}`);
    return false;
  }
}

// --- Log Line Parsing ---
function parseLine(line) {
  // Match: embedded run timeout
  // Example: 2026-03-08T21:31:23.589-05:00 [agent/embedded] embedded run timeout: runId=...
  if (line.includes('embedded run timeout')) {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
    const ts = tsMatch ? new Date(tsMatch[1]).getTime() : Date.now();
    events.agentTimeout = ts;
    log(`DETECTED: agent timeout at ${new Date(ts).toISOString()}`);
    checkForDeadlock();
    return;
  }

  // Match: lane wait exceeded
  // Example: [diagnostic] lane wait exceeded: lane=session:agent:main:main waitedMs=551882 queueAhead=0
  const laneMatch = line.match(/lane wait exceeded:.*?lane=(\S+)\s+waitedMs=(\d+)/);
  if (laneMatch) {
    const lane = laneMatch[1];
    const waitedMs = parseInt(laneMatch[2], 10);
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
    const ts = tsMatch ? new Date(tsMatch[1]).getTime() : Date.now();

    events.laneWaitExceeded = { timestamp: ts, waitedMs, lane };
    log(`DETECTED: lane "${lane}" waited ${Math.round(waitedMs / 1000)}s`);

    if (waitedMs >= LANE_STUCK_THRESHOLD_MS) {
      checkForDeadlock();
    }
    return;
  }

  // Match: LLM request timed out (failover error)
  if (line.includes('LLM request timed out') && line.includes('lane=')) {
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.+-]+)/);
    const ts = tsMatch ? new Date(tsMatch[1]).getTime() : Date.now();
    events.agentTimeout = ts;
    log(`DETECTED: LLM timeout at ${new Date(ts).toISOString()}`);
    checkForDeadlock();
    return;
  }
}

function checkForDeadlock() {
  // Case 1: Lane wait exceeded threshold on its own
  if (events.laneWaitExceeded && events.laneWaitExceeded.waitedMs >= LANE_STUCK_THRESHOLD_MS) {
    const pid = getGatewayPid();
    if (pid) {
      sendSigusr1(pid, `lane "${events.laneWaitExceeded.lane}" blocked for ${Math.round(events.laneWaitExceeded.waitedMs / 1000)}s`);
    } else {
      log('WARNING: gateway PID not found, cannot send signal');
    }
    return;
  }

  // Case 2: Agent timeout + lane wait within 2-minute window
  if (events.agentTimeout && events.laneWaitExceeded) {
    const timeDiff = Math.abs(events.agentTimeout - events.laneWaitExceeded.timestamp);
    if (timeDiff < 2 * 60 * 1000) {
      const pid = getGatewayPid();
      if (pid) {
        sendSigusr1(pid, `agent timeout + lane wait detected within ${Math.round(timeDiff / 1000)}s`);
      } else {
        log('WARNING: gateway PID not found, cannot send signal');
      }
    }
  }
}

// --- Log Tailing ---
// A missing log is waited for, not fatal: on a node where the gateway never
// ran, exiting made systemd/launchd respawn the watchdog every 5s. The poll
// also catches rotations fs.watch misses. Reads are serialized (a watch event
// during a read only marks it pending) and a trailing partial line is carried
// into the next read, so no line is parsed twice or split in two.
function tailLog(filePath, label, onLine = parseLine, { pollMs = POLL_INTERVAL_MS } = {}) {
  let offset = null;
  let ino = null;
  let partial = '';
  let watcher = null;
  let reading = false;
  let pending = false;
  let warnedMissing = false;
  let closed = false;

  function stopWatching() {
    if (watcher) watcher.close();
    watcher = null;
  }

  function check() {
    if (closed) return;
    if (reading) { pending = true; return; }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      if (!warnedMissing) log(`WARNING: log file not found: ${filePath} (re-checking every ${pollMs / 1000}s)`);
      warnedMissing = true;
      stopWatching();
      if (offset !== null) { offset = 0; ino = null; partial = ''; }
      return;
    }
    if (!watcher) {
      // The first sighting at startup tails from the end; a log that appears
      // later is all new.
      if (offset === null) offset = warnedMissing ? 0 : stat.size;
      log(`Tailing ${label}: ${filePath} (from byte ${offset})`);
      try {
        watcher = fs.watch(filePath, { persistent: true }, check);
        watcher.on('error', () => stopWatching());
      } catch (err) {
        log(`ERROR: watching ${label}: ${err.message}`);
      }
    }
    if (ino !== null && stat.ino !== ino) { offset = 0; partial = ''; stopWatching(); return check(); }
    ino = stat.ino;
    if (stat.size < offset) { offset = 0; partial = ''; }
    if (stat.size === offset) return;

    reading = true;
    const end = stat.size;
    let buffer = '';
    const stream = fs.createReadStream(filePath, { start: offset, end: end - 1, encoding: 'utf8' });
    stream.on('data', chunk => { buffer += chunk; });
    stream.on('error', (err) => { log(`ERROR: reading ${label}: ${err.message}`); finish(); });
    stream.on('end', () => {
      offset = end;
      const lines = (partial + buffer).split('\n');
      partial = lines.pop();
      for (const line of lines) if (line) onLine(line);
      finish();
    });
  }

  function finish() {
    reading = false;
    if (pending) { pending = false; check(); }
  }

  const timer = setInterval(check, pollMs);
  check();

  return {
    check,
    close() {
      closed = true;
      clearInterval(timer);
      stopWatching();
    },
  };
}

// --- Main ---
function main() {
  log('Starting lane watchdog');
  log(`Config: threshold=${LANE_STUCK_THRESHOLD_MS / 1000}s, poll=${POLL_INTERVAL_MS / 1000}s, cooldown=${COOLDOWN_MS / 1000}s`);

  const pid = getGatewayPid();
  if (pid) {
    log(`Gateway PID: ${pid}`);
  } else {
    log('WARNING: gateway not running — will retry on detection');
  }

  logWatcher = tailLog(GATEWAY_LOG, 'gateway.log');
  errWatcher = tailLog(GATEWAY_ERR_LOG, path.basename(GATEWAY_ERR_LOG));

  // Graceful shutdown
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      log(`Received ${sig}, shutting down`);
      if (logWatcher) logWatcher.close();
      if (errWatcher) errWatcher.close();
      process.exit(0);
    });
  }

  log('Lane watchdog active');
}

if (require.main === module) main();

module.exports = { tailLog, GATEWAY_ERR_LOG };
