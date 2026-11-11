/**
 * mesh-nodes-route.test.ts — GET /api/mesh/nodes against mocked NATS/DB and a
 * mocked child_process, so the route's subprocess use is observable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const cfg = { nodeId: "test-node" };
let tailscaleStatus: Record<string, unknown> = {};

const cp = vi.hoisted(() => ({
  execSync: vi.fn(() => {
    throw new Error("execSync must not be used by this route");
  }),
  exec: vi.fn(),
}));

vi.mock("child_process", () => ({ execSync: cp.execSync, exec: cp.exec }));

vi.mock("@/lib/nats", () => ({
  getHealthKv: async () => null,
  sc: { decode: (b: Uint8Array) => new TextDecoder().decode(b) },
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }) }),
  getRawDb: () => ({ prepare: () => ({ all: () => [] }) }),
}));

vi.mock("@/lib/tracer", () => ({
  withTrace: (_m: string, _n: string, h: unknown) => h,
}));

vi.mock("@/lib/config", () => ({
  get NODE_ID() {
    return cfg.nodeId;
  },
  NODE_PLATFORM: "Linux",
  NODE_ROLE: "lead",
}));

interface RouteNode {
  nodeId: string;
  status: string;
  health: { nodeId: string } | null;
}

interface RouteBody {
  nodes: RouteNode[];
  meshStatus: { localNodeId: string };
}

async function loadGet(): Promise<() => Promise<Response>> {
  const { GET } = await import("@/app/api/mesh/nodes/route");
  return GET as unknown as () => Promise<Response>;
}

let home: string;
const realHome = process.env.HOME;

beforeEach(() => {
  vi.resetModules();
  cp.execSync.mockClear();
  cp.exec.mockReset();
  cp.exec.mockImplementation(
    (cmd: string, _opts: unknown, cb: (err: Error | null, out: { stdout: string; stderr: string }) => void) => {
      const stdout = cmd === "tailscale status --json" ? JSON.stringify(tailscaleStatus) : "";
      setTimeout(() => cb(null, { stdout, stderr: "" }), 20);
    },
  );
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-nodes-"));
  process.env.HOME = home;
  cfg.nodeId = "test-node";
  tailscaleStatus = {};
});

afterEach(() => {
  process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("GET /api/mesh/nodes", () => {
  it("runs its subprocesses asynchronously instead of blocking the event loop", async () => {
    tailscaleStatus = { Self: { HostName: "test-node" }, Peer: { a: { HostName: "peer-a" } } };
    const get = await loadGet();
    let timerFired = false;
    setTimeout(() => {
      timerFired = true;
    }, 5);
    const res = await get();
    const firedBeforeResponse = timerFired;
    const body: RouteBody = await res.json();

    expect(res.status).toBe(200);
    expect(cp.execSync).toHaveBeenCalledTimes(0);
    expect(cp.exec.mock.calls.map((c) => c[0])).toContain("tailscale status --json");
    expect(firedBeforeResponse).toBe(true);
    expect(body.meshStatus.localNodeId).toBe("test-node");
    expect(body.nodes.map((n) => n.nodeId).sort()).toEqual(["peer-a", "test-node"]);
  });

  async function nodesFor(nodeId: string, status: Record<string, unknown>): Promise<Record<string, RouteNode>> {
    cfg.nodeId = nodeId;
    tailscaleStatus = status;
    const res = await (await loadGet())();
    const body: RouteBody = await res.json();
    return Object.fromEntries(body.nodes.map((n) => [n.nodeId, n]));
  }

  it("does not give an offline peer whose name extends the local id this node's health", async () => {
    const nodes = await nodesFor("moltymac", { Peer: { a: { HostName: "moltymacs-virtual-machine" } } });
    expect(nodes["moltymac"].status).toBe("online");
    expect(nodes["moltymacs-virtual-machine"].health).toBeNull();
    expect(nodes["moltymacs-virtual-machine"].status).toBe("offline");
  });

  it("does not give an offline peer whose name is a prefix of the local id this node's health", async () => {
    const nodes = await nodesFor("moltymacs-virtual-machine", { Peer: { a: { HostName: "moltymac" } } });
    expect(nodes["moltymacs-virtual-machine"].status).toBe("online");
    expect(nodes["moltymac"].health).toBeNull();
    expect(nodes["moltymac"].status).toBe("offline");
  });

  it("still treats the short hostname of an FQDN node id as local", async () => {
    const nodes = await nodesFor("calos.lan", { Self: { HostName: "calos" } });
    expect(nodes["calos"].health?.nodeId).toBe("calos.lan");
    expect(nodes["calos"].status).toBe("online");
  });
});
