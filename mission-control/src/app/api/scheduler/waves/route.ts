import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { planDispatch } from "@/lib/scheduler";

/**
 * GET /api/scheduler/waves
 * Returns the current wave structure without dispatching, plus the
 * dispatchable tasks blocked behind a predecessor that is not done.
 * Useful for visualization and debugging.
 */
export async function GET() {
  const { dispatchable, blocked, waves } = planDispatch(getDb());

  return NextResponse.json({
    waves,
    blocked,
    totalDispatchable: dispatchable.length,
  });
}
