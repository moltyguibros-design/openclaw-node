/**
 * mesh-request.ts — operator RPCs to the task daemon whose answer decides
 * whether Mission Control changes anything.
 *
 * The daemon answers every refusal (bad signature, authorize() failure,
 * unknown task) with {ok:false, error}. Interventions used to ignore that
 * reply and mark the session or Kanban row cancelled/done anyway, so the
 * operator was told it worked while the task kept running. Operator decision:
 * a refusal, a signing failure and an unreachable daemon all stop the action.
 */

import type { NatsConnection } from "nats";
import { sc } from "@/lib/nats";

export interface DaemonReply {
  ok?: boolean;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export type DaemonOutcome =
  | { ok: true; reply: DaemonReply }
  | { ok: false; status: number; error: string; code?: string };

/**
 * @param build — the request body; a throw (e.g. signing unavailable) is a failure
 * @param accept — a non-ok reply that still counts as done (e.g. already terminal)
 */
export async function requestDaemon(
  nc: NatsConnection | null,
  subject: string,
  build: () => Promise<object> | object,
  accept: (reply: DaemonReply) => boolean = () => false,
): Promise<DaemonOutcome> {
  if (!nc) return { ok: false, status: 503, error: `NATS unavailable; ${subject} not sent` };
  let body: object;
  try {
    body = await build();
  } catch (err) {
    return { ok: false, status: 500, error: `${subject} not sent: ${(err as Error).message}` };
  }
  let reply: DaemonReply;
  try {
    const msg = await nc.request(subject, sc.encode(JSON.stringify(body)), { timeout: 5000 });
    reply = JSON.parse(sc.decode(msg.data));
  } catch (err) {
    return { ok: false, status: 503, error: `task daemon unreachable for ${subject}: ${(err as Error).message}` };
  }
  if (reply.ok === true || accept(reply)) return { ok: true, reply };
  return { ok: false, status: 502, error: `task daemon refused ${subject}: ${reply.error ?? "no reason given"}`, code: reply.code };
}

/** Cancel succeeded if the daemon cancelled it or it had already ended. */
export const cancelDone = (reply: DaemonReply) => reply.code === "TASK_TERMINAL";
