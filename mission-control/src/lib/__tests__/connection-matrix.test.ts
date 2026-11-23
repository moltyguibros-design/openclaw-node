import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CellContent, getPeerInfo } from "@/components/mesh/connection-matrix";
import type { MeshNode, PeerView } from "@/components/mesh/types";

// Peers carry the shape bin/mesh-health-publisher.js publishes: no nodeId, and
// latency only as `latency: { latencyMs }` on every fifth cycle.
function node(nodeId: string, selfIp: string, peers: PeerView[]): MeshNode {
  const tailscale = { peers, selfIp, natType: "unknown" };
  return {
    nodeId,
    isLocal: false,
    status: "online",
    health: { tailscaleIp: selfIp, tailscale } as unknown as MeshNode["health"],
    activeTasks: [],
    lastSeen: null,
    staleSeconds: null,
    tailscale,
    nats: null,
    cpuLoadPercent: null,
    isNatsHost: false,
    peerConnectivity: "unknown",
  };
}

const cell = (info: ReturnType<typeof getPeerInfo>) => renderToStaticMarkup(createElement(CellContent, { info }));

describe("Connection Matrix peer lookup", () => {
  it("reads the published latency and direct flag for a peer matched by Tailscale IP", () => {
    const b = node("b-node", "100.64.0.2", []);
    const a = node("a-node", "100.64.0.1", [
      { hostname: "b", ip: "100.64.0.2", online: true, direct: true, relay: "nyc", latency: { latencyMs: 12 } },
    ]);
    const info = getPeerInfo(a, b);
    expect(info).toEqual({ latencyMs: 12, relay: false, idle: false, online: true });
    const html = cell(info);
    expect(html).toContain("12.0ms");
    expect(html).toContain("(direct)");
  });

  it("renders '?' for an online peer that has not been pinged yet", () => {
    const b = node("b-node", "100.64.0.2", []);
    const a = node("a-node", "100.64.0.1", [
      { hostname: "b", ip: "100.64.0.2", online: true, direct: false, relay: "nyc" },
    ]);
    const info = getPeerInfo(a, b);
    expect(info).toEqual({ latencyMs: null, relay: true, idle: false, online: true });
    expect(cell(info)).toContain("?");
  });

  it("labels an idle peer idle, neither relayed nor direct", () => {
    const b = node("b-node", "100.64.0.2", []);
    const a = node("a-node", "100.64.0.1", [
      { hostname: "b", ip: "100.64.0.2", online: true, direct: false, idle: true, relay: null, latency: { latencyMs: 12 } },
    ]);
    const info = getPeerInfo(a, b);
    expect(info).toEqual({ latencyMs: 12, relay: false, idle: true, online: true });
    const html = cell(info);
    expect(html).toContain("(idle)");
    expect(html).not.toContain("(relay)");
    expect(html).not.toContain("(direct)");
  });

  it("does not match a peer with no IP to a node with no Tailscale IP", () => {
    const b = node("b-node", "", []);
    const a = node("a-node", "100.64.0.1", [{ hostname: "x", ip: "", online: true }]);
    expect(getPeerInfo(a, b)).toBeNull();
  });
});
