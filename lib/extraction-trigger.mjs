/**
 * extraction-trigger.mjs — Agnostic extraction trigger via NATS
 *
 * Any LLM frontend can publish `mesh.memory.extract_request.<nodeId>` to fire
 * extraction on that node. The subject is per node because the bus is shared
 * across the cluster: one subject made every node's daemon flush on every
 * node's trigger. The memory daemon subscribes to its own subject and runs the
 * flush pipeline on receipt.
 * A time-based idle fallback self-publishes if no event arrives within the
 * configured threshold (default 45 min / 2700s).
 *
 * Env: EXTRACTION_IDLE_THRESHOLD_SEC (default 2700)
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Base NATS subject for extraction requests; the node id is the last token. */
export const EXTRACT_SUBJECT = 'mesh.memory.extract_request';

/**
 * The node's own extraction subject. A node id that is not one plain subject
 * token would publish elsewhere or, with a wildcard, subscribe to other nodes.
 */
export function extractSubject(nodeId) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(nodeId ?? ''))) {
    throw new Error(`invalid node id for extraction subject: ${JSON.stringify(nodeId)}`);
  }
  return `${EXTRACT_SUBJECT}.${nodeId}`;
}

/** Default idle threshold in seconds (45 minutes). */
export const DEFAULT_IDLE_THRESHOLD_SEC = 2700;

/**
 * Publish an extraction request to the node's extraction subject.
 *
 * @param {import('nats').NatsConnection} nc - NATS connection
 * @param {string} nodeId - publishing node's ID
 * @param {object} [opts]
 * @param {string} [opts.triggeredBy] - identifier for the trigger source
 * @returns {{ subject: string, payload: object }}
 */
export function publishExtractRequest(nc, nodeId, opts = {}) {
  const payload = {
    node_id: nodeId,
    triggered_by: opts.triggeredBy || 'manual',
    timestamp: new Date().toISOString(),
  };
  const subject = extractSubject(nodeId);
  nc.publish(subject, encoder.encode(JSON.stringify(payload)));
  return { subject, payload };
}

/**
 * Create an extraction trigger that subscribes to NATS extract requests
 * and manages an idle timer for self-triggering.
 *
 * @param {import('nats').NatsConnection} nc - NATS connection
 * @param {string} nodeId - this node's ID
 * @param {object} opts
 * @param {function} opts.onExtract - callback(payload) invoked on each extract request
 * @param {number} [opts.idleThresholdSec] - override idle threshold (env takes priority)
 * @param {(msg: string) => void} [opts.log] - logger for callback failures (default stderr)
 * @returns {{ start: function, stop: function, resetIdleTimer: function }}
 */
export function createExtractionTrigger(nc, nodeId, opts = {}) {
  const envThreshold = parseFloat(process.env.EXTRACTION_IDLE_THRESHOLD_SEC);
  const thresholdSec = (envThreshold > 0 ? envThreshold : null)
    || opts.idleThresholdSec
    || DEFAULT_IDLE_THRESHOLD_SEC;
  const thresholdMs = thresholdSec * 1000;
  const onExtract = opts.onExtract || (() => {});
  const log = opts.log || ((m) => process.stderr.write(`[extraction-trigger] ${m}\n`));

  let sub = null;
  let idleTimer = null;
  let running = false;

  function clearIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function startIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      if (running) {
        publishExtractRequest(nc, nodeId, { triggeredBy: 'idle-timer' });
      }
    }, thresholdMs);
  }

  function resetIdleTimer() {
    if (running) {
      startIdleTimer();
    }
  }

  async function start() {
    if (running) return;
    running = true;

    sub = nc.subscribe(extractSubject(nodeId));
    startIdleTimer();

    // Process messages in background
    (async () => {
      for await (const msg of sub) {
        try {
          const payload = JSON.parse(decoder.decode(msg.data));
          // R40 fix (repair 4.5): an idle-timer ping must NOT re-arm the
          // timer — the self-subscription made it a permanent 45-min publish
          // loop with zero session activity. The timer re-arms on real
          // activity (resetIdleTimer from the daemon) or on requests from
          // non-idle triggers (a frontend asking for extraction IS activity).
          if (payload.triggered_by !== 'idle-timer') {
            startIdleTimer();
          }
          // A callback failure is not a malformed message, and an unhandled rejection crashes the daemon.
          (async () => onExtract(payload))().catch((err) => log(`extract callback failed: ${err?.message || err}`));
        } catch {
          // Malformed message — skip callback; leave re-arming to real activity.
        }
      }
    })().catch(() => {}); // subscription ends on drain/close
  }

  function stop() {
    running = false;
    clearIdleTimer();
    if (sub) {
      sub.unsubscribe();
      sub = null;
    }
  }

  return { start, stop, resetIdleTimer };
}
