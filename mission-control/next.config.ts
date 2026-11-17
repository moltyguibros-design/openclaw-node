import type { NextConfig } from "next";
import { resolveAgentName } from "./src/lib/agent-name";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "nats"],
  // Client components get the server's agent name, inlined at build time.
  env: { NEXT_PUBLIC_AGENT_NAME: resolveAgentName() },
};

export default nextConfig;
