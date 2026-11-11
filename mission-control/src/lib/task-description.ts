// Department color map (matches import-pipeline-v2.js)
export const DEPT_COLORS: Record<string, string> = {
  DEV: "#3B82F6",
  CHAIN: "#8B5CF6",
  ART: "#EC4899",
  DESIGN: "#F59E0B",
  NARR: "#14B8A6",
  QA: "#10B981",
  INFRA: "#6B7280",
  MKT: "#EF4444",
  COMM: "#06B6D4",
  BIZ: "#22C55E",
  LEGAL: "#F97316",
  HIRE: "#A855F7",
};

// The task dialog writes "<meta · 5.0h>\n\n<rich>", and moves a bare "DEV" into the rich part when an estimate is added.
function segments(description: string): string[] {
  return description.split(/ · |\n\n/).map((p) => p.trim());
}

/** Estimated hours segment, e.g. "DEV · 5.0h · M1/D3" → "5.0h" */
export function extractEstimate(description: string | null): string | null {
  if (!description) return null;
  return segments(description).find((p) => /^\d+(\.\d+)?h$/.test(p)) ?? null;
}

/** Department, from "⚠️ CRITICAL PATH — DEV" / "IMPORTANT — DEV" or a segment that is a known dept */
export function extractDept(description: string | null): string | null {
  if (!description) return null;
  const tag = description.match(/(?:CRITICAL PATH|IMPORTANT)\s*[—–-]\s*(\w+)/);
  if (tag) return tag[1];
  return segments(description).find((p) => Object.hasOwn(DEPT_COLORS, p)) ?? null;
}
