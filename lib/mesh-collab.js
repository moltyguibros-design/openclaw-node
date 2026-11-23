/**
 * mesh-collab.js — Collaborative session management for N-node coordination.
 *
 * Extends the mesh task system with multi-node collaboration.
 * Each collaborative task spawns a session where N nodes work in rounds,
 * exchange reflections, and converge.
 *
 * Backed by MESH_COLLAB JetStream KV bucket (same pattern as mesh-tasks.js).
 */

const crypto = require('crypto');
const { StringCodec } = require('nats');
const { createTracer } = require('./tracer');
const sc = StringCodec();
const tracer = createTracer('mesh-collab');

const COLLAB_KV_BUCKET = 'MESH_COLLAB';

// ── Session Statuses ────────────────────────────────

const COLLAB_STATUS = {
  RECRUITING: 'recruiting',   // waiting for nodes to join
  ACTIVE: 'active',           // rounds in progress
  CONVERGED: 'converged',     // convergence reached, collecting artifacts
  COMPLETED: 'completed',     // done, artifacts merged
  ABORTED: 'aborted',         // something broke
};

// ── Collaboration Modes ─────────────────────────────

const COLLAB_MODE = {
  PARALLEL: 'parallel',             // all nodes work simultaneously
  SEQUENTIAL: 'sequential',         // nodes take turns in order
  REVIEW: 'review',                 // one leader + N reviewers
  CIRCLING_STRATEGY: 'circling_strategy', // 1 worker + 2 reviewers, asymmetric directed rounds
  // F-F4 addition: heterogeneous multi-role modes (F-N20)
  COOPERATIVE: 'cooperative',       // shared goal, differentiated roles, peer coordination
  COLLABORATIVE: 'collaborative',   // shared goal, shared roles, consensus-driven
  MANAGEMENT: 'management',         // coordinator node directs specialist worker nodes
};

// Modes with a live daemon protocol today. The rest are declared (F-N20) but
// their protocols are unbuilt — the daemon dispatch (step 3.1) refuses to start
// a session in an unimplemented mode rather than silently running the wrong one.
// cooperative → 3.2, collaborative → 3.3, management → Block 4.
const IMPLEMENTED_MODES = new Set([
  COLLAB_MODE.PARALLEL,
  COLLAB_MODE.SEQUENTIAL,
  COLLAB_MODE.REVIEW,
  COLLAB_MODE.CIRCLING_STRATEGY,
  COLLAB_MODE.COOPERATIVE,          // step 3.2
  COLLAB_MODE.COLLABORATIVE,        // step 3.3
]);

/** True if `mode` has a live daemon protocol; false for declared-but-unbuilt modes. */
function isModeImplemented(mode) {
  return IMPLEMENTED_MODES.has(mode);
}

// Mode-selection contract (step 3.4): a task expresses intent via the
// human-facing `preferred_mode`; the daemon maps it to the wire-level
// COLLAB_MODE. Decision table lives in docs/FEDERATION_SPEC.md §3.4.
//   adversarial   → circling_strategy  (high-stakes single artifact; 1 worker + 2 reviewers)
//   cooperative   → cooperative        (exploratory, no single owner; propose/integrate/rotate)
//   collaborative → collaborative      (decomposable work; split → parallel → merge + review)
const PREFERRED_MODE_MAP = {
  adversarial: COLLAB_MODE.CIRCLING_STRATEGY,
  cooperative: COLLAB_MODE.COOPERATIVE,
  collaborative: COLLAB_MODE.COLLABORATIVE,
};

/** Map a human-facing preferred_mode to its wire COLLAB_MODE, or null if unknown. */
function resolvePreferredMode(preferred) {
  return PREFERRED_MODE_MAP[preferred] || null;
}

// ── Convergence Strategies ──────────────────────────

const CONVERGENCE = {
  UNANIMOUS: 'unanimous',     // all nodes vote converged
  MAJORITY: 'majority',       // >= threshold fraction
  COORDINATOR: 'coordinator', // daemon decides
  METRIC: 'metric',           // mechanical test passes
};

// ── Session Factory ─────────────────────────────────

/**
 * Create a new collaboration session from a task's collaboration spec.
 *
 * @param {string} taskId — parent task ID
 * @param {object} collabSpec — the task.collaboration object
 */
// Collab mutations take node_id from the payload, so the token issued at join
// (returned only to the joiner) is the member's whole credential, as
// lease_token is a task owner's.
function hashMemberToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function issueMemberToken() {
  const token = crypto.randomBytes(16).toString('hex');
  return { token, hash: hashMemberToken(token) };
}

function createSession(taskId, collabSpec) {
  const sessionId = `collab-${taskId}-${Date.now()}`;
  // F-F4: validate mode; unknown modes must not silently fall back to PARALLEL.
  // 3.4: explicit wire `mode` wins; else the human-facing `preferred_mode` maps
  // to a mode; else PARALLEL. An unknown preferred_mode is rejected loud.
  const validModes = new Set(Object.values(COLLAB_MODE));
  if (collabSpec.preferred_mode && !resolvePreferredMode(collabSpec.preferred_mode)) {
    throw new Error(`createSession: unknown preferred_mode '${collabSpec.preferred_mode}'. Valid: ${Object.keys(PREFERRED_MODE_MAP).join(', ')}`);
  }
  const resolvedMode = collabSpec.mode || resolvePreferredMode(collabSpec.preferred_mode) || COLLAB_MODE.PARALLEL;
  if (!validModes.has(resolvedMode)) {
    throw new Error(`createSession: unknown mode '${resolvedMode}'. Valid modes: ${[...validModes].join(', ')}`);
  }
  return {
    session_id: sessionId,
    task_id: taskId,
    mode: resolvedMode,
    status: COLLAB_STATUS.RECRUITING,

    // Node management
    // Circling requires at least 3 nodes (1 worker + 2 reviewers).
    // Default to 3 for circling, 2 for other modes.
    min_nodes: collabSpec.min_nodes || (resolvedMode === COLLAB_MODE.CIRCLING_STRATEGY ? 3 : 2),
    // null = unlimited. Circling is exactly 1 worker + 2 reviewers: a 4th node
    // would run worker prompts on reviewer inputs and overwrite reviewerB's artifacts.
    max_nodes: resolvedMode === COLLAB_MODE.CIRCLING_STRATEGY
      ? Math.min(collabSpec.max_nodes || 3, 3)
      : (collabSpec.max_nodes || null),
    join_window_s: collabSpec.join_window_s || 30,
    nodes: [],

    // Round management
    current_round: 0,
    max_rounds: collabSpec.max_rounds || 5,
    rounds: [],

    // Convergence
    convergence: {
      type: collabSpec.convergence?.type || CONVERGENCE.UNANIMOUS,
      threshold: collabSpec.convergence?.threshold || 0.66,
      metric: collabSpec.convergence?.metric || null,
      // Min quorum: minimum number of valid votes required for convergence.
      // Prevents premature convergence when nodes die (e.g., 2/2 surviving = 100%
      // but only 2 of 5 recruited nodes). Defaults to min_nodes.
      min_quorum: collabSpec.convergence?.min_quorum || collabSpec.min_nodes || 2,
    },

    // Track how many nodes were recruited (immutable after recruiting closes)
    // Used to detect quorum loss when nodes die between rounds
    recruited_count: 0,

    // Scope strategy
    scope_strategy: collabSpec.scope_strategy || 'shared',

    // Heterogeneous collab: per-node role/soul assignments (Phase E)
    // Format: [{ soul: "blockchain-auditor", role: "solidity-dev" }, { soul: "identity-architect" }]
    // When set, recruiting assigns specific souls to joining nodes in order.
    // When null, all nodes run the same soul (homogeneous, backward compatible).
    node_roles: collabSpec.node_roles || null,

    // Sequential mode: turn tracking
    turn_order: [],           // node_ids in execution order
    current_turn: null,       // node_id of active node (sequential mode)
    turn_started_at: null,    // when current_turn got the turn (per-turn timeout)

    // Circling Strategy mode: asymmetric directed rounds
    // Only populated when mode === 'circling_strategy'. null for other modes.
    circling: resolvedMode === COLLAB_MODE.CIRCLING_STRATEGY ? {
      worker_node_id: null,           // assigned at recruiting close (node_roles[0])
      reviewerA_node_id: null,        // assigned at recruiting close — first non-worker
      reviewerB_node_id: null,        // assigned at recruiting close — second non-worker
      max_subrounds: collabSpec.max_subrounds || 3,
      current_subround: 0,
      current_step: 0,                // 0 = init, 1 = review pass, 2 = integration
      automation_tier: collabSpec.automation_tier || 2,
      artifacts: {},                  // keyed: sr{N}_step{S}_{nodeRole}_{artifactType}
      phase: 'init',                  // init | circling | finalization | complete
      artifact_failures: {},          // { nodeId_step: count } — retry tracking per node per step
      step_started_at: null,          // ISO timestamp — set by daemon at step start, used for timeout rehydration after restart
    } : null,

    // Cooperative mode: propose-all / integrate-one / rotate-integrator (step 3.2)
    // Only populated when mode === 'cooperative'. null for other modes.
    cooperative: resolvedMode === COLLAB_MODE.COOPERATIVE ? {
      integrator_order: [],           // node_ids in rotation order — set at recruiting close
      rounds_target: collabSpec.rounds || 3,
      current_integrator: null,       // node_id integrating THIS round (rotates each round)
      integrations: [],               // [{ round, integrator_node_id, artifact, proposers }]
    } : null,

    // Collaborative mode: decompose → per-node subtasks (parallel) → merge + merge-review (3.3)
    // Only populated when mode === 'collaborative'. null for other modes.
    collaborative: resolvedMode === COLLAB_MODE.COLLABORATIVE ? {
      merger_node_id: null,           // set at recruiting close — assembles the subtask results
      phase: 'work',                  // work (parallel subtasks) → merge (merge + review) → done
      subtasks: {},                   // node_id → subtask result summary (from the work round)
      merged: null,                   // { summary, artifacts } produced by the merger
      review_votes: [],               // [{ node_id, vote, confidence }] from the merge-reviewers
    } : null,

    // Result (filled at completion)
    result: null,

    // Structured audit log — append-only event trail for post-mortem debugging.
    // Each entry: { ts, event, detail }
    audit_log: [],

    // Timestamps
    created_at: new Date().toISOString(),
    recruiting_deadline: null,  // set when first node joins
    completed_at: null,
  };
}

// ── CollabStore (KV-backed) ─────────────────────────

// Rate-limit audit error logs: max 3 per session, then go silent
const _auditErrorCounts = new Map();
const AUDIT_ERROR_LOG_LIMIT = 3;

// Sessions are kept forever (audit mesh-core~2#18, option C), so the daemon's
// 5s recruiting check, its round/step sweeps, the stall detector and every
// agent's recruiting poll read only the sessions this key lists, not the whole
// bucket. It maps session_id -> status for recruiting and active sessions.
const LIVE_INDEX_KEY = 'index.live';
const LIVE_STATUSES = new Set([COLLAB_STATUS.RECRUITING, COLLAB_STATUS.ACTIVE]);

const isCasConflict = (err) => err.code === '10071' || (err.message && err.message.includes('wrong last sequence'));

class CollabStore {
  constructor(kv) {
    this.kv = kv;
    // This process's view of LIVE_INDEX_KEY; null until the first indexed read
    // rebuilds it from a full scan (sessions written before the index existed,
    // or a write whose index update failed).
    this._liveIndex = null;
    tracer.wrapClass(this, [
      'put', 'get', 'delete', 'list', 'findByTaskId', 'findActiveSessionsByNode',
      'addNode', 'removeNode', 'setNodeStatus', 'startRound',
      'submitReflection', 'advanceTurn', 'storeArtifact',
      'markConverged', 'markCompleted', 'markAborted'
    ], { tier: 1, category: 'state_transition' });
  }

  async put(session) {
    await this.kv.put(session.session_id, sc.encode(JSON.stringify(session)));
    await this._syncLiveIndex(session.session_id, session.status);
    return session;
  }

  async _readLiveIndex() {
    const entry = await this.kv.get(LIVE_INDEX_KEY);
    return { index: entry?.value?.length ? JSON.parse(sc.decode(entry.value)) : {}, revision: entry?.revision ?? 0 };
  }

  /** Record a session's status in the live index, or drop it once it is no longer live. */
  async _syncLiveIndex(sessionId, status) {
    const want = LIVE_STATUSES.has(status) ? status : null;
    if (this._liveIndex && (this._liveIndex[sessionId] ?? null) === want) return;
    try {
      for (let attempt = 0; ; attempt++) {
        const { index, revision } = await this._readLiveIndex();
        if ((index[sessionId] ?? null) !== want) {
          if (want) index[sessionId] = want;
          else delete index[sessionId];
          try {
            // put with previousSeq, not update: revision 0 (no index yet) is a create.
            await this.kv.put(LIVE_INDEX_KEY, sc.encode(JSON.stringify(index)), { previousSeq: revision });
          } catch (err) {
            if (isCasConflict(err) && attempt < 4) continue;
            throw err;
          }
        }
        if (this._liveIndex) this._liveIndex = index;
        return;
      }
    } catch (err) {
      // The session write stands; the next indexed read rebuilds the index.
      this._liveIndex = null;
      console.error(`[collab] live index update for ${sessionId} failed: ${err.message}`);
    }
  }

  /** Rebuild the live index from every session in the bucket. */
  async rebuildLiveIndex() {
    for (let attempt = 0; ; attempt++) {
      const { revision } = await this._readLiveIndex();
      const index = {};
      for (const session of await this._scan()) {
        if (LIVE_STATUSES.has(session.status)) index[session.session_id] = session.status;
      }
      try {
        // A session written during the scan moves the index on; rescan rather than overwrite it.
        await this.kv.put(LIVE_INDEX_KEY, sc.encode(JSON.stringify(index)), { previousSeq: revision });
        this._liveIndex = index;
      } catch (err) {
        if (isCasConflict(err) && attempt < 4) continue;
        this._liveIndex = null;
        console.error(`[collab] live index rebuild failed: ${err.message}`);
      }
      return index;
    }
  }

  /** The recruiting or active sessions with `status`, read through the live index. */
  async _listLive(status) {
    const index = this._liveIndex ? (await this._readLiveIndex()).index : await this.rebuildLiveIndex();
    const sessions = [];
    for (const sessionId of Object.keys(index)) {
      const session = await this.get(sessionId);
      // A session another writer (Mission Control's intervene route) moved on
      // without the index: drop it here.
      if (!session || !LIVE_STATUSES.has(session.status)) {
        await this._syncLiveIndex(sessionId, session?.status ?? null);
        continue;
      }
      if (session.status === status) sessions.push(session);
    }
    return sessions;
  }

  async get(sessionId) {
    const entry = await this.kv.get(sessionId);
    if (!entry?.value?.length) return null;
    return JSON.parse(sc.decode(entry.value));
  }

  /**
   * Compare-and-swap helper: read → mutate → write with optimistic concurrency.
   * Re-reads and retries on conflict (up to maxRetries).
   * mutateFn receives the parsed data and must return the updated object, or falsy to skip.
   */
  async _updateWithCAS(key, mutateFn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const entry = await this.kv.get(key);
      if (!entry?.value?.length) return null;
      const data = JSON.parse(sc.decode(entry.value));
      const before = data.status;
      const updated = mutateFn(data);
      if (!updated) return null;
      try {
        await this.kv.update(key, sc.encode(JSON.stringify(updated)), entry.revision);
      } catch (err) {
        if (!isCasConflict(err) || attempt === maxRetries - 1) throw err;
        continue; // CAS conflict — retry
      }
      if (updated.status !== before) await this._syncLiveIndex(key, updated.status);
      return updated;
    }
  }

  async delete(sessionId) {
    await this.kv.delete(sessionId);
  }

  /**
   * Append an entry to the session's audit log. Fire-and-forget.
   */
  async appendAudit(sessionId, event, detail = {}) {
    try {
      await this._updateWithCAS(sessionId, (session) => {
        if (!session.audit_log) session.audit_log = [];
        session.audit_log.push({
          ts: new Date().toISOString(),
          event,
          ...detail,
        });
        return session;
      });
    } catch (err) {
      // Best-effort — never block on audit, but log first N failures per session
      const count = (_auditErrorCounts.get(sessionId) || 0) + 1;
      _auditErrorCounts.set(sessionId, count);
      if (count <= AUDIT_ERROR_LOG_LIMIT) {
        console.error(`[collab] audit append failed for ${sessionId}/${event}: ${err.message}${count === AUDIT_ERROR_LOG_LIMIT ? ' (suppressing further audit errors for this session)' : ''}`);
      }
    }
  }

  /**
   * List all sessions, optionally filtered.
   */
  async list(filter = {}) {
    const candidates = LIVE_STATUSES.has(filter.status) ? await this._listLive(filter.status) : await this._scan();
    const sessions = candidates.filter(session =>
      (!filter.status || session.status === filter.status)
      && (!filter.task_id || session.task_id === filter.task_id));
    sessions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return sessions;
  }

  /** Every session in the bucket (full scan). */
  async _scan() {
    const allKeys = [];
    for await (const key of await this.kv.keys()) {
      if (key !== LIVE_INDEX_KEY) allKeys.push(key);
    }
    const sessions = [];
    for (const key of allKeys) {
      const entry = await this.kv.get(key);
      if (!entry?.value?.length) continue;
      sessions.push(JSON.parse(sc.decode(entry.value)));
    }
    return sessions;
  }

  /**
   * Find session by task ID.
   */
  async findByTaskId(taskId) {
    const sessions = await this.list({ task_id: taskId });
    return sessions[0] || null;
  }

  /** Find active sessions that contain a given node. */
  async findActiveSessionsByNode(nodeId) {
    const active = await this._listLive(COLLAB_STATUS.ACTIVE);
    return active.filter(session => session.nodes.some(n => n.node_id === nodeId));
  }

  // ── Node Management ────────────────────────────────

  /**
   * Add a node to the session.
   * Returns the updated session or null if session full/closed.
   */
  async addNode(sessionId, nodeId, role = 'worker', scope = '*', { tokenHash = null } = {}) {
    return this._updateWithCAS(sessionId, (session) => {
      if (session.status !== COLLAB_STATUS.RECRUITING) return null;

      // Check max_nodes
      if (session.max_nodes && session.nodes.length >= session.max_nodes) return null;

      // Check duplicate
      if (session.nodes.find(n => n.node_id === nodeId)) return null;

      session.nodes.push({
        node_id: nodeId,
        role,
        scope: Array.isArray(scope) ? scope : [scope],
        joined_at: new Date().toISOString(),
        status: 'active',
        token_hash: tokenHash,
      });

      // Set recruiting deadline on first join
      if (session.nodes.length === 1) {
        session.recruiting_deadline = new Date(
          Date.now() + session.join_window_s * 1000
        ).toISOString();
      }

      // For sequential mode, build turn order
      if (session.mode === COLLAB_MODE.SEQUENTIAL) {
        session.turn_order.push(nodeId);
      }

      return session;
    });
  }

  /**
   * Whether `token` is the member token issued to `nodeId` when it joined.
   * Only the hash is stored, so a reader of the session KV cannot replay it.
   */
  static memberTokenMatches(session, nodeId, token) {
    const node = session?.nodes?.find(n => n.node_id === nodeId);
    if (!node?.token_hash || typeof token !== 'string' || !token) return false;
    const presented = Buffer.from(hashMemberToken(token), 'hex');
    const stored = Buffer.from(node.token_hash, 'hex');
    return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
  }

  /**
   * Remove a node from the session (graceful leave or kick).
   */
  async removeNode(sessionId, nodeId) {
    return this._updateWithCAS(sessionId, (session) => {
      // A sequential member leaving on its own turn hands the turn on; left in
      // place, advanceTurn would find no index and restart the order.
      if (session.current_turn === nodeId) {
        session.current_turn = session.turn_order[session.turn_order.indexOf(nodeId) + 1] ?? null;
        session.turn_started_at = new Date().toISOString();
      }
      session.nodes = session.nodes.filter(n => n.node_id !== nodeId);
      session.turn_order = session.turn_order.filter(id => id !== nodeId);
      return session;
    });
  }

  /**
   * Update a node's status within the session.
   */
  async setNodeStatus(sessionId, nodeId, status) {
    return this._updateWithCAS(sessionId, (session) => {
      const node = session.nodes.find(n => n.node_id === nodeId);
      if (node) node.status = status;
      return session;
    });
  }

  /**
   * Check if recruiting window should close.
   * Returns true if deadline passed OR max_nodes reached.
   * The caller (daemon) decides whether to start or abort based on node count.
   */
  isRecruitingDone(session) {
    if (session.max_nodes && session.nodes.length >= session.max_nodes) return true;
    if (session.recruiting_deadline && new Date() >= new Date(session.recruiting_deadline)) return true;
    return false;
  }

  // ── Round Management ───────────────────────────────

  /**
   * Start a new round. Returns the round object with shared_intel.
   */
  async startRound(sessionId) {
    let round = null;
    const result = await this._updateWithCAS(sessionId, (session) => {
      if (session.status !== COLLAB_STATUS.RECRUITING && session.status !== COLLAB_STATUS.ACTIVE) return null;
      session.current_round++;
      session.status = COLLAB_STATUS.ACTIVE;

      // Snapshot recruited count on first round (immutable baseline for quorum)
      if (session.current_round === 1) {
        session.recruited_count = session.nodes.length;
      }

      // Per-round node health: prune nodes marked 'dead' before starting.
      const deadNodes = session.nodes.filter(n => n.status === 'dead');
      if (deadNodes.length > 0) {
        session.nodes = session.nodes.filter(n => n.status !== 'dead');
        session.turn_order = session.turn_order.filter(
          id => !deadNodes.find(d => d.node_id === id)
        );
      }

      // Check if we still have enough nodes after pruning
      if (session.nodes.length < session.min_nodes) {
        session.status = COLLAB_STATUS.ABORTED;
        round = null;
        return session;
      }

      // Compile shared intel from previous round
      const sharedIntel = this.compileSharedIntel(session);

      round = {
        round_number: session.current_round,
        started_at: new Date().toISOString(),
        completed_at: null,
        shared_intel: sharedIntel,
        reflections: [],
      };

      session.rounds.push(round);

      // Sequential mode: set first turn
      if (session.mode === COLLAB_MODE.SEQUENTIAL && session.turn_order.length > 0) {
        session.current_turn = session.turn_order[0];
        session.turn_started_at = round.started_at;
      }

      return session;
    });

    if (!result) return null;
    return round;
  }

  /**
   * Submit a reflection from a node for the current round.
   */
  async submitReflection(sessionId, reflection) {
    return this._updateWithCAS(sessionId, (session) => {
      // Only accept reflections on active sessions
      if (session.status !== COLLAB_STATUS.ACTIVE) return null;

      const currentRound = session.rounds[session.rounds.length - 1];
      if (!currentRound) return null;

      // Membership gate (deep-review P1 #7): a node removed from the session (or
      // never in it) must not count toward the barrier — a zombie's late reflection
      // used to inflate reflections.length and trip isRoundComplete early.
      if (!session.nodes.find(n => n.node_id === reflection.node_id)) return null;

      // Prevent duplicate reflections from same node
      if (currentRound.reflections.find(r => r.node_id === reflection.node_id)) return null;

      currentRound.reflections.push({
        node_id: reflection.node_id,
        summary: reflection.summary || '',
        learnings: reflection.learnings || '',
        artifacts: reflection.artifacts || [],
        confidence: reflection.confidence ?? 0.5,
        vote: reflection.vote || 'continue',
        parse_failed: reflection.parse_failed || false,
        submitted_at: new Date().toISOString(),
        circling_step: reflection.circling_step ?? null,
        circling_artifacts: reflection.circling_artifacts || [],
      });

      // Update node status
      const node = session.nodes.find(n => n.node_id === reflection.node_id);
      if (node) node.status = 'reflecting';

      return session;
    });
  }

  /**
   * Check if all reflections for the current round have been received.
   */
  isRoundComplete(session) {
    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound) return false;

    // Count only reflections from CURRENTLY-ACTIVE members (P1 #7 defense in
    // depth): raw reflections.length let a since-removed node's entry stand in
    // for a live member that never reflected.
    const activeNodes = session.nodes.filter(n => n.status !== 'dead');
    if (activeNodes.length === 0) return false;
    const reflected = new Set(currentRound.reflections.map(r => r.node_id));
    return activeNodes.every(n => reflected.has(n.node_id));
  }

  /** Mark the given members dead (round-timeout sweep, P1 #4). CAS-safe. */
  async markNodesDead(sessionId, nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return this.get(sessionId);
    return this._updateWithCAS(sessionId, (session) => {
      let changed = false;
      for (const id of nodeIds) {
        const n = session.nodes.find(x => x.node_id === id);
        if (n && n.status !== 'dead') { n.status = 'dead'; changed = true; }
      }
      return changed ? session : null;
    });
  }

  /**
   * Atomically claim the recruit-close dispatch (twin of claimRoundEvaluation).
   * The Nth join and the 5s recruiting sweep both call startRecruitedSession;
   * its old guard was a plain read of `status === RECRUITING`, which both
   * callers could pass before startRound flipped the status — round 1 then
   * started twice, and the second start was published as round 2 with
   * "(First round — no prior intelligence.)" (CI, 2026-09-08). One winner;
   * losers get null.
   */
  async claimRecruitClose(sessionId) {
    return this._updateWithCAS(sessionId, (session) => {
      if (session.status !== COLLAB_STATUS.RECRUITING || session.recruit_close_claimed) return null;
      if (!this.isRecruitingDone(session)) return null;
      session.recruit_close_claimed = new Date().toISOString();
      return session;
    });
  }

  /**
   * Atomically claim the current round for evaluation (P1 #6). evaluateRound can
   * be reached from the reflect barrier, the leave handler, and the round-timeout
   * sweep concurrently; without a claim, two callers both integrate/advance and
   * the session double-fires. Exactly one caller wins (round stamped
   * `evaluated` + `completed_at` under CAS); losers get null.
   */
  async claimRoundEvaluation(sessionId) {
    return this._updateWithCAS(sessionId, (session) => {
      const currentRound = session.rounds[session.rounds.length - 1];
      if (!currentRound || currentRound.evaluated) return null;
      currentRound.evaluated = true;
      currentRound.completed_at = new Date().toISOString();
      return session;
    });
  }

  /**
   * Advance to next turn in sequential mode.
   * Returns the next node_id, or null if all turns done (round complete).
   */
  async advanceTurn(sessionId) {
    let nextTurn = null;
    await this._updateWithCAS(sessionId, (session) => {
      if (session.mode !== COLLAB_MODE.SEQUENTIAL) return null;
      if (session.status !== 'active') return null;

      const currentIdx = session.turn_order.indexOf(session.current_turn);
      const nextIdx = currentIdx + 1;

      if (nextIdx >= session.turn_order.length) {
        session.current_turn = null;
        nextTurn = null;
      } else {
        session.current_turn = session.turn_order[nextIdx];
        nextTurn = session.current_turn;
      }
      session.turn_started_at = new Date().toISOString();

      return session;
    });
    return nextTurn;
  }

  // ── Convergence ────────────────────────────────────

  /**
   * Check if convergence criteria are met for the current round.
   */
  checkConvergence(session) {
    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound || currentRound.reflections.length === 0) return false;

    const reflections = currentRound.reflections;
    const parseFailures = reflections.filter(r => r.parse_failed);
    const validReflections = reflections.filter(r => !r.parse_failed);
    const convergedCount = validReflections.filter(r => r.vote === 'converged').length;
    const minQuorum = session.convergence.min_quorum || session.min_nodes || 2;

    // Quorum check: enough valid votes must exist to make a decision.
    // Prevents premature convergence when nodes die (e.g., 5 recruited, 2 die,
    // 2 remaining vote converged = 100% threshold but only 2 of 5 nodes voted).
    if (validReflections.length < minQuorum) return false;

    // Parse failures are never counted as convergence votes.
    // If ANY reflection failed to parse, unanimous is impossible.
    // For majority, only valid votes count in both numerator and denominator.

    switch (session.convergence.type) {
      case CONVERGENCE.UNANIMOUS:
        // All nodes must have valid, converged votes. Any parse failure blocks unanimity.
        if (parseFailures.length > 0) return false;
        return convergedCount === reflections.length && reflections.length > 0;

      case CONVERGENCE.MAJORITY: {
        // Only valid votes count. Parse failures are excluded from both sides.
        // Threshold computed against valid votes only.
        return (convergedCount / validReflections.length) >= session.convergence.threshold;
      }

      case CONVERGENCE.COORDINATOR:
        // Coordinator mode: daemon decides externally. Always return false here.
        // The daemon calls markConverged() directly when it decides.
        return false;

      case CONVERGENCE.METRIC:
        // Metric mode: checked externally by running the metric command.
        // The daemon calls markConverged() after metric passes.
        return false;

      default:
        return false;
    }
  }

  /**
   * Check if max rounds exceeded (safety cap).
   */
  isMaxRoundsReached(session) {
    return session.current_round >= session.max_rounds;
  }

  // ── Circling Strategy: Artifact Store ──────────────

  /**
   * Store a typed artifact from a circling step.
   * Key format: sr{N}_step{S}_{nodeRole}_{artifactType}
   */
  async storeArtifact(sessionId, key, content) {
    try {
      return await this._updateWithCAS(sessionId, (session) => {
        if (!session.circling) return null;
        session.circling.artifacts[key] = content;

        // Session blob size check — JetStream KV max is 1MB.
        const blobSize = Buffer.byteLength(JSON.stringify(session), 'utf8');
        if (blobSize > 950_000) {
          console.error(`[collab] CRITICAL: session ${sessionId} blob is ${(blobSize / 1024).toFixed(0)}KB — approaching JetStream KV 1MB limit`);
        } else if (blobSize > 800_000) {
          console.warn(`[collab] WARNING: session ${sessionId} blob is ${(blobSize / 1024).toFixed(0)}KB — consider external artifact store`);
        }
        return session;
      });
    } catch (err) {
      // A blob overflow or persistent conflict: the stored session never had this
      // artifact, so there is nothing to write back.
      console.error(`[collab] storeArtifact FAILED for ${sessionId}/${key}: ${err.message}`);
      return null;
    }
  }

  /**
   * Retrieve an artifact by key.
   */
  getArtifactByKey(session, key) {
    if (!session || !session.circling) return null;
    return session.circling.artifacts[key] || null;
  }

  /**
   * Find the most recent version of an artifact type from a given role.
   * Scans backward from current_subround to sr0_step0 (init).
   * Returns null if not found.
   */
  getLatestArtifact(session, nodeRole, artifactType) {
    if (!session || !session.circling) return null;
    const { current_subround, artifacts } = session.circling;

    // Step 0 is init at SR0 and finalization at the last SR, where it is newer
    // than that SR's step 2 (the daemon keys finalization as sr{N}_step0_*).
    for (let sr = current_subround; sr >= 0; sr--) {
      for (const step of sr === 0 ? [0] : [0, 2, 1]) {
        const key = `sr${sr}_step${step}_${nodeRole}_${artifactType}`;
        if (artifacts[key] !== undefined) return artifacts[key];
      }
    }
    return null;
  }

  /**
   * Build node-specific directed input for a circling step.
   * Uses the information flow matrix from the Circling Strategy protocol spec (§5).
   *
   * Returns a string containing the directed artifacts for this node at this step.
   */
  compileDirectedInput(session, nodeId, taskDescription) {
    if (!session || !session.circling) return '';
    const { phase, current_subround, current_step } = session.circling;
    const node = session.nodes.find(n => n.node_id === nodeId);
    if (!node) return '';

    const isWorker = nodeId === session.circling.worker_node_id;
    const parts = [];

    const myReviewerRole = isWorker ? null
      : nodeId === session.circling.reviewerA_node_id ? 'reviewerA' : 'reviewerB';

    // Helper: add artifact to parts, handling null (required vs optional)
    const addArtifact = (label, nodeRole, artifactType, required) => {
      const content = this.getLatestArtifact(session, nodeRole, artifactType);
      if (content !== null) {
        parts.push(`## ${label}\n\n${content}`);
      } else if (required) {
        parts.push(`## ${label}\n\n[UNAVAILABLE: ${nodeRole}'s ${artifactType} was not produced — proceed with available inputs only]`);
      }
      // If not required and null, skip silently
    };

    switch (phase) {
      case 'init':
        parts.push(`## Task Plan\n\n${taskDescription || '(no description)'}`);
        break;

      case 'circling':
        if (current_step === 1) {
          // Step 1 — Review Pass
          if (isWorker) {
            // Worker receives: both reviewStrategies
            addArtifact('Reviewer A Strategy', 'reviewerA', 'reviewStrategy', true);
            addArtifact('Reviewer B Strategy', 'reviewerB', 'reviewStrategy', true);
            // SR2+: also include reviewArtifacts so Worker can assess whether
            // strategies are producing useful reviews (evidence alongside methodology)
            if (current_subround > 1) {
              addArtifact('Reviewer A — Review Findings', 'reviewerA', 'reviewArtifact', false);
              addArtifact('Reviewer B — Review Findings', 'reviewerB', 'reviewArtifact', false);
            }
          } else {
            // Reviewer receives: workArtifact + reconciliationDoc (optional in SR1)
            addArtifact('Work Artifact', 'worker', 'workArtifact', true);
            addArtifact('Reconciliation Document', 'worker', 'reconciliationDoc', current_subround > 1);
          }
        } else if (current_step === 2) {
          // Step 2 — Integration + Refinement
          if (isWorker) {
            // Worker receives: both reviewArtifacts
            addArtifact('Reviewer A Review', 'reviewerA', 'reviewArtifact', true);
            addArtifact('Reviewer B Review', 'reviewerB', 'reviewArtifact', true);
          } else {
            // Reviewer receives: workerReviewsAnalysis + cross-review from the other reviewer.
            // Cross-review enables inter-reviewer learning: "B caught something my
            // methodology missed — I should incorporate that lens."
            addArtifact('Worker Reviews Analysis', 'worker', 'workerReviewsAnalysis', true);
            const otherReviewerRole = (myReviewerRole === 'reviewerA') ? 'reviewerB' : 'reviewerA';
            addArtifact(`Cross-Review — ${otherReviewerRole} Findings`, otherReviewerRole, 'reviewArtifact', false);
          }
        }
        break;

      case 'finalization':
        parts.push(`## Original Task Plan\n\n${taskDescription || '(no description)'}`);
        addArtifact('Final Work Artifact', 'worker', 'workArtifact', true);
        break;
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Check if all nodes have submitted for the current circling step.
   */
  isCirclingStepComplete(session) {
    if (!session || !session.circling) return false;
    const currentRound = session.rounds[session.rounds.length - 1];
    if (!currentRound) return false;

    const activeNodes = session.nodes.filter(n => n.status !== 'dead');
    if (activeNodes.length === 0) return false;
    // For circling, reflections per step are tagged. Count reflections matching current step.
    const stepReflections = currentRound.reflections.filter(
      r => r.circling_step === session.circling.current_step
    );
    return stepReflections.length >= activeNodes.length;
  }

  /**
   * Advance the circling state machine.
   * Returns { phase, subround, step, needsGate } describing the new state.
   *
   * State machine transitions:
   *   init/step0                              → circling/SR1/step1
   *   circling/step1                          → circling/step2 (same SR)
   *   circling/step2, all converged, SR < max → finalization/step0  (paper §14.1 early exit)
   *   circling/step2, not converged, SR < max → circling/SR+1/step1
   *   circling/step2, SR == max               → finalization/step0
   *   finalization/step0                      → complete
   */
  async advanceCirclingStep(sessionId) {
    let stepResult = null;
    const result = await this._updateWithCAS(sessionId, (session) => {
      if (!session.circling) return null;

      const c = session.circling;
      let needsGate = false;

      if (c.phase === 'init' && c.current_step === 0) {
        c.phase = 'circling';
        c.current_subround = 1;
        c.current_step = 1;
      } else if (c.phase === 'circling' && c.current_step === 1) {
        c.current_step = 2;
      } else if (c.phase === 'circling' && c.current_step === 2) {
        const currentRound = session.rounds[session.rounds.length - 1];
        const activeNodes = session.nodes.filter(n => n.status !== 'dead');
        const step2Reflections = currentRound
          ? currentRound.reflections.filter(r => r.circling_step === 2)
          : [];
        const allConverged = step2Reflections.length >= activeNodes.length &&
                             step2Reflections.every(r => r.vote === 'converged');

        if (allConverged && c.current_subround < c.max_subrounds) {
          if (c.automation_tier >= 2) {
            needsGate = true;
          }
          c.phase = 'finalization';
          c.current_step = 0;
        } else if (c.current_subround < c.max_subrounds) {
          if (c.automation_tier === 3) {
            needsGate = true;
          }
          c.current_subround++;
          c.current_step = 1;
        } else {
          if (c.automation_tier >= 2) {
            needsGate = true;
          }
          c.phase = 'finalization';
          c.current_step = 0;
        }
      } else if (c.phase === 'finalization') {
        c.phase = 'complete';
      }

      // No step runs while a human gate is pending; a stale timestamp lets the
      // restart sweep treat the gate wait as a timed-out step.
      if (needsGate) c.step_started_at = null;

      stepResult = {
        phase: c.phase,
        subround: c.current_subround,
        step: c.current_step,
        needsGate,
      };

      return session;
    });

    if (!result) return null;
    return stepResult;
  }

  /**
   * Accumulate a round-attempt's LLM spend into circling.usage_total
   * (D14 cost record). Best-effort: never blocks the protocol.
   */
  async addCirclingUsage(sessionId, usage) {
    if (!usage) return;
    await this._updateWithCAS(sessionId, (session) => {
      if (!session.circling) return null;
      const t = session.circling.usage_total || { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 };
      t.input_tokens += usage.input_tokens || 0;
      t.output_tokens += usage.output_tokens || 0;
      t.cost_usd += usage.cost_usd || 0;
      t.calls += 1;
      session.circling.usage_total = t;
      return session;
    });
  }

  /**
   * Record an artifact parse failure for a node at the current step.
   * Returns the failure count.
   */
  async recordArtifactFailure(sessionId, nodeId) {
    let failureCount = 0;
    const result = await this._updateWithCAS(sessionId, (session) => {
      if (!session.circling) return null;
      const key = `${nodeId}_sr${session.circling.current_subround}_step${session.circling.current_step}`;
      session.circling.artifact_failures[key] = (session.circling.artifact_failures[key] || 0) + 1;
      failureCount = session.circling.artifact_failures[key];
      return session;
    });
    if (!result) return 0;
    return failureCount;
  }

  /**
   * Get the artifact failure count for a node at the current step.
   */
  getArtifactFailureCount(session, nodeId) {
    if (!session || !session.circling) return 0;
    const key = `${nodeId}_sr${session.circling.current_subround}_step${session.circling.current_step}`;
    return session.circling.artifact_failures[key] || 0;
  }

  // ── Intel Compilation ──────────────────────────────

  /**
   * Compile shared intelligence from the previous round's reflections.
   * This is the text sent to all nodes at the start of the next round.
   */
  compileSharedIntel(session) {
    if (session.rounds.length === 0) return '';

    const prevRound = session.rounds[session.rounds.length - 1];
    if (!prevRound || prevRound.reflections.length === 0) {
      return '(First round — no prior intelligence.)';
    }

    const lines = [`=== ROUND ${prevRound.round_number} SHARED INTELLIGENCE ===\n`];

    for (const r of prevRound.reflections) {
      lines.push(`## Node: ${r.node_id}${r.parse_failed ? ' [REFLECTION PARSE FAILED]' : ''}`);
      if (r.summary) lines.push(`Summary: ${r.summary}`);
      if (r.learnings) lines.push(`Learnings: ${r.learnings}`);
      if (r.artifacts.length > 0) lines.push(`Artifacts: ${r.artifacts.join(', ')}`);
      lines.push(`Confidence: ${r.confidence} | Vote: ${r.vote}`);
      lines.push('');
    }

    const convergedCount = prevRound.reflections.filter(r => r.vote === 'converged').length;
    const totalNodes = prevRound.reflections.length;
    lines.push(`=== CONVERGENCE: ${convergedCount}/${totalNodes} voted converged. ===`);

    return lines.join('\n');
  }

  // ── Session Lifecycle ──────────────────────────────

  /**
   * Mark session as converged.
   */
  async markConverged(sessionId) {
    return this._updateWithCAS(sessionId, (session) => {
      if (session.status !== COLLAB_STATUS.ACTIVE) return null;
      session.status = COLLAB_STATUS.CONVERGED;

      // Close current round
      const currentRound = session.rounds[session.rounds.length - 1];
      if (currentRound) currentRound.completed_at = new Date().toISOString();

      return session;
    });
  }

  /**
   * Mark session as completed with final result.
   */
  async markCompleted(sessionId, result) {
    return this._updateWithCAS(sessionId, (session) => {
      if (['completed', 'aborted'].includes(session.status)) return null;
      session.status = COLLAB_STATUS.COMPLETED;
      session.completed_at = new Date().toISOString();
      // Mode-specific fields (circling_final_artifact, circling_completion_diff,
      // cooperative_integrations, collaborative) ride along: the parent task's
      // result is copied from here.
      const { artifacts, summary, node_contributions, needs_review, review_digest, ...modeFields } = result;
      session.result = {
        ...modeFields,
        artifacts: artifacts || [],
        summary: summary || '',
        rounds_taken: session.current_round,
        node_contributions: node_contributions || {},
        ...(needs_review ? { needs_review: true, review_digest: review_digest || null } : {}),
      };
      return session;
    });
  }

  /**
   * Mark session as aborted. Returns null (no-op) if already completed or aborted.
   * Callers can use truthiness to detect whether the abort actually happened.
   */
  async markAborted(sessionId, reason) {
    return this._updateWithCAS(sessionId, (session) => {
      // Guard: don't corrupt completed/aborted sessions
      if (['completed', 'aborted'].includes(session.status)) return null;
      session.status = COLLAB_STATUS.ABORTED;
      session.completed_at = new Date().toISOString();
      session.result = { success: false, summary: reason, aborted: true };
      return session;
    });
  }

  /**
   * Clear the audit error rate-limit counter for a session.
   * Call when a session is finalized (completed/aborted) to prevent Map leak.
   */
  clearAuditErrorCount(sessionId) {
    _auditErrorCounts.delete(sessionId);
  }

  /**
   * Get a summary of the session for reporting.
   */
  getSummary(session) {
    return {
      session_id: session.session_id,
      task_id: session.task_id,
      mode: session.mode,
      status: session.status,
      nodes: session.nodes.map(n => ({ id: n.node_id, role: n.role, status: n.status })),
      current_round: session.current_round,
      max_rounds: session.max_rounds,
      total_reflections: session.rounds.reduce((sum, r) => sum + r.reflections.length, 0),
      artifacts: session.result?.artifacts || [],
      needs_review: !!session.result?.needs_review,
      duration_ms: session.completed_at
        ? new Date(session.completed_at) - new Date(session.created_at)
        : Date.now() - new Date(session.created_at),
    };
  }
}

module.exports = {
  createSession,
  issueMemberToken,
  CollabStore,
  COLLAB_STATUS,
  COLLAB_MODE,
  CONVERGENCE,
  COLLAB_KV_BUCKET,
  LIVE_INDEX_KEY,
  IMPLEMENTED_MODES,
  isModeImplemented,
  resolvePreferredMode,
  PREFERRED_MODE_MAP,
};
