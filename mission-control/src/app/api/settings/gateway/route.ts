import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const CONFIG_PATH = path.join(
  process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw"),
  "openclaw.json"
);

interface OpenclawConfig {
  agents?: {
    defaults?: {
      heartbeat?: Record<string, string>;
      model?: Record<string, unknown>;
      compaction?: unknown;
      maxConcurrent?: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  gateway?: {
    port?: number;
    mode?: string;
    bind?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

async function loadConfig(): Promise<OpenclawConfig> {
  const raw = await fs.readFile(CONFIG_PATH, "utf-8");
  return JSON.parse(raw);
}

// openclaw.json is the gateway's live config and carries its token: never leave it truncated, never widen its mode.
async function saveConfig(config: OpenclawConfig): Promise<void> {
  const target = await fs.realpath(CONFIG_PATH);
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  const fh = await fs.open(tmp, "wx", 0o600);
  try {
    await fh.writeFile(JSON.stringify(config, null, 2) + "\n");
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fs.rename(tmp, target);
}

/**
 * GET /api/settings/gateway
 * Returns the gateway + agent defaults config (heartbeat, fallbacks, etc.)
 */
export async function GET() {
  try {
    const config = await loadConfig();
    const defaults = config.agents?.defaults || {};
    const gateway = config.gateway || {};

    return NextResponse.json({
      heartbeat: defaults.heartbeat || { target: "none" },
      model: defaults.model || {},
      compaction: defaults.compaction || {},
      maxConcurrent: defaults.maxConcurrent ?? 4,
      gateway: {
        port: gateway.port ?? 18789,
        mode: gateway.mode ?? "local",
        bind: gateway.bind ?? "loopback",
      },
    });
  } catch (error) {
    console.error("Failed to load gateway settings:", error);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/gateway
 * Update gateway-related settings. Accepts partial updates.
 * Body: { heartbeat?: { target, every? }, maxConcurrent?: number }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const config = await loadConfig();

    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};

    // Heartbeat
    if (body.heartbeat !== undefined) {
      const hb: Record<string, string> = { target: body.heartbeat.target || "none" };
      if (body.heartbeat.every) {
        hb.every = body.heartbeat.every;
      }
      config.agents.defaults.heartbeat = hb;
    }

    // Max concurrent
    if (body.maxConcurrent !== undefined) {
      if (!Number.isInteger(body.maxConcurrent) || body.maxConcurrent < 1) {
        return NextResponse.json({ error: "maxConcurrent must be a positive integer" }, { status: 400 });
      }
      config.agents.defaults.maxConcurrent = body.maxConcurrent;
    }

    // Compaction mode
    if (body.compaction !== undefined) {
      if (body.compaction === null || typeof body.compaction !== "object" || Array.isArray(body.compaction)) {
        return NextResponse.json({ error: "compaction must be an object" }, { status: 400 });
      }
      config.agents.defaults.compaction = body.compaction;
    }

    await saveConfig(config);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to save gateway settings:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
