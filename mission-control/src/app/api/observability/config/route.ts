import { NextRequest, NextResponse } from "next/server";
import { getNats, sc } from "@/lib/nats";
import { NODE_ID } from "@/lib/config";
import { resolveEnvKey } from "@/lib/nats-auth";
import { signOperatorRequest } from "@/lib/mesh-sign";

export const dynamic = "force-dynamic";

type TraceMode = "dev" | "smart";

// What the daemons start with (lib/tracer.js); after a switch, the mode last broadcast.
let traceMode: TraceMode = resolveEnvKey("OPENCLAW_TRACE_MODE") === "dev" ? "dev" : "smart";

/**
 * GET /api/observability/config
 *
 * Returns current observability configuration.
 */
export async function GET() {
  try {
    return NextResponse.json({ mode: traceMode, nodeId: NODE_ID });
  } catch (err) {
    console.error("[observability/config] GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/observability/config
 *
 * Accepts { mode: "dev" | "smart" } and publishes it on openclaw.trace.config as a
 * signed operator request: each daemon's tracer verifies it and switches. A daemon
 * that restarts goes back to OPENCLAW_TRACE_MODE.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const newMode = body?.mode;

    if (newMode !== "dev" && newMode !== "smart") {
      return NextResponse.json(
        { error: 'Invalid mode — must be "dev" or "smart"' },
        { status: 400 }
      );
    }

    const nc = await getNats();
    if (!nc) {
      return NextResponse.json({ error: "NATS unavailable — trace mode not changed", mode: traceMode }, { status: 503 });
    }
    let signed;
    try {
      signed = await signOperatorRequest({ mode: newMode as TraceMode });
    } catch (err) {
      return NextResponse.json(
        { error: `cannot sign the operator request — trace mode not changed: ${(err as Error).message}`, mode: traceMode },
        { status: 503 }
      );
    }
    nc.publish("openclaw.trace.config", sc.encode(JSON.stringify(signed)));
    traceMode = newMode;

    return NextResponse.json({ mode: traceMode, nodeId: NODE_ID });
  } catch (err) {
    console.error("[observability/config] PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
