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
let systemctlUnits = "";

const cp = vi.hoisted(() => ({
  execSync: vi.fn(() => {
    throw new Error("execSync must not be used by this route");
  }),
  exec: vi.fn(),
  rawAll: vi.fn((..._args: unknown[]) => [] as unknown[]),
}));

vi.mock("child_process", () => ({ execSync: cp.execSync, exec: cp.exec }));

const kvState = vi.hoisted(() => ({ kv: null as unknown }));

vi.mock("@/lib/nats", () => ({
  getHealthKv: async () => kvState.kv,
  sc: { decode: (b: Uint8Array) => new TextDecoder().decode(b) },
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ all: () => [] }) }) }) }),
  getRawDb: () => ({ prepare: () => ({ all: cp.rawAll }) }),
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
  AGENT_NAME: "Daedalus",
  get OPENCLAW_ROOT() {
    return path.join(process.env.HOME as string, ".openclaw");
  },
}));

interface RouteNode {
  nodeId: string;
  isLocal: boolean;
  status: string;
  health: {
    nodeId: string;
    services: Array<{ name: string; status: string }>;
    agent: { status: string; llm: string | null };
  } | null;
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
      const stdout =
        cmd === "tailscale status --json"
          ? JSON.stringify(tailscaleStatus)
          : cmd.startsWith("systemctl --user list-units")
            ? systemctlUnits
            : "";
      setTimeout(() => cb(null, { stdout, stderr: "" }), 20);
    },
  );
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-nodes-"));
  process.env.HOME = home;
  cfg.nodeId = "test-node";
  tailscaleStatus = {};
  systemctlUnits = "";
  kvState.kv = null;
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

  it("marks which node is local even when a remote node with health is listed first", async () => {
    const health = (nodeId: string) => ({
      nodeId,
      services: [],
      diskPercent: 10,
      reportedAt: new Date().toISOString(),
    });
    kvState.kv = {
      keys: async () =>
        (async function* () {
          yield "peer-a";
          yield "test-node";
        })(),
      get: async (key: string) => ({ value: new TextEncoder().encode(JSON.stringify(health(key))) }),
    };
    const res = await (await loadGet())();
    const body: RouteBody = await res.json();
    expect(body.nodes.map((n) => n.nodeId)).toEqual(["peer-a", "test-node"]);
    expect(body.nodes[0].health).not.toBeNull();
    expect(Object.fromEntries(body.nodes.map((n) => [n.nodeId, n.isLocal]))).toEqual({
      "peer-a": false,
      "test-node": true,
    });
  });

  it("bounds today's token stats in token_usage's own 'YYYY-MM-DD HH:MM:SS' format", async () => {
    cp.rawAll.mockClear();
    await (await loadGet())();
    const today = new Date().toISOString().slice(0, 10);
    expect(cp.rawAll).toHaveBeenCalledWith(`${today} 00:00:00`);
  });

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

  // Tailscale's Relay is the home DERP region, set for every peer; CurAddr is the direct
  // endpoint and Active means traffic in the last ~2 min.
  it("reads direct from CurAddr, relays only an active peer without one, and marks inactive peers idle", async () => {
    const nodes = await nodesFor("test-node", {
      Peer: {
        a: { HostName: "a", Online: true, Active: true, CurAddr: "1.2.3.4:41641", Relay: "nyc" },
        b: { HostName: "b", Online: true, Active: true, CurAddr: "", Relay: "nyc" },
        c: { HostName: "c", Online: true, Active: false, CurAddr: "", Relay: "tor" },
      },
    });
    const local = nodes["test-node"] as unknown as {
      tailscale: { peers: Array<{ hostname: string; direct: boolean; relay: string | null; idle: boolean }> };
      peerConnectivity: string;
    };
    const pick = (h: string) => {
      const p = local.tailscale.peers.find((x) => x.hostname === h)!;
      return { direct: p.direct, relay: p.relay, idle: p.idle };
    };
    expect(pick("a")).toEqual({ direct: true, relay: null, idle: false });
    expect(pick("b")).toEqual({ direct: false, relay: "nyc", idle: false });
    expect(pick("c")).toEqual({ direct: false, relay: null, idle: true });
    expect(local.peerConnectivity).toBe("some_relay");
  });

  // Idle peers have no live path, so they are neither direct nor relayed.
  it("summarises connectivity over active peers only", async () => {
    const connectivity = async (peer: Record<string, unknown>) => {
      vi.resetModules();
      const nodes = await nodesFor("test-node", {
        Peer: { ...peer, idle: { HostName: "idle", Online: true, Active: false, CurAddr: "", Relay: "tor" } },
      });
      return (nodes["test-node"] as unknown as { peerConnectivity: string }).peerConnectivity;
    };
    expect(await connectivity({})).toBe("idle");
    expect(await connectivity({ b: { HostName: "b", Online: true, Active: true, CurAddr: "", Relay: "nyc" } })).toBe("degraded");
    expect(await connectivity({ a: { HostName: "a", Online: true, Active: true, CurAddr: "1.2.3.4:41641", Relay: "nyc" } })).toBe(
      "all_direct",
    );
  });

  it("still treats the short hostname of an FQDN node id as local", async () => {
    const nodes = await nodesFor("calos.lan", { Self: { HostName: "calos" } });
    expect(nodes["calos"].health?.nodeId).toBe("calos.lan");
    expect(nodes["calos"].status).toBe("online");
  });

  it("names no LLM vendor the agent did not record, with or without a state file", async () => {
    const realProvider = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "anthropic";
    try {
      expect((await nodesFor("test-node", {}))["test-node"].health?.agent.llm).toBeNull();
      const stateFile = path.join(home, ".openclaw", ".tmp", "agent-state.json");
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      // A fresh module each time: the route keeps the local health for 30 s.
      fs.writeFileSync(stateFile, JSON.stringify({ status: "idle", taskId: null }));
      vi.resetModules();
      expect((await nodesFor("test-node", {}))["test-node"].health?.agent).toMatchObject({ status: "idle", llm: null });
      fs.writeFileSync(stateFile, JSON.stringify({ status: "idle", taskId: null, llm: "gemini" }));
      vi.resetModules();
      expect((await nodesFor("test-node", {}))["test-node"].health?.agent.llm).toBe("gemini");
    } finally {
      if (realProvider === undefined) delete process.env.LLM_PROVIDER;
      else process.env.LLM_PROVIDER = realProvider;
    }
  });

  it.skipIf(process.platform === "darwin")("reports systemd user units in the local fallback on Linux", async () => {
    systemctlUnits = [
      "openclaw-mesh-agent.service loaded active running Mesh agent",
      "openclaw-gateway.service loaded failed failed Gateway",
      "openclaw-observer.service loaded inactive dead Observer",
    ].join("\n");
    const nodes = await nodesFor("test-node", {});
    expect(nodes["test-node"].health?.services).toEqual([
      { name: "mesh-agent", status: "active" },
      { name: "gateway", status: "error" },
      { name: "observer", status: "stopped" },
    ]);
    expect(nodes["test-node"].status).toBe("degraded");
  });

  it("reads the local deployVersion from OPENCLAW_REPO_DIR, not a hardcoded ~/openclaw", async () => {
    const realRepoDir = process.env.OPENCLAW_REPO_DIR;
    process.env.OPENCLAW_REPO_DIR = "/opt/o'c";
    try {
      await (await loadGet())();
    } finally {
      if (realRepoDir === undefined) delete process.env.OPENCLAW_REPO_DIR;
      else process.env.OPENCLAW_REPO_DIR = realRepoDir;
    }
    const cmds = cp.exec.mock.calls.map((c) => c[0] as string);
    expect(cmds).toContain("git -C '/opt/o'\\''c' rev-parse --short HEAD 2>/dev/null");
    expect(cmds.some((c) => c.includes("~/openclaw"))).toBe(false);
  });
});
