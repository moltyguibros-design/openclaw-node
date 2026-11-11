import { describe, it, expect } from "vitest";
import { extractEntitiesFromFact } from "../memory/entities";
import { HUMAN_NAME } from "../config";

const names = (fact: string) => extractEntitiesFromFact(fact).map((e) => e.name);

describe("extractEntitiesFromFact known-entity matching", () => {
  it("does not match a short alias inside a longer word", () => {
    expect(names("Added an MCP knowledge server")).not.toContain("Mission Control");
  });

  it("does not match the human name inside a longer word", () => {
    expect(names(`Read the ${HUMAN_NAME}de first`)).not.toContain(HUMAN_NAME);
  });

  it("matches names and aliases that stand as whole words", () => {
    expect(names(`${HUMAN_NAME} prefers MC dark mode`)).toEqual(
      expect.arrayContaining([HUMAN_NAME, "Mission Control"]),
    );
    expect(names("Deployed ManaTokenV1.sol")).toContain("ManaToken");
    expect(names("mission-control uses Next.js")).toContain("Mission Control");
    expect(names("Moved notes into the arcane-vault folder")).toContain("Obsidian");
  });
});
