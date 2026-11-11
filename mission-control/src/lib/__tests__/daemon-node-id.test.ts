import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { resolveDaemonNodeId } from "../config";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-node-id-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveDaemonNodeId", () => {
  it("derives the memory daemon's id from a macOS hostname when nothing is configured", () => {
    expect(resolveDaemonNodeId({}, "Guillaumes-MacBook-Pro.local", path.join(tmpDir, "missing.env")))
      .toBe("guillaumes-macbook-pro");
  });

  it("reads OPENCLAW_NODE_ID from openclaw.env, which MC's unit does not pass", () => {
    const envFile = path.join(tmpDir, "openclaw.env");
    fs.writeFileSync(envFile, "OPENCLAW_NATS=nats://127.0.0.1:4222\r\nOPENCLAW_NODE_ID=lead-a\r\n");
    expect(resolveDaemonNodeId({}, "Other.local", envFile)).toBe("lead-a");
    expect(resolveDaemonNodeId({ MESH_NODE_ID: "legacy" }, "Other.local", envFile)).toBe("lead-a");
  });

  it("lets an explicit OPENCLAW_NODE_ID win over the env file", () => {
    const envFile = path.join(tmpDir, "openclaw.env");
    fs.writeFileSync(envFile, "OPENCLAW_NODE_ID=lead-a\n");
    expect(resolveDaemonNodeId({ OPENCLAW_NODE_ID: "x" }, "Other.local", envFile)).toBe("x");
  });

  it("falls back to MESH_NODE_ID before the hostname, like lib/node-id.js", () => {
    expect(resolveDaemonNodeId({ MESH_NODE_ID: "legacy" }, "Other.local", path.join(tmpDir, "missing.env")))
      .toBe("legacy");
  });
});
