/**
 * memory-budget.mjs — MEMORY.md character budget + node memory session events
 *
 * Holds the MEMORY.md character cap (~2,200 chars, matching Hermes's proven
 * bound) the flush writes under, reports usage, and publishes
 * memory.session_started / memory.session_ended for the daemon's node session.
 * The flush writes MEMORY.md itself (lib/pre-compression-flush.mjs).
 *
 * EventEmitter events:
 *   - 'freeze'  { charCount, lineCount }
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('memory-budget');

const DEFAULT_CHAR_BUDGET = 2200;

export class MemoryBudget extends EventEmitter {
  #filePath;
  #charBudget;
  #frozenContent = null; // snapshot at session start
  #frozenAt = null;
  #eventLog = null;       // optional local event log for dual-write
  #sessionId = null;      // UUID generated per session for event entity_id
  #nodeId = null;         // node identifier for event envelope

  /**
   * @param {string} filePath - Absolute path to MEMORY.md
   * @param {Object} opts
   * @param {number} opts.charBudget - Character budget (default 2200)
   * @param {object} opts.eventLog - Optional local event log (from createLocalEventLog)
   * @param {string} opts.nodeId - Optional node identifier for event envelope
   */
  constructor(filePath, opts = {}) {
    super();
    this.#filePath = filePath;
    this.#charBudget = opts.charBudget || DEFAULT_CHAR_BUDGET;
    this.#eventLog = opts.eventLog || null;
    this.#nodeId = opts.nodeId || null;
  }

  get filePath() { return this.#filePath; }
  get charBudget() { return this.#charBudget; }
  get isFrozen() { return this.#frozenContent !== null; }

  // ── Session Lifecycle ────────────────────────────────────

  /**
   * Open the node's memory session (Phase 0 bootstrap) and note the
   * MEMORY.md content it started from.
   */
  startSession() {
    this.#frozenContent = this.#readFile();
    this.#frozenAt = Date.now();
    this.#sessionId = crypto.randomUUID();

    const stats = this.#computeStats(this.#frozenContent);
    this.emit('freeze', {
      charCount: this.#frozenContent.length,
      lineCount: this.#frozenContent.split('\n').length,
      ...stats,
    });

    // Dual-write: publish session_started event (fire-and-forget)
    this.#publishEvent('memory.session_started', {
      session_id: this.#sessionId,
      start_time: new Date().toISOString(),
      session_type: 'daemon',
    });

    return this.#frozenContent;
  }

  /**
   * Close the node's memory session (memory.session_ended).
   */
  endSession() {
    // Dual-write: publish session_ended event (fire-and-forget, before clearing state)
    if (this.#sessionId && this.#frozenAt) {
      this.#publishEvent('memory.session_ended', {
        session_id: this.#sessionId,
        end_time: new Date().toISOString(),
        duration_ms: Date.now() - this.#frozenAt,
        turn_count: 0,  // not tracked at this layer; accurate counts come from session-store
      });
    }

    this.#frozenContent = null;
    this.#frozenAt = null;
    this.#sessionId = null;
  }

  // ── Usage Meter ────────────────────────────────────

  /**
   * Get current budget usage stats.
   * @returns {{ usedChars: number, totalBudget: number, pctUsed: number, charsRemaining: number, lineCount: number, meterDisplay: string }}
   */
  getStats() {
    const content = this.#readFile();
    return this.#computeStats(content);
  }

  /**
   * Render a usage meter string for logging/display.
   * Example: "[67% — 1,474/2,200 chars]"
   */
  getMeterDisplay() {
    return this.#computeStats(this.#readFile()).meterDisplay;
  }

  // ── Event Log (dual-write) ────────────────────────────

  /**
   * Fire-and-forget publish to the local event log.
   * All errors are caught and silently ignored — the event log is
   * shadow-mode infrastructure and must never block the daemon.
   */
  #publishEvent(eventType, data) {
    if (!this.#eventLog) return;
    try {
      const eventId = crypto.randomUUID();
      const event = {
        event_id: eventId,
        event_type: eventType,
        event_version: 1,
        entity_id: this.#sessionId || crypto.randomUUID(),
        entity_type: 'session',
        timestamp: new Date().toISOString(),
        causation_id: null,
        correlation_id: null,
        actor: { type: 'system', id: `daemon-${this.#nodeId || 'unknown'}` },
        node_id: this.#nodeId || 'unknown',
        idempotency_key: eventId,
        data,
      };
      this.#eventLog.publishLocal(event).catch(() => {});
    } catch {
      // Silent — dual-write must never disrupt the primary path
    }
  }

  // ── Private Helpers ────────────────────────────────────

  #readFile() {
    if (!fs.existsSync(this.#filePath)) return '';
    return fs.readFileSync(this.#filePath, 'utf-8');
  }

  #pctUsed(content) {
    return Math.round((content.length / this.#charBudget) * 100);
  }

  #computeStats(content) {
    const usedChars = content.length;
    const pctUsed = this.#pctUsed(content);
    const charsRemaining = Math.max(0, this.#charBudget - usedChars);
    const lineCount = content.split('\n').length;
    const meterDisplay = `[${pctUsed}% — ${usedChars.toLocaleString()}/${this.#charBudget.toLocaleString()} chars]`;

    return { usedChars, totalBudget: this.#charBudget, pctUsed, charsRemaining, lineCount, meterDisplay };
  }
}

/**
 * Create a MemoryBudget instance with default OpenClaw paths.
 * @param {string} workspace - OpenClaw workspace root
 * @param {Object} opts - Options forwarded to MemoryBudget constructor
 */
const _createBudget = function createBudget(workspace, opts = {}) {
  const filePath = path.join(workspace, 'MEMORY.md');
  const instance = new MemoryBudget(filePath, opts);
  tracer.wrapClass(instance, [
    'startSession', 'endSession', 'getStats', 'getMeterDisplay',
  ], { tier: 3, category: 'io' });
  return instance;
};
export { _createBudget as createBudget };
