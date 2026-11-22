import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { memoryDocs } from "@/lib/db/schema";
import { WORKSPACE_ROOT } from "@/lib/config";
import {
  extractAllReferences,
  buildResolutionMaps,
  toGraphId,
} from "@/lib/memory/wikilinks";

/**
 * GET /api/memory/wikilinks
 * Compute the document-level cross-reference graph from all indexed memory_docs.
 * Auto-detects: [[wikilinks]], task IDs (ARCANE-M01, T-xxx), file path mentions.
 * Node ids and link endpoints are workspace-relative, like the file tree's paths.
 */
export async function GET() {
  try {
    const db = getDb();

    const docs = db
      .select({
        id: memoryDocs.id,
        filePath: memoryDocs.filePath,
        title: memoryDocs.title,
        source: memoryDocs.source,
        category: memoryDocs.category,
        content: memoryDocs.content,
      })
      .from(memoryDocs)
      .all();

    const maps = buildResolutionMaps(docs);

    const linkCounts = new Map<string, number>();
    const links: Array<{ source: string; target: string }> = [];
    const seenEdges = new Set<string>();

    for (const doc of docs) {
      const refs = extractAllReferences(doc.content, maps, doc.filePath);
      const sourceId = toGraphId(doc.filePath, WORKSPACE_ROOT);
      for (const target of refs) {
        const edgeKey = `${doc.filePath}::${target}`;
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          const targetId = toGraphId(target, WORKSPACE_ROOT);
          links.push({ source: sourceId, target: targetId });
          linkCounts.set(sourceId, (linkCounts.get(sourceId) || 0) + 1);
          linkCounts.set(targetId, (linkCounts.get(targetId) || 0) + 1);
        }
      }
    }

    const nodes = docs.map((d) => {
      const id = toGraphId(d.filePath, WORKSPACE_ROOT);
      return {
        id,
        title:
          d.title ||
          d.filePath.split("/").pop()?.replace(/\.md$/, "") ||
          d.filePath,
        source: d.source,
        category: d.category,
        linkCount: linkCounts.get(id) || 0,
      };
    });

    return NextResponse.json({
      nodes,
      links,
      stats: { nodeCount: nodes.length, linkCount: links.length },
    });
  } catch (err) {
    console.error("GET /api/memory/wikilinks error:", err);
    return NextResponse.json(
      { error: "Failed to compute wikilink graph" },
      { status: 500 }
    );
  }
}
