import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NetworkTopology } from "@/components/mesh/network-topology";
import type { MeshNode } from "@/components/mesh/types";

function node(nodeId: string, platform: string, selfIp: string, isLocal: boolean): MeshNode {
  const tailscale = { peers: [], selfIp, natType: "unknown" };
  return {
    nodeId,
    isLocal,
    status: "online",
    health: { nodeId, platform, role: "worker", tailscaleIp: selfIp, services: [], tailscale } as unknown as MeshNode["health"],
    activeTasks: [],
    lastSeen: null,
    staleSeconds: 5,
    tailscale,
    nats: null,
    cpuLoadPercent: null,
    isNatsHost: false,
    peerConnectivity: "unknown",
  };
}

it("shows the local node, not the first node with health, under 'This machine'", () => {
  const html = renderToStaticMarkup(
    createElement(NetworkTopology, {
      nodes: [node("remote", "linux", "100.64.0.9", false), node("local", "darwin", "100.64.0.1", true)],
      meshStatus: { natsConnected: true, natsUrl: "nats://100.64.0.1:4222", localNodeId: "local", nodesOnline: 2, nodesTotal: 2 },
    }),
  );
  expect(html).toContain("darwin");
  expect(html).not.toContain("linux");
  expect(html).toContain("100.64.0.1");
  expect(html).not.toContain("100.64.0.9");
});
