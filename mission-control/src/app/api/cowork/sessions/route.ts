import { NextRequest, NextResponse } from "next/server";
import { getCollabKv, sc } from "@/lib/nats";
import type { CollabSession } from "@/lib/hooks";

export const dynamic = "force-dynamic";

const KV_GET_BATCH = 64;

/**
 * GET /api/cowork/sessions
 *
 * Read collab sessions from NATS MESH_COLLAB KV.
 * Optional ?status= filter (e.g., "active", "recruiting", "completed").
 * Optional ?limit=N keeps only the N newest matches by created_at.
 * Returns { sessions[], natsAvailable }.
 */
export async function GET(request: NextRequest) {
  const kv = await getCollabKv();
  if (!kv) {
    return NextResponse.json({ sessions: [], natsAvailable: false });
  }

  // Supports single status (?status=active) or comma-separated (?status=active,recruiting)
  const statusParam = request.nextUrl.searchParams.get("status");
  const statusFilter = statusParam ? new Set(statusParam.split(",")) : null;
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : null;

  const sessions: CollabSession[] = [];
  try {
    const keys: string[] = [];
    const keyIter = await kv.keys();
    for await (const key of keyIter) keys.push(key);

    // MESH_COLLAB keeps every session ever created (federation tools read
    // finished ones as evidence), so the gets go out in parallel batches
    // instead of one round trip at a time.
    for (let i = 0; i < keys.length; i += KV_GET_BATCH) {
      const entries = await Promise.all(
        keys
          .slice(i, i + KV_GET_BATCH)
          // The daemon's live-session index (lib/mesh-collab.js LIVE_INDEX_KEY), not a session.
          .filter((key) => key !== "index.live")
          .map((key) => kv.get(key).catch(() => null))
      );
      for (const entry of entries) {
        try {
          if (!entry || !entry.value) continue;
          const session = JSON.parse(sc.decode(entry.value));
          if (statusFilter && !statusFilter.has(session.status)) continue;
          sessions.push(session);
        } catch {
          // Skip malformed entries
        }
      }
    }
  } catch (err) {
    console.error("[cowork/sessions] KV scan error:", (err as Error).message);
  }

  // Sort: active/recruiting first, then by created_at desc
  const statusOrder: Record<string, number> = {
    active: 0,
    recruiting: 1,
    converged: 2,
    completed: 3,
    aborted: 4,
  };

  const newest = (a: CollabSession, b: CollabSession) =>
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  const selected = limit ? sessions.sort(newest).slice(0, limit) : sessions;

  selected.sort((a, b) => {
    const aOrder = statusOrder[a.status] ?? 5;
    const bOrder = statusOrder[b.status] ?? 5;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return newest(a, b);
  });

  return NextResponse.json({ sessions: selected, natsAvailable: true });
}
