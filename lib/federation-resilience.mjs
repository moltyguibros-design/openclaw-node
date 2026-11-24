/**
 * federation-resilience.mjs — Peer lifecycle tracking, TTL cleanup, and NATS reconnect utilities.
 *
 * Provides:
 * - createPeerTracker(opts) — track peer liveness via last-seen timestamps
 * - cleanupExpiredOffers(pendingOffers) — mutating filter of TTL-expired pending offers
 * - NATS_RECONNECT_OPTS — standard reconnect options for nats.js v2
 *
 * Step 10.7 of the OpenClaw Memory Plan.
 */

/** Default dead-peer timeout: 10 minutes. Override via DEAD_PEER_TIMEOUT_MIN env. */
export const DEAD_PEER_TIMEOUT_MS = (() => {
  const envMin = parseInt(process.env.DEAD_PEER_TIMEOUT_MIN, 10);
  return Number.isFinite(envMin) && envMin > 0 ? envMin * 60_000 : 600_000;
})();

/** Periodic cleanup interval for expired offers: 60 seconds. */
export const OFFER_CLEANUP_INTERVAL_MS = 60_000;

/**
 * Standard NATS reconnect options for long-running daemons.
 * maxReconnectAttempts: -1 = infinite retries.
 */
export const NATS_RECONNECT_OPTS = Object.freeze({
  maxReconnectAttempts: -1,
  reconnectTimeWait: 2000,
  reconnectJitter: 1000,
  reconnect: true,
});

/** Deliveries of one federation message before a failing one is dropped. */
export const FEDERATION_MAX_DELIVER = 5;

/** Redelivery delay after a failed attempt, multiplied by the attempt number. */
export const FEDERATION_NAK_DELAY_MS = 5_000;

/**
 * Ack a processed federation message, or retry a failed one. verifyEvent put
 * the event in the replay cache before processing, so a retry first forgets it
 * there (or the redelivery is dropped as a replay), then naks with a delay that
 * grows per attempt. At FEDERATION_MAX_DELIVER deliveries the message is acked
 * and dropped, so a deterministic failure cannot loop.
 *
 * @param {object} msg — JetStream message
 * @param {{ failed: boolean, eventId?: string, seenIds?: { delete(id): void } }} opts
 * @returns {'ack'|'nak'|'dropped'}
 */
export function settleFederationMessage(msg, { failed, eventId, seenIds } = {}) {
  if (!failed) {
    msg.ack?.();
    return 'ack';
  }
  let delivered = 1;
  try {
    delivered = msg.info?.deliveryCount ?? msg.info?.redeliveryCount ?? 1;
  } catch { /* not a JetStream reply subject */ }
  if (delivered >= FEDERATION_MAX_DELIVER) {
    msg.ack?.();
    return 'dropped';
  }
  if (eventId) seenIds?.delete(eventId);
  msg.nak?.(FEDERATION_NAK_DELAY_MS * delivered);
  return 'nak';
}

/**
 * Create a peer liveness tracker.
 *
 * Records last-seen timestamps per peer ID. A peer is "alive" if it was seen
 * within the configured timeout window. Dead peers are those that have been
 * silent longer than the timeout.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] — dead-peer timeout (default: DEAD_PEER_TIMEOUT_MS)
 * @param {boolean} [opts.autoCleanup] — run periodic cleanup (default: false)
 * @param {number} [opts.cleanupIntervalMs] — cleanup interval (default: 5 min)
 * @returns {{ recordSeen: Function, isAlive: Function, cleanup: Function, stop: Function }}
 */
export function createPeerTracker(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEAD_PEER_TIMEOUT_MS;
  const cleanupIntervalMs = opts.cleanupIntervalMs ?? 300_000; // 5 min

  /** @type {Map<string, number>} peerId → lastSeenMs */
  const peers = new Map();
  let cleanupTimer = null;

  if (opts.autoCleanup) {
    cleanupTimer = setInterval(() => cleanup(), cleanupIntervalMs);
    cleanupTimer.unref();
  }

  /**
   * Record that a peer was seen (alive) at the current time.
   * @param {string} peerId
   */
  function recordSeen(peerId) {
    if (!peerId) return;
    peers.set(peerId, Date.now());
  }

  /**
   * Check if a peer is alive (seen within timeout window).
   * A peer that has never been recorded returns true (unknown ≠ dead).
   * @param {string} peerId
   * @returns {boolean}
   */
  function isAlive(peerId) {
    if (!peers.has(peerId)) return true; // never tracked → not dead
    return (Date.now() - peers.get(peerId)) < timeoutMs;
  }

  /**
   * Remove entries older than 2x timeout (truly stale, no longer useful to track).
   * @returns {number} count of removed entries
   */
  function cleanup() {
    const now = Date.now();
    const staleThreshold = timeoutMs * 2;
    let removed = 0;
    for (const [peerId, lastSeen] of peers) {
      if (now - lastSeen > staleThreshold) {
        peers.delete(peerId);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Stop the tracker — clear any auto-cleanup timer.
   */
  function stop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  return { recordSeen, isAlive, cleanup, stop };
}

/**
 * Remove expired offers from the acceptor's pending offers (mutating, in-place).
 *
 * Checks each offer's `data.expires_at` field. Offers whose expiry time
 * has passed are deleted by key, which is safe vs the acceptor's concurrent
 * Map mutations (F-H4).
 *
 * @param {Map<string, object>} pendingOffers — event_id → offer
 * @returns {number} count of removed offers
 */
export function cleanupExpiredOffers(pendingOffers) {
  if (!(pendingOffers instanceof Map)) return 0;
  const now = Date.now();
  const toDelete = [];
  for (const [key, offer] of pendingOffers) {
    const expiresAt = offer?.data?.expires_at;
    if (expiresAt && now > new Date(expiresAt).getTime()) toDelete.push(key);
  }
  for (const key of toDelete) pendingOffers.delete(key);
  return toDelete.length;
}
