/**
 * local-event-log.mjs — Per-node event log substrate using NATS JetStream
 *
 * Provides durable, local-first event logging with Zod validation.
 * The stream is R=1 (no replication) and file-backed for sovereignty.
 *
 * Usage:
 *   import { createLocalEventLog, buildMemoryEvent } from '../lib/local-event-log.mjs';
 *   const eventLog = await createLocalEventLog(natsConn, nodeId);
 *   const event = buildMemoryEvent('memory.session_started', sessionId, 'session', data, nodeId);
 *   await eventLog.publishLocal(event);
 */

import crypto from 'crypto';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
const { createTracer } = _require('./tracer');
const tracer = createTracer('local-event-log');

const STREAM_PREFIX = 'local-events';

export function canonicalNodeId(nodeId) {
  const normalized = String(nodeId ?? '')
    .trim()
    .replace(/\.local$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalized) throw new TypeError('nodeId must contain at least one alphanumeric character');
  return normalized;
}

export function localEventStreamName(nodeId) {
  return `${STREAM_PREFIX}-${canonicalNodeId(nodeId)}`;
}

// Each node's stream owns only its own subject space. A stream on `local.>`
// claimed every node's events, so JetStream refused any second per-node
// stream (a renamed node id, another node on a shared cluster) as overlapping.
export function localEventSubjectPrefix(nodeId) {
  return `local.${canonicalNodeId(nodeId)}`;
}

const JS_STREAM_NOT_FOUND = 10059;
const JS_SUBJECTS_OVERLAP = 10065;

// A stream from before the per-node layout still claims `local.>` and blocks
// this node's stream. Narrowing it is the operator's step, after its history
// is preserved, so this names the owner and the command instead of editing it.
export async function describeLocalSubjectOwners(jsm, nodeId) {
  const owners = [];
  for await (const si of jsm.streams.list(`${localEventSubjectPrefix(nodeId)}.>`)) {
    const { name, subjects = [] } = si.config;
    const legacyId = name.startsWith(`${STREAM_PREFIX}-`) ? name.slice(STREAM_PREFIX.length + 1) : null;
    const remedy = legacyId
      ? `after preserving its history, narrow it: nats stream edit ${name} --subjects 'local.${legacyId}.>'`
      : 'after preserving its history, narrow or remove it';
    owners.push(`stream ${name} owns ${subjects.join(',')}; ${remedy}`);
  }
  return owners.join('; ');
}

const NS_PER_HOUR = 3600 * 1e9;
export const EVENT_STREAM_MAX_AGE_NS = 30 * 24 * NS_PER_HOUR;
export const EVENT_STREAM_MAX_BYTES = 256 * 1024 * 1024;

// The JetStream file budget is shared by every stream and KV bucket on the
// server, and the event readers consume within seconds, so a memory event
// stream keeps 30 days or 256 MiB, whichever is reached first.
export function eventStreamRetention() {
  return { max_age: EVENT_STREAM_MAX_AGE_NS, max_bytes: EVENT_STREAM_MAX_BYTES, discard: _require('nats').DiscardPolicy.Old };
}

// A stream created before retention existed gets it in place, even when that
// expires history it holds: no reader replays past the limits, and a stream
// left unlimited keeps eating the shared budget. The log says what is trimmed.
export async function ensureEventStreamRetention(jsm, { config, state }, log) {
  if (config.max_age > 0 && config.max_bytes > 0) return;
  const limits = {
    ...eventStreamRetention(),
    ...(config.max_age > 0 && { max_age: config.max_age }),
    ...(config.max_bytes > 0 && { max_bytes: config.max_bytes }),
  };
  const cutoff = Date.now() - limits.max_age / 1e6;
  const trimmed = [];
  if (state.messages > 0 && Date.parse(state.first_ts) < cutoff) trimmed.push(`its messages from ${state.first_ts} to ${new Date(cutoff).toISOString()}`);
  if (state.bytes > limits.max_bytes) trimmed.push(`the oldest ${state.bytes - limits.max_bytes} of its ${state.bytes} bytes`);
  // A worker's nkey is denied $JS.API.STREAM.UPDATE.> (nats-auth-render), so
  // its daemon keeps the stream as is and names the lead's command.
  try {
    await jsm.streams.update(config.name, { ...config, ...limits });
  } catch (err) {
    if (err?.code !== _require('nats').ErrorCode.PermissionsViolation) throw err;
    log(`${config.name} has no retention limit and this connection may not update streams; from a lead: ` +
      `nats stream edit ${config.name} --max-age ${limits.max_age / NS_PER_HOUR}h --max-bytes ${limits.max_bytes} --discard old`);
    return;
  }
  log(`${config.name}: retention set (max_age ${limits.max_age / NS_PER_HOUR}h, max_bytes ${limits.max_bytes}, discard old)` +
    (trimmed.length > 0 ? `; trimmed ${trimmed.join(' and ')}` : ''));
}

/**
 * Create a local event log instance backed by NATS JetStream.
 *
 * Ensures the JetStream stream exists (creates it if missing),
 * then returns an object with a publishLocal method for validated event publishing.
 *
 * @param {object} nc - NATS connection (from nats.connect())
 * @param {string} nodeId - Node identifier (lib/node-id.js resolveNodeId())
 * @param {object} [opts] - Optional configuration
 * @param {{ privateKey: import('crypto').KeyObject }} [opts.identity] - Node identity for event signing
 * @param {function} [opts.log] - Receives the stream retention notices (default console.log)
 * @returns {Promise<{ publishLocal: function, streamName: string, subjectPrefix: string }>}
 */
export async function createLocalEventLog(nc, nodeId, opts = {}) {
  const { MemoryEventSchema } = await import('../packages/event-schemas/dist/index.js');
  const { StringCodec, StorageType } = _require('nats');
  const sc = StringCodec();
  const log = opts.log ?? console.log;

  const streamName = localEventStreamName(nodeId);
  const subjectPrefix = localEventSubjectPrefix(nodeId);

  // Ensure the JetStream stream exists (R=1, file storage). Only "stream not
  // found" means create: a timeout or permission error must surface, not
  // turn into an add that fails for a different reason.
  const jsm = await nc.jetstreamManager();
  let info = null;
  try {
    info = await jsm.streams.info(streamName);
  } catch (err) {
    if (err?.api_error?.err_code !== JS_STREAM_NOT_FOUND) throw err;
    try {
      await jsm.streams.add({
        name: streamName,
        subjects: [`${subjectPrefix}.>`],
        storage: StorageType.File,
        num_replicas: 1,
        ...eventStreamRetention(),
      });
    } catch (addErr) {
      if (addErr?.api_error?.err_code !== JS_SUBJECTS_OVERLAP) throw addErr;
      const owners = await describeLocalSubjectOwners(jsm, nodeId);
      throw new Error(`cannot create ${streamName} on ${subjectPrefix}.>: ${addErr.message}${owners ? ` (${owners})` : ''}`);
    }
  }
  if (info) await ensureEventStreamRetention(jsm, info, log);

  const js = nc.jetstream();

  /**
   * Publish a validated event to the local event log.
   *
   * Validates the event against MemoryEventSchema, computes the subject from
   * event fields, and publishes with idempotency_key as msgID for dedup.
   *
   * @param {object} event - Event object conforming to MemoryEventSchema
   * @returns {Promise<object>} JetStream publish ack
   */
  async function publishLocal(event) {
    const validated = MemoryEventSchema.parse(event);

    // Sign the event if identity is provided
    let toPublish = validated;
    if (opts.identity && opts.identity.privateKey) {
      const { signEvent } = await import('./node-identity.mjs');
      toPublish = signEvent(validated, opts.identity.privateKey);
    }

    const subject = `${subjectPrefix}.${toPublish.entity_type}.events.${toPublish.entity_id}.${toPublish.event_type}`;
    return await js.publish(subject, sc.encode(JSON.stringify(toPublish)), {
      msgID: toPublish.idempotency_key,
    });
  }

  return { publishLocal, streamName, subjectPrefix };
}

/**
 * Build a memory event with envelope fields auto-populated.
 *
 * Generates event_id (UUID), timestamp (ISO 8601), and idempotency_key.
 * The caller provides the event-specific fields.
 *
 * @param {string} eventType - Event type (e.g. 'memory.session_started')
 * @param {string} entityId - Entity ID (e.g. session UUID)
 * @param {string} entityType - Entity type enum value (e.g. 'session', 'memory')
 * @param {object} data - Event-specific data payload
 * @param {string} nodeId - Node identifier
 * @param {object} [opts] - Optional overrides
 * @param {string} [opts.causation_id] - Causation event ID
 * @param {string} [opts.correlation_id] - Correlation ID
 * @param {{ type: string, id: string }} [opts.actor] - Actor override
 * @param {string} [opts.idempotency_key] - Custom idempotency key
 * @returns {object} Complete event object ready for publishLocal
 */
export function buildMemoryEvent(eventType, entityId, entityType, data, nodeId, opts = {}) {
  const eventId = crypto.randomUUID();
  return {
    event_id: eventId,
    event_type: eventType,
    event_version: 1,
    entity_id: entityId,
    entity_type: entityType,
    timestamp: new Date().toISOString(),
    causation_id: opts.causation_id || null,
    correlation_id: opts.correlation_id || null,
    actor: opts.actor || { type: 'system', id: `daemon-${nodeId}` },
    node_id: nodeId,
    idempotency_key: opts.idempotency_key || eventId,
    data,
  };
}
