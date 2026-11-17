import { NextRequest, NextResponse } from "next/server";
import { getNats, getCollabKv, sc } from "@/lib/nats";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { syncTasksToMarkdown } from "@/lib/sync/tasks";
import type { CollabSession } from "@/lib/hooks";
import { signOperatorRequest } from "@/lib/mesh-sign";
import { requestDaemon, cancelDone } from "@/lib/mesh-request";

export const dynamic = "force-dynamic";

/**
 * POST /api/cowork/intervene
 *
 * Operator interventions on collab sessions.
 * Actions: abort, force_converge, remove_node
 *
 * Each action asks the task daemon first and changes the collab KV, events and
 * Kanban only once it accepts. A refusal answers 502 with the daemon's reason,
 * an unreachable daemon 503, a signing failure 500; nothing changes.
 */
export async function POST(request: NextRequest) {
  const nc = await getNats();
  if (!nc) {
    return NextResponse.json({ error: "NATS unavailable" }, { status: 503 });
  }

  const kv = await getCollabKv();
  if (!kv) {
    return NextResponse.json(
      { error: "Collab KV unavailable" },
      { status: 503 }
    );
  }

  const { action, sessionId, nodeId } = await request.json();

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required" },
      { status: 400 }
    );
  }

  // Read current session
  let session: CollabSession;
  try {
    const entry = await kv.get(sessionId);
    if (!entry || !entry.value) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }
    session = JSON.parse(sc.decode(entry.value));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }

  const now = new Date().toISOString();
  const audit = (event: string, detail?: string) => {
    if (!session.audit_log) session.audit_log = [];
    session.audit_log.push({ ts: now, event, detail, source: "mission-control" });
  };

  try {
    switch (action) {
      case "abort": {
        // Cancel parent task via daemon RPC — a signed operator action; the
        // daemon refuses unsigned cancel (review H-1).
        const cancel = await requestDaemon(
          nc,
          "mesh.tasks.cancel",
          () => signOperatorRequest({ task_id: session.task_id }),
          cancelDone
        );
        if (!cancel.ok) {
          return NextResponse.json({ error: cancel.error }, { status: cancel.status });
        }

        // The daemon's cancel already aborted the session and appended to its
        // audit log; build on that copy rather than overwrite it.
        const fresh = await kv.get(sessionId);
        if (fresh?.value) session = JSON.parse(sc.decode(fresh.value));
        session.status = "aborted";
        session.completed_at = now;
        audit("manual_abort");

        await kv.put(sessionId, sc.encode(JSON.stringify(session)));

        // Notify subscribers
        nc.publish(
          "mesh.events.collab.aborted",
          sc.encode(
            JSON.stringify({
              session_id: sessionId,
              task_id: session.task_id,
            })
          )
        );

        // Update Kanban for immediate feedback
        try {
          const db = getDb();
          db.update(tasks)
            .set({ status: "cancelled", kanbanColumn: "done", updatedAt: now })
            .where(eq(tasks.id, session.task_id))
            .run();
          syncTasksToMarkdown(db);
        } catch { /* best-effort */ }

        return NextResponse.json({ ok: true, action: "aborted" });
      }

      case "force_converge": {
        // Complete parent task via daemon RPC first: without it the daemon's
        // task stays running forever, and a refused complete must leave the
        // session as it is.
        const complete = await requestDaemon(nc, "mesh.tasks.complete", () =>
          // Force-complete is an OPERATOR action (MC is not the task's
          // owner); the daemon accepts it only with a valid signature.
          signOperatorRequest({
            task_id: session.task_id,
            result: {
              success: true,
              summary: "Force-converged by operator via Mission Control",
              forced: true,
            },
          })
        );
        if (!complete.ok) {
          return NextResponse.json({ error: complete.error }, { status: complete.status });
        }

        // Inject synthetic reflections for nodes that haven't submitted
        const currentRound =
          session.rounds?.[session.rounds.length - 1];
        if (currentRound) {
          const submittedNodes = new Set(
            (currentRound.reflections || []).map((r) => r.node_id)
          );
          const activeNodes = (session.nodes || []).filter(
            (n) => n.status !== "dead"
          );

          for (const node of activeNodes) {
            if (!submittedNodes.has(node.node_id)) {
              if (!currentRound.reflections) currentRound.reflections = [];
              currentRound.reflections.push({
                node_id: node.node_id,
                summary: "Synthetic reflection (force-converged by operator)",
                learnings: "",
                artifacts: [],
                confidence: 0.5,
                vote: "converged",
                synthetic: true,
                submitted_at: now,
              });
            }
          }
          currentRound.completed_at = now;
        }

        session.status = "converged";
        audit("force_converge");

        await kv.put(sessionId, sc.encode(JSON.stringify(session)));

        nc.publish(
          "mesh.events.collab.converged",
          sc.encode(
            JSON.stringify({
              session_id: sessionId,
              task_id: session.task_id,
              forced: true,
            })
          )
        );

        // Update Kanban for immediate feedback
        try {
          const db = getDb();
          db.update(tasks)
            .set({ status: "done", kanbanColumn: "done", updatedAt: now })
            .where(eq(tasks.id, session.task_id))
            .run();
          syncTasksToMarkdown(db);
        } catch { /* best-effort */ }

        return NextResponse.json({ ok: true, action: "force_converged" });
      }

      case "remove_node": {
        if (!nodeId) {
          return NextResponse.json(
            { error: "nodeId required for remove_node" },
            { status: 400 }
          );
        }

        // Use daemon RPC so it updates both KV and in-memory state atomically
        // This avoids stale quorum in the daemon's evaluateRound(). There is
        // no direct-KV fallback: a KV-only removal is exactly that stale quorum.
        // Removing another node is an OPERATOR action: the daemon accepts a
        // leave only from the member's join token or a valid signature, and
        // the signer's envelope owns node_id.
        const leave = await requestDaemon(nc, "mesh.collab.leave", () =>
          signOperatorRequest({
            session_id: sessionId,
            target_node_id: nodeId,
          })
        );
        if (!leave.ok) {
          return NextResponse.json({ error: leave.error }, { status: leave.status });
        }

        // Stop the removed node's in-flight round: mesh-agent acts on this
        // only when it is signed and names that node as its target.
        nc.publish(
          `mesh.agent.${nodeId}.stall`,
          sc.encode(
            JSON.stringify(
              await signOperatorRequest({
                task_id: session.task_id,
                target_node_id: nodeId,
                reason: "Removed by operator",
              })
            )
          )
        );

        nc.publish(
          "mesh.events.collab.node_removed",
          sc.encode(
            JSON.stringify({
              session_id: sessionId,
              node_id: nodeId,
            })
          )
        );

        return NextResponse.json({ ok: true, action: "node_removed", nodeId });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
