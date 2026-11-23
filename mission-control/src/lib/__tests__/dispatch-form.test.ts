import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("swr", () => ({ default: () => ({ data: { nodes: [] } }), mutate: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  useClusters: () => ({
    clusters: [
      {
        id: "c1",
        name: "Alpha",
        color: null,
        defaultMode: "review",
        defaultConvergence: "coordinator",
        convergenceThreshold: 80,
        maxRounds: 3,
        members: [{ nodeId: "worker1", role: "lead" }],
      },
      {
        id: "c2",
        name: "Beta",
        color: null,
        defaultMode: "parallel",
        defaultConvergence: "majority",
        convergenceThreshold: 80,
        maxRounds: 5,
        members: [{ nodeId: "worker2", role: "worker" }],
      },
    ],
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

const selectedButton = (html: string, label: string) =>
  new RegExp(`<button class="[^"]*bg-accent text-accent-foreground[^"]*">${label}</button>`).test(html);

describe("Cowork cluster defaults and roles", () => {
  it("the dispatch form starts from the selected cluster's mode, convergence and max rounds", () => {
    const html = renderToStaticMarkup(createElement(DispatchForm, { initialClusterId: "c1" }));
    expect(selectedButton(html, "review")).toBe(true);
    expect(selectedButton(html, "parallel")).toBe(false);
    expect(selectedButton(html, "coordinator")).toBe(true);
    expect(selectedButton(html, "unanimous")).toBe(false);
    expect(html).toMatch(/<input type="number" min="1" max="20"[^>]*value="3"/);
  });

  it("a majority cluster's threshold pre-fills the threshold slider", () => {
    const html = renderToStaticMarkup(createElement(DispatchForm, { initialClusterId: "c2" }));
    expect(selectedButton(html, "majority")).toBe(true);
    expect(html).toMatch(/<input type="range" min="50" max="100"[^>]*value="80"/);
    expect(html).toContain("80%");
  });

  it("without a cluster the form starts at parallel / unanimous / 5 rounds", () => {
    const html = renderToStaticMarkup(createElement(DispatchForm, {}));
    expect(selectedButton(html, "parallel")).toBe(true);
    expect(selectedButton(html, "unanimous")).toBe(true);
    expect(html).toMatch(/<input type="number" min="1" max="20"[^>]*value="5"/);
  });

  it("no Cowork screen offers member roles the daemon never reads", () => {
    expect(renderToStaticMarkup(createElement(DispatchForm, { initialClusterId: "c1" }))).not.toContain("Lead");
    for (const f of [
      "components/cowork/dispatch-form.tsx",
      "components/cowork/cluster-card.tsx",
      "components/cowork/create-cluster-dialog.tsx",
      "app/cowork/page.tsx",
    ]) {
      expect(src(f), f).not.toMatch(/RolePicker|RoleBadge/);
    }
    expect(src("components/cowork/session-card.tsx")).toMatch(/<RoleBadge role=\{node\.role\}/);
  });
});
