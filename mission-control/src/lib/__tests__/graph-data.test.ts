import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { forceGraphData } from "../graph-data";

type Node = { id: string };
type Link = { source: string | Node; target: string | Node };

// What d3-force-3d's forceLink.initialize does to the links force-graph hands it
// (src/link.js: `if (typeof link.source !== "object") link.source = find(nodeById, link.source)`).
function simulate(g: { nodes: Node[]; links: Link[] }) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const l of g.links) {
    if (typeof l.source !== "object") l.source = byId.get(l.source)!;
    if (typeof l.target !== "object") l.target = byId.get(l.target)!;
  }
}

const component = (f: string) =>
  fs.readFileSync(path.join(__dirname, "../../components/obsidian", f), "utf8");

describe("graph data handed to the force simulation", () => {
  it("leaves the page's link endpoints as ids after the simulation resolves its own copies", () => {
    const g = { nodes: [{ id: "a" }, { id: "b" }], links: [{ source: "a", target: "b" }] };
    simulate(forceGraphData(g));
    expect(typeof g.links[0].target).toBe("string");
    expect(g.links.filter((l) => l.target === "b")).toHaveLength(1);
  });

  it("copies nodes only when asked, so a second simulation does not move the main graph's nodes", () => {
    const g = { nodes: [{ id: "a" }], links: [] };
    expect(forceGraphData(g).nodes[0]).toBe(g.nodes[0]);
    expect(forceGraphData(g, true).nodes[0]).not.toBe(g.nodes[0]);
    expect(forceGraphData(g, true).nodes[0]).toEqual(g.nodes[0]);
  });

  it("both Obsidian graphs pass copies, never the shared link objects", () => {
    const main = component("obsidian-graph.tsx");
    expect(main).toContain("forceGraphData(");
    expect(main).not.toContain("graphData={{ nodes: graph.nodes, links: graph.links }}");
    expect(component("local-graph.tsx")).toContain("forceGraphData(graph, true)");
  });

  it("the page offers 'Index Workspace' only when nothing is indexed, not when a filter matches nothing", () => {
    const page = fs.readFileSync(path.join(__dirname, "../../app/obsidian/page.tsx"), "utf8");
    expect(page).toContain("!graphLoading && graph && graph.nodes.length === 0 ?");
  });
});
