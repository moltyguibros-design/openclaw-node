import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// mission-control-lib#15 (operator choice A): superseded code nothing used.
// The model-tier map advertised provider switching that nothing read, under
// stale model names. Kept by that choice: the drizzle tables, the TTS
// registry, touchItem/archiveItem and the mesh hooks.
const src = path.join(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(src, f), "utf8");

describe("removed dead code stays removed", () => {
  it("the four unused components are gone", () => {
    for (const f of [
      "components/observability/system-map.tsx",
      "components/observability/live-feed.tsx",
      "components/observability/event-timeline.tsx",
      "components/memory/search-bar.tsx",
    ]) {
      expect(fs.existsSync(path.join(src, f)), f).toBe(false);
    }
  });

  it("config carries no model-tier map and no injections-log path", async () => {
    const config = await import("../config");
    for (const name of ["MODEL_MAP", "LLM_PROVIDER", "getModel", "getProviderModels", "AVAILABLE_PROVIDERS", "INJECTIONS_LOG"]) {
      expect(config, name).not.toHaveProperty(name);
    }
    expect(read("lib/config.ts")).not.toMatch(/LLM-Agnostic|MODEL_MAP/);
  });

  it("the unused hooks and tracer batch insert are gone, the kept ones remain", () => {
    const hooks = read("lib/hooks.ts");
    for (const name of ["deleteDependency", "useMemoryItems", "useMemoryItemStats", "useMemoryCategories", "updateCluster", "useTokenUsage"]) {
      expect(hooks, name).not.toMatch(new RegExp(`export (async )?function ${name}\\b`));
    }
    for (const name of ["useMeshTasks", "useNodeIdentity", "createMeshTask", "updateMeshTask"]) {
      expect(hooks, name).toMatch(new RegExp(`export (async )?function ${name}\\b`));
    }
    const extract = read("lib/memory/extract.ts");
    for (const name of ["touchItem", "archiveItem"]) expect(extract, name).toMatch(new RegExp(`export function ${name}\\b`));
    expect(read("lib/tracer.ts")).not.toMatch(/batchInsertEvents/);
  });
});
