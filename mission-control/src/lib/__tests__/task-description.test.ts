import { describe, it, expect } from "vitest";
import { extractDept, extractEstimate } from "../task-description";

describe("extractDept", () => {
  it("reads the pipeline's bare dept and tagged forms", () => {
    expect(extractDept("DEV")).toBe("DEV");
    expect(extractDept("⚠️ CRITICAL PATH — DEV")).toBe("DEV");
    expect(extractDept("⚠ IMPORTANT — QA")).toBe("QA");
  });

  it("reads the dept from a ' · ' metadata line", () => {
    expect(extractDept("DEV · 5.0h · M1/D3")).toBe("DEV");
  });

  it("reads the dept the dialog moved below an added estimate", () => {
    expect(extractDept("5.0h\n\nDEV")).toBe("DEV");
  });

  it("does not report free text or prototype keys as a dept", () => {
    expect(extractDept("Fix the login bug")).toBeNull();
    expect(extractDept("constructor")).toBeNull();
    expect(extractDept(null)).toBeNull();
  });
});

describe("extractEstimate", () => {
  it("reads the hours segment of a metadata line", () => {
    expect(extractEstimate("DEV · 5.0h · M1/D3")).toBe("5.0h");
  });

  it("reads the estimate the dialog wrote above a rich description", () => {
    expect(extractEstimate("5.0h\n\nDEV")).toBe("5.0h");
  });

  it("does not take hours out of prose", () => {
    expect(extractEstimate("wait 48h then retry")).toBeNull();
    expect(extractEstimate(null)).toBeNull();
  });
});
