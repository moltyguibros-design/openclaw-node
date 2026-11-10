import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * POST /api/system/restart
 *
 * Kills and restarts Mission Control. The process exits, and
 * launchd (macOS) or systemd (Linux) restarts it automatically.
 * In dev mode, clears the .next cache first for a clean rebuild.
 */
export async function POST() {
  try {
    const isDev = process.env.NODE_ENV !== "production";

    // Clear Next.js cache for a clean restart
    if (isDev) {
      try {
        fs.rmSync(path.join(process.cwd(), ".next", "cache"), { recursive: true, force: true });
      } catch { /* Intentional: cache clear before process exit */ }
    }

    // Send response BEFORE killing ourselves
    const response = NextResponse.json({
      message: "Restarting Mission Control...",
      mode: isDev ? "dev" : "production",
    });

    // Schedule the kill after the response is sent
    setTimeout(() => {
      process.exit(0); // Clean exit — launchd/systemd will restart
    }, 500);

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: (err as { message?: string }).message || "Restart failed" },
      { status: 500 }
    );
  }
}
