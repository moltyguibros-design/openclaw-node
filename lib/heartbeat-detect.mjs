/**
 * heartbeat-detect.mjs — Detect if a heartbeat session is currently active
 *
 * A heartbeat session is an openclaw-gateway session triggered by the OpenClaw
 * platform's heartbeat scheduler. It is distinguishable from regular main sessions by:
 *   1. Source: appears in gateway sessions dir (~/.openclaw/agents/main/sessions/)
 *   2. Content: first user message contains "HEARTBEAT" or "Read HEARTBEAT.md"
 *   3. Size: typically small (< ~50 messages) compared to main sessions
 *   4. Recency: within the configured heartbeat window
 *
 * Used by Mission Control's /api/settings/heartbeat/status, which loads this
 * file at runtime (src/lib/heartbeat-detect.ts) instead of keeping its own copy.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';

const { createTracer } = createRequire(import.meta.url)('./tracer');
const tracer = createTracer('heartbeat-detect');

const HOME = os.homedir();

/**
 * @typedef {Object} HeartbeatStatus
 * @property {boolean} isActive - Whether a heartbeat session is currently active
 * @property {string|null} sessionId - The gateway session ID if active
 * @property {string|null} detectedAt - ISO timestamp of last heartbeat session mtime
 * @property {number|null} ageSeconds - How many seconds ago the session was last modified
 * @property {string} sessionType - "heartbeat" | "main" | "unknown"
 * @property {boolean} daemonActive - Whether any session is active (from daemon state)
 * @property {string|null} daemonSessionId - The daemon's current tracked session ID
 * @property {string} daemonState - The daemon's lifecycle state
 * @property {number|null} daemonLastActivityTime - The daemon's last activity time (epoch ms)
 */

// Also covers "Read HEARTBEAT.md", "heartbeat poll/check" and "bin/heartbeat".
const HEARTBEAT_PATTERN = /HEARTBEAT/i;

// The trigger sits in the first lines; a long main session is never read whole.
const HEAD_BYTES = 64 * 1024;

function readHead(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.toString('utf-8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Load transcript sources from config. Falls back to defaults if registry missing.
 * @param {string} openclawRoot - The ~/.openclaw root holding config/ and agents/
 * @returns {Array<{name: string, path: string, format: string, enabled?: boolean}>}
 */
function loadTranscriptSources(openclawRoot) {
  const registry = path.join(openclawRoot, 'config', 'transcript-sources.json');
  if (fs.existsSync(registry)) {
    try {
      const reg = JSON.parse(fs.readFileSync(registry, 'utf-8'));
      return (reg.sources || [])
        .filter(s => s.enabled !== false)
        .map(s => ({
          ...s,
          path: s.path.startsWith('~') ? path.join(HOME, s.path.slice(1)) : s.path,
        }));
    } catch { /* fall through */ }
  }
  // Default fallback
  return [
    { name: 'gateway', path: path.join(openclawRoot, 'agents', 'main', 'sessions'), format: 'openclaw-gateway' },
  ];
}

/**
 * Check if a JSONL file contains a heartbeat trigger message in its first N lines.
 * @param {string} filePath - Absolute path to the JSONL file
 * @param {number} [scanLines=15] - How many lines to scan
 * @returns {boolean}
 */
function isHeartbeatSession(filePath, scanLines = 15) {
  try {
    const lines = readHead(filePath).split('\n').slice(0, scanLines);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const msg = entry.message || entry.text || entry.content || '';
        const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
        if (HEARTBEAT_PATTERN.test(text)) return true;
      } catch { /* skip malformed line */ }
    }
  } catch { /* file unreadable */ }
  return false;
}

/**
 * Load the daemon state from .tmp/daemon-state.json.
 * @param {string} workspace - Path to workspace root
 * @returns {{ state: string, sessionId: string|null, lastActivityTime: number, pid: number, updatedAt: number } | null}
 */
function loadDaemonState(workspace) {
  const daemonFile = path.join(workspace, '.tmp/daemon-state.json');
  if (!fs.existsSync(daemonFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(daemonFile, 'utf-8'));
  } catch { return null; }
}

/**
 * Detect if a heartbeat session is currently active.
 *
 * Algorithm:
 * 1. Find the most recently modified gateway JSONL session
 * 2. Check if it's within the active window (default: 30 min)
 * 3. Check if it contains a heartbeat trigger message
 * 4. Enrich result with daemon state
 *
 * @param {Object} [options]
 * @param {string} [options.workspace] - Workspace root (defaults to OPENCLAW_WORKSPACE env or ~/.openclaw/workspace)
 * @param {string} [options.openclawRoot] - Root holding config/transcript-sources.json (defaults to ~/.openclaw)
 * @param {number} [options.activeWindowMs=1800000] - Max age in ms for a session to be considered active (default 30 min)
 * @returns {HeartbeatStatus}
 */
function detectHeartbeatImpl(options = {}) {
  const workspace = options.workspace
    || process.env.OPENCLAW_WORKSPACE
    || path.join(HOME, '.openclaw/workspace');
  const activeWindowMs = options.activeWindowMs ?? 30 * 60 * 1000;

  const sources = loadTranscriptSources(options.openclawRoot || path.join(HOME, '.openclaw'));
  const gatewaySources = sources.filter(s => s.format === 'openclaw-gateway');

  const daemonState = loadDaemonState(workspace);
  const daemonActive = daemonState?.state === 'ACTIVE' || daemonState?.state === 'IDLE';
  const daemonSessionId = daemonState?.sessionId || null;
  const daemonStateStr = daemonState?.state || 'UNKNOWN';
  const daemonLastActivityTime = daemonState?.lastActivityTime || null;

  let newestFile = null;
  let newestMtime = 0;
  let newestSessionId = null;

  for (const source of gatewaySources) {
    if (!fs.existsSync(source.path)) continue;
    let files;
    try {
      files = fs.readdirSync(source.path).filter(f => f.endsWith('.jsonl'));
    } catch { continue; }

    for (const f of files) {
      const fullPath = path.join(source.path, f);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newestFile = fullPath;
          newestSessionId = path.basename(f, '.jsonl');
        }
      } catch { /* skip */ }
    }
  }

  if (!newestFile || !newestMtime) {
    return {
      isActive: false,
      sessionId: null,
      detectedAt: null,
      ageSeconds: null,
      sessionType: 'unknown',
      daemonActive,
      daemonSessionId,
      daemonState: daemonStateStr,
      daemonLastActivityTime,
    };
  }

  const now = Date.now();
  const ageMs = now - newestMtime;
  const ageSeconds = Math.floor(ageMs / 1000);
  const detectedAt = new Date(newestMtime).toISOString();

  const withinWindow = ageMs <= activeWindowMs;
  const isHb = withinWindow && isHeartbeatSession(newestFile);

  return {
    isActive: isHb,
    sessionId: isHb ? newestSessionId : null,
    detectedAt: isHb ? detectedAt : null,
    ageSeconds: isHb ? ageSeconds : null,
    sessionType: withinWindow ? (isHb ? 'heartbeat' : 'main') : 'unknown',
    daemonActive,
    daemonSessionId,
    daemonState: daemonStateStr,
    daemonLastActivityTime,
  };
}

/**
 * Convenience: returns true if a heartbeat is currently active.
 * @param {Object} [options] - Same as detectHeartbeat options
 * @returns {boolean}
 */
function isHeartbeatActiveImpl(options = {}) {
  return detectHeartbeat(options).isActive;
}

export const detectHeartbeat = tracer.wrap('detectHeartbeat', detectHeartbeatImpl, { tier: 2, category: 'compute' });
export const isHeartbeatActive = tracer.wrap('isHeartbeatActive', isHeartbeatActiveImpl, { tier: 2, category: 'compute' });
