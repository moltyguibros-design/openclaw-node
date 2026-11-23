/**
 * shared-event-stream.mjs — Shared JetStream stream for cross-node federation
 *
 * Configures and ensures the OPENCLAW_SHARED stream exists on the connected
 * NATS cluster with R=3 replication. Today the broadcast trio uses it: the
 * offerer and acceptor consume its context.* subjects.
 *
 * The stream carries federation subjects: kanban events, shared lessons,
 * shared concepts, broadcast/offer/accepted context, and shared artifacts.
 *
 * Usage:
 *   import { ensureSharedStream, inspectSharedStream } from '../lib/shared-event-stream.mjs';
 *   const info = await ensureSharedStream(natsConn);
 *   const status = await inspectSharedStream(natsConn);
 */

import { createRequire } from 'node:module';
import { FEDERATION_MAX_DELIVER } from './federation-resilience.mjs';
import { ensureEventStreamRetention, eventStreamRetention } from './local-event-log.mjs';

const _require = createRequire(import.meta.url);
const { StorageType, AckPolicy, DeliverPolicy } = _require('nats');

/** The canonical name of the shared federation stream. */
export const SHARED_STREAM_NAME = 'OPENCLAW_SHARED';

/**
 * Subject filter for the shared stream.
 * Each entry is a NATS subject pattern covering one federation domain.
 * Matches REFERENCE_PLAN §1.4 specification verbatim.
 */
export const SHARED_SUBJECTS = [
  'kanban.events.>',
  'lessons.shared.>',
  'concepts.shared.>',
  'context.broadcast.>',
  'context.offer.>',
  'context.accepted.>',
  'artifacts.shared.>',
];

/**
 * Ensure the OPENCLAW_SHARED stream exists on the connected NATS cluster.
 *
 * Creates the stream if it doesn't exist, with the memory event streams'
 * retention; an existing stream created without retention gets it in place
 * (ensureEventStreamRetention). Nothing else about an existing stream changes.
 *
 * Requires the NATS cluster to have ≥3 nodes for R=3 to succeed.
 * If the cluster has fewer nodes, NATS will reject the create/update.
 *
 * @param {object} nc - NATS connection (from nats.connect())
 * @param {{ log?: function }} [opts] - log receives the retention notices (default console.log)
 * @returns {Promise<object>} JetStream stream info
 */
export async function ensureSharedStream(nc, { log = console.log } = {}) {
  const jsm = await nc.jetstreamManager();

  let info;
  try {
    info = await jsm.streams.info(SHARED_STREAM_NAME);
  } catch {
    // Stream doesn't exist — create it
    return jsm.streams.add({
      name: SHARED_STREAM_NAME,
      subjects: SHARED_SUBJECTS,
      storage: StorageType.File,
      num_replicas: 3,
      ...eventStreamRetention(),
    });
  }
  await ensureEventStreamRetention(jsm, info, log);
  return info;
}

/**
 * Deliveries per message before a shared consumer gives up on it (a nak'd
 * message is retried, not forever). The same budget settleFederationMessage
 * counts against, so its final-delivery ack and the server's cap agree.
 */
export const SHARED_CONSUMER_MAX_DELIVER = FEDERATION_MAX_DELIVER;

const JS_CONSUMER_NOT_FOUND = 10014;

/**
 * The durable consumer `config.durable_name` on `stream`, with explicit acks
 * and SHARED_CONSUMER_MAX_DELIVER deliveries: a nak'd message is retried, and
 * a reader stopped mid-batch gets its unacked messages again. Created if
 * missing. An older release created the memory readers without ack_policy, so
 * the server made them AckNone, where a nak never redelivers; ack_policy
 * cannot be updated (server err 10012), so such a durable is deleted and added
 * again from the stream sequence after its last delivery.
 *
 * @param {object} jsm - JetStream manager
 * @param {string} stream
 * @param {object} config - durable_name, deliver_policy, filter_subject…
 * @param {function} log
 * @returns {Promise<object>} consumer info
 */
export async function ensureExplicitAckConsumer(jsm, stream, config, log) {
  const wanted = { ...config, ack_policy: AckPolicy.Explicit, max_deliver: SHARED_CONSUMER_MAX_DELIVER };
  let info;
  try {
    info = await jsm.consumers.info(stream, config.durable_name);
  } catch (err) {
    if (err?.api_error?.err_code !== JS_CONSUMER_NOT_FOUND) throw err;
    return jsm.consumers.add(stream, wanted);
  }
  if (info.config.ack_policy !== AckPolicy.None) return info;
  const resumeAt = info.delivered.stream_seq + 1;
  await jsm.consumers.delete(stream, config.durable_name);
  const recreated = await jsm.consumers.add(stream, { ...wanted, deliver_policy: DeliverPolicy.StartSequence, opt_start_seq: resumeAt });
  log(`${stream}/${config.durable_name}: recreated with explicit acks from stream sequence ${resumeAt} (it was ack_policy none)`);
  return recreated;
}

/**
 * The durable pull consumer `<prefix>-<nodeId>` on OPENCLAW_SHARED, created if
 * missing: consumers.get() only looks one up, it never creates it.
 * Consumer names may not contain '.', '*', '>' or whitespace; node ids can ('host.local').
 *
 * @param {object} nc - NATS connection
 * @param {string} prefix - e.g. 'offerer'
 * @param {string} nodeId
 * @param {string} filterSubject - e.g. 'context.broadcast.>'
 * @returns {Promise<object>} a Consumer, ready for consume()
 */
export async function ensureSharedConsumer(nc, prefix, nodeId, filterSubject) {
  const name = `${prefix}-${String(nodeId).replace(/[.*>\s]/g, '_')}`;
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.consumers.info(SHARED_STREAM_NAME, name);
  } catch {
    await jsm.consumers.add(SHARED_STREAM_NAME, {
      durable_name: name,
      filter_subject: filterSubject,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      max_deliver: SHARED_CONSUMER_MAX_DELIVER,
    });
  }
  return nc.jetstream().consumers.get(SHARED_STREAM_NAME, name);
}

/**
 * Inspect the OPENCLAW_SHARED stream and return its current state.
 *
 * Returns stream configuration and state for operational verification.
 * Throws if the stream does not exist.
 *
 * @param {object} nc - NATS connection (from nats.connect())
 * @returns {Promise<{ config: object, state: object }>} Stream info with config and state
 */
export async function inspectSharedStream(nc) {
  const jsm = await nc.jetstreamManager();
  const info = await jsm.streams.info(SHARED_STREAM_NAME);
  return {
    config: info.config,
    state: info.state,
  };
}

/** Expected num_replicas for the shared stream. */
export const EXPECTED_REPLICAS = 3;

/**
 * Verify that the shared stream config matches the expected R=3 + File storage.
 *
 * @param {{ config: object, state?: object }} streamInfo - from inspectSharedStream or ensureSharedStream
 * @returns {{ valid: boolean, reasons: string[] }}
 */
export function verifySharedStreamConfig(streamInfo) {
  const reasons = [];
  const config = streamInfo.config || streamInfo;

  if (config.num_replicas !== EXPECTED_REPLICAS) {
    reasons.push(
      `num_replicas is ${config.num_replicas}, expected ${EXPECTED_REPLICAS}`
    );
  }

  if (config.storage !== StorageType.File) {
    reasons.push(
      `storage is ${config.storage}, expected ${StorageType.File} (File)`
    );
  }

  return { valid: reasons.length === 0, reasons };
}
