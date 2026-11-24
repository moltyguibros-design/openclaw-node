/**
 * A key listed twice in openclaw.env must resolve to the same copy everywhere. The daemons
 * (lib/nats-resolve.js readEnvFileKey), the installer and mesh-deploy take the first; MC's
 * node-id and agent-name readers took the last, so MC and the daemons disagreed on the id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { resolveDaemonNodeId, resolveNodeRole } from "../config";
import { resolveAgentName } from "../agent-name";
import { resolveEnvKey } from "../nats-auth";

const { readEnvFileKey } = createRequire(import.meta.url)("../../../../lib/nats-resolve.js");

describe("duplicated openclaw.env keys", () => {
  let dir: string;
  let envFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-env-dup-"));
    envFile = path.join(dir, "openclaw.env");
    fs.writeFileSync(envFile, [
      "OPENCLAW_NODE_ID=first-id", "OPENCLAW_AGENT_NAME=First", "OPENCLAW_NODE_ROLE=worker",
      "OPENCLAW_NODE_ID=second-id", "OPENCLAW_AGENT_NAME=Second", "OPENCLAW_NODE_ROLE=lead", "",
    ].join("\n"));
    vi.stubEnv("OPENCLAW_HOME", dir);
    for (const k of ["OPENCLAW_NODE_ID", "OPENCLAW_AGENT_NAME", "OPENCLAW_NODE_ROLE", "MESH_NODE_ID"]) vi.stubEnv(k, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("every MC reader takes the first copy, the one the daemons read", () => {
    expect(readEnvFileKey(envFile, "OPENCLAW_NODE_ID")).toBe("first-id");
    expect(resolveDaemonNodeId({}, "host.local", envFile)).toBe("first-id");
    expect(resolveAgentName({}, envFile)).toBe("First");
    expect(resolveNodeRole({}, envFile)).toBe("worker");
    expect(resolveEnvKey("OPENCLAW_NODE_ID")).toBe("first-id");
  });
});
