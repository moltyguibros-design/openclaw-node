import type { NatsConnection, Subscription } from "nats";
import { getRawDb } from "./db";
import { getNats, sc } from "./nats";

// Same-host daemons write observability_events directly (lib/obs-db.js); a
// remote node's daemons write their own host's database, so their traces reach
// this one only over NATS. Ids are the daemons' own, so an event that arrives
// both ways is stored once.

const CONFIG_SUBJECT = "openclaw.trace.config";
const FLUSH_MS = 250;
const MAX_BATCH = 500;
const RETRY_MS = 30_000;

type Row = {
  id: string;
  timestamp: number;
  node_id: string;
  module: string;
  function: string;
  tier: number;
  category: string;
  args_summary: string | null;
  result_summary: string | null;
  duration_ms: number | null;
  error: string | null;
  meta: string | null;
};

interface IngestGlobals {
  __trace_ingest_nc?: NatsConnection | null;
  __trace_ingest_sub?: Subscription | null;
  __trace_ingest_timer?: ReturnType<typeof setInterval> | null;
}
const g = globalThis as unknown as IngestGlobals;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;

/**
 * One wire event as a row, or null. Daemons (lib/tracer.js) publish snake_case;
 * Mission Control's own tracer publishes its camelCase insert shape. The event's
 * node must be the one its subject (openclaw.trace.<node>.<module>) names.
 */
export function traceRowFromWire(subject: string, data: Uint8Array): Row | null {
  if (subject === CONFIG_SUBJECT) return null;
  const subjectNode = subject.split(".")[2];
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(sc.decode(data));
  } catch {
    return null;
  }
  if (!e || typeof e !== "object") return null;
  const id = str(e.id, 128);
  const nodeId = str(e.node_id ?? e.nodeId, 128);
  const module = str(e.module, 128);
  const fn = str(e.function ?? e.fn, 256);
  const category = str(e.category, 64);
  const timestamp = e.timestamp;
  if (!id || !nodeId || !module || !fn || !category) return null;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  if (nodeId !== subjectNode) return null;
  const tier = Number.isInteger(e.tier) ? (e.tier as number) : 2;
  const duration = e.duration_ms ?? e.durationMs;
  const meta = e.meta;
  return {
    id,
    timestamp: Math.trunc(timestamp),
    node_id: nodeId,
    module,
    function: fn,
    tier,
    category,
    args_summary: str(e.args_summary ?? e.argsSummary, 120),
    result_summary: str(e.result_summary ?? e.resultSummary, 80),
    duration_ms: typeof duration === "number" && Number.isFinite(duration) ? Math.trunc(duration) : null,
    error: str(e.error, 1000),
    meta: meta == null ? null : (typeof meta === "string" ? meta : JSON.stringify(meta)).slice(0, 2000),
  };
}

let pending: Row[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function flushTraceRows(): number {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0) return 0;
  try {
    const db = getRawDb();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO observability_events
        (id, timestamp, node_id, module, function, tier, category, args_summary, result_summary, duration_ms, error, meta)
      VALUES
        (@id, @timestamp, @node_id, @module, @function, @tier, @category, @args_summary, @result_summary, @duration_ms, @error, @meta)
    `);
    let stored = 0;
    db.transaction((rows: Row[]) => {
      for (const row of rows) stored += insert.run(row).changes;
    })(batch);
    return stored;
  } catch (err) {
    console.error(`[trace-ingest] dropped ${batch.length} event(s): ${(err as Error).message}`);
    return 0;
  }
}

function enqueue(row: Row) {
  pending.push(row);
  if (pending.length >= MAX_BATCH) flushTraceRows();
  else if (!flushTimer) flushTimer = setTimeout(flushTraceRows, FLUSH_MS);
}

/** Subscribe once per NATS connection; true while subscribed. */
export async function ensureTraceIngest(): Promise<boolean> {
  const nc = await getNats();
  if (!nc) return false;
  if (g.__trace_ingest_nc === nc && g.__trace_ingest_sub && !g.__trace_ingest_sub.isClosed()) return true;
  g.__trace_ingest_sub?.unsubscribe();
  g.__trace_ingest_nc = nc;
  g.__trace_ingest_sub = nc.subscribe("openclaw.trace.>", {
    callback: (err, msg) => {
      if (err) return;
      const row = traceRowFromWire(msg.subject, msg.data);
      if (row) enqueue(row);
    },
  });
  return true;
}

/** Started once per server process (src/instrumentation.ts); retries while NATS is down. */
export function startTraceIngest() {
  if (g.__trace_ingest_timer) return;
  const attempt = () => ensureTraceIngest().catch(() => false);
  void attempt();
  g.__trace_ingest_timer = setInterval(attempt, RETRY_MS);
  g.__trace_ingest_timer.unref?.();
}
