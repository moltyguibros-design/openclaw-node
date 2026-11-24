import type { NextConfig } from "next";
import { AGENT_NAME } from "./src/lib/config";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "nats"],
  // Client components get the server's agent name, inlined at build time.
  env: { NEXT_PUBLIC_AGENT_NAME: AGENT_NAME },
};

export default nextConfig;
