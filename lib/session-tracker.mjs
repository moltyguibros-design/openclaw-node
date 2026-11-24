/**
 * session-tracker.mjs — per-transcript session lifecycle for the memory daemon.
 *
 * Every transcript that is being written is its own session with its own
 * ENDED → BOOT → ACTIVE → IDLE → ENDED timers. Session identity used to be
 * "the newest .jsonl": with two transcripts written at once (two Claude Code
 * sessions, a gateway heartbeat beside one, a plan tick's `claude` run) the
 * newest file alternated and every flip ran a full end-of-session pipeline on
 * one session and a full bootstrap of the other.
 *
 * Timing per session matches the old single-session machine: a session counts
 * as active while its file changed within the activity window; it goes IDLE
 * activeThresholdMs after it stopped being active, and ENDED idleThresholdMs
 * after that.
 */

export const STATES = { ENDED: 'ENDED', BOOT: 'BOOT', ACTIVE: 'ACTIVE', IDLE: 'IDLE' };

const BOOT_TIMEOUT_MS = 60_000;
const STATE_RANK = { [STATES.ACTIVE]: 3, [STATES.IDLE]: 2, [STATES.BOOT]: 1 };

export class SessionTracker {
  #sessions = new Map();
  #lastEndedPath = null;
  #config;

  constructor(config) {
    this.#config = config;
  }

  /** The node-level state: the liveliest state of any tracked session. */
  get state() {
    let best = STATES.ENDED;
    for (const s of this.#sessions.values()) {
      if ((STATE_RANK[s.state] || 0) > (STATE_RANK[best] || 0)) best = s.state;
    }
    return best;
  }

  /** The most recently active session, for logs and daemon-state readers. */
  get sessionId() {
    let id = null;
    let latest = -Infinity;
    for (const [sid, s] of this.#sessions) {
      if (s.lastActivityTime > latest) { latest = s.lastActivityTime; id = sid; }
    }
    return id;
  }

  get lastActivityTime() {
    let latest = 0;
    for (const s of this.#sessions.values()) latest = Math.max(latest, s.lastActivityTime);
    return latest;
  }

  get sessions() {
    return [...this.#sessions].map(([sessionId, s]) => ({ sessionId, ...s }));
  }

  /**
   * @param {{ activeSessions: Array<{ sessionId: string, path: string }> }} activity
   *   transcripts written within the activity window
   * @returns {Array<{ from, to, sessionId, jsonlPath, othersLive?: boolean, previousJsonl?: string|null }>}
   *   a BOOT carries previousJsonl, the transcript of the last session that
   *   ENDED: with sessions running side by side the second-newest file is
   *   usually a live one, not the previous session.
   */
  tick(activity, now = Date.now()) {
    const { activeThresholdMs, idleThresholdMs } = this.#config.intervals;
    const active = new Map((activity.activeSessions || []).map(s => [s.sessionId, s]));
    const transitions = [];

    for (const [sessionId, s] of this.#sessions) {
      const seen = active.get(sessionId);
      if (seen) { s.lastActivityTime = now; s.path = seen.path; }
      const idleFor = now - s.lastActivityTime;
      const move = (to) => {
        transitions.push({ from: s.state, to, sessionId, jsonlPath: s.path });
        s.state = to;
      };

      switch (s.state) {
        case STATES.BOOT:
          if (now - s.bootStartTime > BOOT_TIMEOUT_MS) move(STATES.ACTIVE);
          break;
        case STATES.ACTIVE:
          if (idleFor > activeThresholdMs) move(STATES.IDLE);
          break;
        case STATES.IDLE:
          if (seen) move(STATES.ACTIVE);
          else if (idleFor > idleThresholdMs) {
            move(STATES.ENDED);
            this.#sessions.delete(sessionId);
            if (s.path) this.#lastEndedPath = s.path;
          }
          break;
      }
    }

    // Node-wide state (the node memory session, the node-wide boot steps) is
    // only closed when the last session ends and only opened when the first
    // one boots: of several sessions booting in one tick, only the first can
    // find none live.
    let othersLive = this.#sessions.size > 0;
    for (const [sessionId, seen] of active) {
      if (this.#sessions.has(sessionId)) continue;
      this.#sessions.set(sessionId, { state: STATES.BOOT, lastActivityTime: now, bootStartTime: now, path: seen.path });
      transitions.push({ from: STATES.ENDED, to: STATES.BOOT, sessionId, jsonlPath: seen.path, othersLive, previousJsonl: this.#lastEndedPath });
      othersLive = true;
    }

    for (const t of transitions) {
      if (t.to === STATES.ENDED) t.othersLive = this.#sessions.size > 0;
    }
    return transitions;
  }

  completeBoot(sessionId) {
    const s = this.#sessions.get(sessionId);
    if (s?.state !== STATES.BOOT) return null;
    s.state = STATES.ACTIVE;
    return { from: STATES.BOOT, to: STATES.ACTIVE, sessionId, jsonlPath: s.path };
  }

  toJSON() {
    return {
      state: this.state,
      sessionId: this.sessionId,
      lastActivityTime: this.lastActivityTime,
      sessions: this.sessions,
      lastEndedPath: this.#lastEndedPath,
    };
  }

  /**
   * Restore from daemon-state.json after a crash/restart. Every live session
   * resumes as IDLE: the next tick returns it to ACTIVE if its transcript is
   * still being written (no re-bootstrap) or ages it through the normal
   * IDLE → ENDED pipeline, which the old process never got to run.
   */
  restore(saved) {
    this.#sessions.clear();
    this.#lastEndedPath = saved?.lastEndedPath || null;
    if (!saved || !STATES[saved.state] || saved.state === STATES.ENDED) return;
    const list = Array.isArray(saved.sessions)
      ? saved.sessions
      : (saved.sessionId ? [{ sessionId: saved.sessionId, state: saved.state, lastActivityTime: saved.lastActivityTime }] : []);
    for (const s of list) {
      if (!s?.sessionId || !STATES[s.state] || s.state === STATES.ENDED) continue;
      this.#sessions.set(s.sessionId, {
        state: STATES.IDLE,
        lastActivityTime: s.lastActivityTime || 0,
        bootStartTime: 0,
        path: s.path || null,
      });
    }
  }
}
