import fs from "fs";
import os from "os";
import path from "path";

/**
 * The agent's name: OPENCLAW_AGENT_NAME from the environment, else from openclaw.env
 * (MC's unit does not pass that file), else Daedalus. The server reads it here;
 * next.config.ts inlines the same value into the client bundle as NEXT_PUBLIC_AGENT_NAME
 * at build time; workspace-bin/auto-checkpoint applies the same rule to find the
 * dispatch signal file.
 */
export function resolveAgentName(
  env: Record<string, string | undefined> = process.env,
  envFile: string = path.join(os.homedir(), ".openclaw", "openclaw.env"),
): string {
  const fromEnv = (env.OPENCLAW_AGENT_NAME || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const hits = [...fs.readFileSync(envFile, "utf8").matchAll(/^\s*OPENCLAW_AGENT_NAME\s*=(.*)$/gm)];
    const fromFile = (hits.pop()?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    if (fromFile) return fromFile;
  } catch {
    // no openclaw.env on this node
  }
  return "Daedalus";
}
