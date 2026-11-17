import type { Task } from "./hooks";

export type ExecutionMode = "local" | "mesh" | "collab";

export interface ExecutionFields {
  execution: string | null;
  collaboration: Record<string, unknown> | null;
  preferred_nodes: string[];
  exclude_nodes: string[];
  cluster_id: string | null;
  metric: string | null;
  budget_minutes: number;
  scope: string[];
  needs_approval: boolean;
}

/** The editable state ExecutionConfig keeps for mesh and collab tasks. */
export interface ExecutionSettings {
  collabMode: string;
  convergenceType: string;
  convergenceThreshold: number;
  maxRounds: number;
  scopeStrategy: string;
  metric: string;
  budgetMinutes: number;
  scopeText: string;
  selectedNodes: Iterable<string>;
  clusterId: string;
}

export const LOCAL_EXECUTION_FIELDS: ExecutionFields = {
  execution: "local",
  collaboration: null,
  preferred_nodes: [],
  exclude_nodes: [],
  cluster_id: null,
  metric: null,
  budget_minutes: 30,
  scope: [],
  needs_approval: true,
};

function parsed<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  if (typeof raw !== "string") return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** A stored task's execution fields, as the dialog edits them. */
export function executionFieldsFromTask(item: Task): ExecutionFields {
  return {
    execution: item.execution || "local",
    collaboration: parsed<Record<string, unknown> | null>(item.collaboration, null),
    preferred_nodes: parsed<string[]>(item.preferredNodes, []),
    exclude_nodes: parsed<string[]>(item.excludeNodes, []),
    cluster_id: item.clusterId || null,
    metric: item.metric || null,
    budget_minutes: item.budgetMinutes || 30,
    scope: parsed<string[]>(item.scope, []),
    needs_approval: item.needsApproval !== 0,
  };
}

/**
 * The fields ExecutionConfig reports for a mode. exclude_nodes has no editor
 * there, so mesh and collab carry the task's own list through unchanged.
 */
export function executionFieldsFor(
  mode: ExecutionMode,
  s: ExecutionSettings,
  excludeNodes: string[],
): ExecutionFields {
  if (mode === "local") return { ...LOCAL_EXECUTION_FIELDS };
  const scope = s.scopeText.split("\n").map((l) => l.trim()).filter(Boolean);
  const nodeIds = Array.from(s.selectedNodes);
  const common = {
    execution: "mesh",
    preferred_nodes: nodeIds,
    exclude_nodes: excludeNodes,
    metric: s.metric || null,
    budget_minutes: s.budgetMinutes,
    scope,
    needs_approval: false,
  };
  if (mode === "mesh") return { ...common, collaboration: null, cluster_id: null };
  return {
    ...common,
    collaboration: {
      mode: s.collabMode,
      min_nodes: Math.min(nodeIds.length || 2, 2),
      max_nodes: nodeIds.length || 4,
      join_window_s: 30,
      max_rounds: s.maxRounds,
      convergence: {
        type: s.convergenceType,
        threshold: s.convergenceThreshold / 100,
        metric: null,
        min_quorum: Math.min(nodeIds.length || 2, 2),
      },
      scope_strategy: s.scopeStrategy,
    },
    cluster_id: s.clusterId || null,
  };
}
