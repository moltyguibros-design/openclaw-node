// d3's forceLink replaces link endpoint ids with node objects in place, so force-graph
// must get its own link copies: the page compares the SWR links' endpoints as strings.
export function forceGraphData<N extends object, L extends { source: string; target: string }>(
  g: { nodes: N[]; links: L[] },
  copyNodes = false,
) {
  return {
    nodes: copyNodes ? g.nodes.map((n) => ({ ...n })) : g.nodes,
    links: g.links.map((l) => ({ source: l.source, target: l.target })),
  };
}
