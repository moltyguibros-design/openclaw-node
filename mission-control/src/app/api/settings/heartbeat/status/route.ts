import { NextResponse } from "next/server";
import { OPENCLAW_ROOT, WORKSPACE_ROOT } from "@/lib/config";
import { loadHeartbeatDetect } from "@/lib/heartbeat-detect";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/heartbeat/status
 *
 * Returns the current heartbeat detection state from lib/heartbeat-detect.mjs,
 * which scans the most recently modified gateway session JSONL for the
 * heartbeat trigger.
 *
 * Response:
 * {
 *   isActive: boolean,           // true if a heartbeat session is currently running
 *   sessionId: string | null,    // gateway session ID of the active heartbeat
 *   detectedAt: string | null,   // ISO timestamp of the session's last modification
 *   ageSeconds: number | null,   // how old (in seconds) the session is
 *   sessionType: "heartbeat" | "main" | "unknown",
 *   daemon: {
 *     state: string,             // ACTIVE | IDLE | ENDED | BOOT | UNKNOWN
 *     sessionId: string | null,  // daemon-tracked session ID
 *     isActive: boolean,
 *     lastActivityTime: number | null,
 *   }
 * }
 */
export async function GET() {
  try {
    const { detectHeartbeat } = await loadHeartbeatDetect();
    const hb = detectHeartbeat({ workspace: WORKSPACE_ROOT, openclawRoot: OPENCLAW_ROOT });
    return NextResponse.json({
      isActive: hb.isActive,
      sessionId: hb.sessionId,
      detectedAt: hb.detectedAt,
      ageSeconds: hb.ageSeconds,
      sessionType: hb.sessionType,
      daemon: {
        state: hb.daemonState,
        sessionId: hb.daemonSessionId,
        isActive: hb.daemonActive,
        lastActivityTime: hb.daemonLastActivityTime,
      },
    });
  } catch (err) {
    console.error("[heartbeat/status] error:", err);
    return NextResponse.json(
      { error: "Failed to detect heartbeat status" },
      { status: 500 }
    );
  }
}
