/**
 * heartbeat-detect.ts — Mission Control's handle on lib/heartbeat-detect.mjs.
 *
 * The heartbeat status route used to carry its own TypeScript copy of the
 * detection, which had already drifted from the lib. Like mesh-sign.ts, it
 * now loads the one implementation at runtime by absolute path, outside the
 * bundle. First that exists wins:
 *   $OPENCLAW_LIB_DIR/heartbeat-detect.mjs
 *   <cwd>/../../lib/heartbeat-detect.mjs   (installed: workspace/projects/mission-control)
 *   <cwd>/../lib/heartbeat-detect.mjs      (repo checkout: mission-control/)
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export interface HeartbeatStatus {
  isActive: boolean;
  sessionId: string | null;
  detectedAt: string | null;
  ageSeconds: number | null;
  sessionType: "heartbeat" | "main" | "unknown";
  daemonActive: boolean;
  daemonSessionId: string | null;
  daemonState: string;
  daemonLastActivityTime: number | null;
}

interface HeartbeatDetectModule {
  detectHeartbeat: (options?: { workspace?: string; openclawRoot?: string; activeWindowMs?: number }) => HeartbeatStatus;
}

let modulePromise: Promise<HeartbeatDetectModule> | null = null;

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.OPENCLAW_LIB_DIR) out.push(path.join(process.env.OPENCLAW_LIB_DIR, "heartbeat-detect.mjs"));
  const cwd = process.cwd();
  out.push(path.resolve(cwd, "..", "..", "lib", "heartbeat-detect.mjs"));
  out.push(path.resolve(cwd, "..", "lib", "heartbeat-detect.mjs"));
  return out;
}

export async function loadHeartbeatDetect(): Promise<HeartbeatDetectModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      for (const p of candidates()) {
        if (fs.existsSync(p)) {
          const url = pathToFileURL(p).href;
          return (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as HeartbeatDetectModule;
        }
      }
      throw new Error(
        `heartbeat-detect.mjs not found (tried: ${candidates().join(", ")}). ` +
          "Set OPENCLAW_LIB_DIR to the directory holding lib/heartbeat-detect.mjs.",
      );
    })().catch((err) => {
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}
