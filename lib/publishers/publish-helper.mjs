/**
 * publish-helper.mjs — Shared NATS publish utility for all OpenClaw publishers.
 *
 * Provides fire-and-forget extraction event publishing that all SDK wrappers
 * and hook scripts share. Two modes:
 *   1. `publishExtractDirect(nc, nodeId, triggeredBy)` — for callers that
 *      already hold a NATS connection.
 *   2. `createNatsPublisher(opts)` — lazy-connect factory for wrappers that
 *      need to manage their own connection lifecycle.
 */

import { resolveNodeId } from '../node-id.js';
import { createRequire } from 'node:module';
import { EXTRACT_SUBJECT, publishExtractRequest } from '../extraction-trigger.mjs';

const _require = createRequire(import.meta.url);

/** Default NATS server URL. */
export const DEFAULT_NATS_URL = 'nats://localhost:4222';

export { EXTRACT_SUBJECT };

/**
 * Publish an extraction request on an existing NATS connection.
 * Throws if nc.publish throws (closed connection); createNatsPublisher.publish and runExtractNow catch it.
 *
 * @param {import('nats').NatsConnection} nc
 * @param {string} nodeId
 * @param {string} [triggeredBy='manual']
 */
export function publishExtractDirect(nc, nodeId, triggeredBy = 'manual') {
  publishExtractRequest(nc, nodeId, { triggeredBy });
}

/**
 * Create a lazy-connecting NATS publisher for extraction events.
 *
 * @param {object} [opts]
 * @param {string} [opts.natsUrl] - NATS server URL (env NATS_URL takes priority)
 * @param {string} [opts.nodeId] - Node identifier (env OPENCLAW_NODE_ID takes priority)
 * @param {import('nats').NatsConnection} [opts.nc] - Pre-existing connection (skips connect)
 * @returns {{ publish: (triggeredBy?: string) => Promise<void>, close: () => Promise<void> }}
 */
export function createNatsPublisher(opts = {}) {
  // NATS_URL / opts.natsUrl only override the URL; credentials (token or this
  // node's nkey) always come from lib/nats-resolve.
  const natsUrl = process.env.NATS_URL || opts.natsUrl || undefined;
  const nodeId = process.env.OPENCLAW_NODE_ID || opts.nodeId || resolveNodeId();
  let nc = opts.nc || null;
  let connecting = null;

  async function ensureConnection() {
    // A managed connection that closed (reconnect attempts exhausted) is replaced;
    // an injected one is the caller's to manage.
    if (nc && (opts.nc || !nc.isClosed())) return nc;
    if (connecting) return connecting;
    const { connect } = await import('nats');
    const { natsConnectOpts } = _require('../nats-resolve.js');
    connecting = connect(natsConnectOpts({ servers: natsUrl })).then(c => {
      nc = c;
      connecting = null;
      return c;
    }, err => {
      connecting = null;
      throw err;
    });
    return connecting;
  }

  /**
   * Publish an extraction request. Fire-and-forget.
   * @param {string} [triggeredBy='manual']
   */
  async function publish(triggeredBy = 'manual') {
    try {
      const conn = await ensureConnection();
      publishExtractDirect(conn, nodeId, triggeredBy);
    } catch {
      // Fire-and-forget — NATS unreachable is not an error for the caller
    }
  }

  /** Close the managed NATS connection if one was created. */
  async function close() {
    if (nc && !opts.nc) {
      try {
        await nc.drain();
      } catch {
        // best-effort
      }
      nc = null;
    }
    connecting = null;
  }

  return { publish, close };
}
