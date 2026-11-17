import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import type { Task } from "../hooks";
import { executionFieldsFor, executionFieldsFromTask, type ExecutionSettings } from "../execution-fields";

const meshTask = {
  execution: "mesh",
  collaboration: null,
  preferredNodes: JSON.stringify(["lead-a"]),
  excludeNodes: JSON.stringify(["flaky-b"]),
  clusterId: null,
  metric: "npm test",
  budgetMinutes: 45,
  scope: JSON.stringify(["src/"]),
  needsApproval: 0,
} as unknown as Task;

function settingsFrom(item: Task): ExecutionSettings {
  const f = executionFieldsFromTask(item);
  return {
    collabMode: "parallel",
    convergenceType: "unanimous",
    convergenceThreshold: 66,
    maxRounds: 5,
    scopeStrategy: "shared",
    metric: f.metric || "",
    budgetMinutes: f.budget_minutes,
    scopeText: f.scope.join("\n"),
    selectedNodes: f.preferred_nodes,
    clusterId: f.cluster_id || "",
  };
}

describe("execution fields round-trip through the task dialog", () => {
  it("reads exclude_nodes from the task instead of clearing it", () => {
    expect(executionFieldsFromTask(meshTask).exclude_nodes).toEqual(["flaky-b"]);
  });

  it("an unedited mesh task reports back exactly the fields it was opened with", () => {
    const opened = executionFieldsFromTask(meshTask);
    expect(executionFieldsFor("mesh", settingsFrom(meshTask), opened.exclude_nodes)).toEqual(opened);
  });

  it("local mode carries no routing", () => {
    expect(executionFieldsFor("local", settingsFrom(meshTask), ["flaky-b"]).exclude_nodes).toEqual([]);
  });

  it("ExecutionConfig mounts per open, after the dialog has loaded the task's fields", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../components/board/unified-task-dialog.tsx"), "utf8");
    expect(src).toMatch(/\{execConfigKey > 0 && \(\s*<ExecutionConfig\s+key=\{execConfigKey\}/);
    const init = src.slice(src.indexOf("initializedForOpen.current = true;"), src.indexOf("const resolveBasenames"));
    expect(init.lastIndexOf("setExecConfigKey((k) => k + 1)")).toBeGreaterThan(init.lastIndexOf("setExecFields("));
  });
});
