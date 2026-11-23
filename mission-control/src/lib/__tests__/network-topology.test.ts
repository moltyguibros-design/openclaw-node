import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NetworkTopology } from "@/components/mesh/network-topology";
import { NodeCard } from "@/components/mesh/node-card";
import type { MeshNode, NodeHealth, PeerView } from "@/components/mesh/types";

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

const peers: PeerView[] = [
  { hostname: "peer-direct", online: true, direct: true, relay: null, idle: false },
  { hostname: "peer-relay", online: true, direct: false, relay: "nyc", idle: false },
  { hostname: "peer-idle", online: true, direct: false, relay: null, idle: true },
];

function peerRow(html: string, hostname: string): string {
  const start = html.indexOf(hostname);
  const next = html.indexOf("peer-", start + hostname.length);
  return html.slice(start, next === -1 ? undefined : next);
}

it("labels an inactive Tailscale peer idle in the topology, not relayed or merely connected", () => {
  const local = node("local", "darwin", "100.64.0.1", true);
  local.tailscale = { peers, selfIp: "100.64.0.1", natType: "unknown" };
  const html = renderToStaticMarkup(
    createElement(NetworkTopology, {
      nodes: [local],
      meshStatus: { natsConnected: true, natsUrl: "nats://100.64.0.1:4222", localNodeId: "local", nodesOnline: 1, nodesTotal: 1 },
    }),
  );
  expect(peerRow(html, "peer-direct")).toContain("Direct connection");
  expect(peerRow(html, "peer-relay")).toContain("Via relay (nyc)");
  expect(peerRow(html, "peer-idle")).toContain("Idle");
  expect(peerRow(html, "peer-idle")).not.toContain("Connected");
});

function cardNode(): MeshNode {
  const n = node("local", "darwin", "100.64.0.1", true);
  n.tailscale = { peers, selfIp: "100.64.0.1", natType: "unknown" };
  n.health = {
    ...(n.health as NodeHealth),
    diskPercent: 10,
    mem: { total: 1000, free: 500 },
    uptimeSeconds: 60,
    agent: { status: "idle", currentTask: null, llm: null, model: null },
    capabilities: [],
    stats: { tasksToday: 0, successRate: 0, tokenSpendTodayUsd: 0 },
    tailscale: n.tailscale,
  };
  return n;
}

it("labels an inactive Tailscale peer idle on the node card", () => {
  const html = renderToStaticMarkup(createElement(NodeCard, { node: cardNode(), isExpanded: true }));
  expect(peerRow(html, "peer-direct")).toContain(">direct");
  expect(peerRow(html, "peer-relay")).toContain("relay (nyc)");
  expect(peerRow(html, "peer-idle")).toContain(">idle");
  expect(peerRow(html, "peer-idle")).not.toContain("relay");
});

it("shows a node whose online peers are all idle as Idle, not Direct or without peer data", () => {
  const n = cardNode();
  n.peerConnectivity = "idle";
  const html = renderToStaticMarkup(createElement(NodeCard, { node: n, isExpanded: true }));
  const row = html.slice(html.indexOf(">Connection<"), html.indexOf(">Data age<"));
  expect(row).toContain("Idle");
  expect(row).not.toContain("Direct");
  expect(row).not.toContain("No peer data");
});
