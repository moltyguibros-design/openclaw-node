import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deptFromTaskId, extractDept, extractEstimate } from "../task-description";

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

describe("deptFromTaskId", () => {
  it("reads a known dept prefix and nothing else", () => {
    expect(deptFromTaskId("T-20261122-001")).toBeNull();
    expect(deptFromTaskId("DEV-M01-001")).toBe("DEV");
    expect(deptFromTaskId("CONSTRUCTOR-1")).toBeNull();
  });

  it("the daily board uses it and the shared colours, and starts at the first scheduled day", () => {
    const board = fs.readFileSync(path.join(__dirname, "../../components/board/daily-board.tsx"), "utf8");
    expect(board).not.toMatch(/const DEPT_COLORS/);
    expect(board).toMatch(/import \{[^}]*\bdeptFromTaskId\b[^}]*\} from "@\/lib\/task-description"/);
    const goStart = board.slice(board.indexOf("const goStart"), board.indexOf("if (isLoading)"));
    expect(goStart).toContain("scheduledDate");
    expect(goStart).not.toContain("createdAt");
  });
});
