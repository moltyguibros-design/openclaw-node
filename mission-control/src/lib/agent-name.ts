import fs from "fs";

/**
 * The agent's name: OPENCLAW_AGENT_NAME from the environment, else from openclaw.env
 * (MC's unit does not pass that file), else Daedalus. config.ts resolves AGENT_NAME
 * here with its openclawEnvFile(), the file NODE_ID and the NATS settings come from
 * too; next.config.ts inlines that value into the client bundle as
 * NEXT_PUBLIC_AGENT_NAME at build time; workspace-bin/auto-checkpoint applies the
 * same rule to find the dispatch signal file.
 */
export function resolveAgentName(
  env: Record<string, string | undefined> = process.env,
  envFile: string,
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
