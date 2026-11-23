import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NodeCard } from "@/components/mesh/node-card";
import type { MeshNode } from "@/components/mesh/types";

const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");

function node(extra: Record<string, unknown> = {}): MeshNode {
  return {
    nodeId: "w1",
    isLocal: false,
    status: "online",
    health: {
      nodeId: "w1",
      platform: "linux",
      role: "worker",
      tailscaleIp: "100.64.0.2",
      diskPercent: 20,
      mem: { total: 1000, free: 500 },
      uptimeSeconds: 60,
      services: [],
      agent: { status: "idle", currentTask: null, llm: null, model: null },
      capabilities: [],
      ...extra,
    },
    activeTasks: [],
    lastSeen: new Date().toISOString(),
    staleSeconds: 1,
    tailscale: null,
    nats: null,
    cpuLoadPercent: null,
    isNatsHost: false,
    peerConnectivity: "unknown",
  } as unknown as MeshNode;
}

describe("node card stats (mesh-bin#17)", () => {
  it("shows no fabricated task/success/spend line, even for an older publisher's record that still sends stats", () => {
    for (const n of [node(), node({ stats: { tasksToday: 0, successRate: 1, tokenSpendTodayUsd: 0 } })]) {
      const html = renderToStaticMarkup(createElement(NodeCard, { node: n }));
      expect(html).toContain("WORKER");
      expect(html).not.toMatch(/% success|Today: \d+ tasks|\$0\.00/);
    }
  });

  it("neither the health type nor the local fallback carries stats", () => {
    expect(src("components/mesh/types.ts")).not.toMatch(/tasksToday|tokenSpendTodayUsd|successRate/);
    expect(src("app/api/mesh/nodes/route.ts")).not.toMatch(/tasksToday|tokenSpendTodayUsd|successRate/);
  });
});
