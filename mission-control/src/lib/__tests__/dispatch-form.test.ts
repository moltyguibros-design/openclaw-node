import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("swr", () => ({ default: () => ({ data: { nodes: [] } }), mutate: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  useClusters: () => ({
    clusters: [{ id: "c1", name: "Alpha", color: null, members: [{ nodeId: "worker1", role: "lead" }] }],
  }),
  fetcher: vi.fn(),
  dispatchCollabTask: vi.fn(),
}));

import { DispatchForm } from "@/components/cowork/dispatch-form";

const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");

describe("Cowork navigation targets", () => {
  it("'Assign Task' on a cluster opens the dispatch form with that cluster selected", () => {
    expect(renderToStaticMarkup(createElement(DispatchForm, { initialClusterId: "c1" }))).toContain("worker1");
    expect(renderToStaticMarkup(createElement(DispatchForm, {}))).not.toContain("worker1");
    expect(src("app/cowork/page.tsx")).toMatch(/<DispatchForm[^>]*initialClusterId=\{dispatchClusterId\}/);
  });

  it("the board opens the task named by /?task=<id> without useSearchParams", () => {
    const board = src("components/board/kanban-board.tsx");
    expect(board).toMatch(/new URLSearchParams\(window\.location\.search\)\.get\("task"\)/);
    expect(board).not.toMatch(/useSearchParams\(/);
  });
});
