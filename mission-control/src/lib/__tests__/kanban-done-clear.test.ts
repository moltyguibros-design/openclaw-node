import { describe, it, expect } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KanbanColumn } from "@/components/board/kanban-column";
import type { Task } from "@/lib/hooks";

const DAY = 24 * 60 * 60 * 1000;

function doneTask(id: string, updatedAt: number): Task {
  return {
    id,
    title: id,
    status: "done",
    kanbanColumn: "done",
    updatedAt: new Date(updatedAt).toISOString(),
    createdAt: new Date(updatedAt).toISOString(),
  } as Task;
}

// No DOM in this suite: KanbanColumn runs as a plain call inside a host
// component so its hooks have a dispatcher, and the returned element tree is
// searched directly.
function columnTree(props: Parameters<typeof KanbanColumn>[0]): ReactNode {
  let tree: ReactNode = null;
  function Host() {
    tree = KanbanColumn(props);
    return null;
  }
  renderToStaticMarkup(createElement(Host));
  return tree;
}

function findByTitle(node: ReactNode, title: string): { onClick: () => void } | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByTitle(child, title);
      if (hit) return hit;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const props = node.props as { title?: string; onClick?: () => void; children?: ReactNode };
  if (props.title === title && props.onClick) return { onClick: props.onClick };
  return findByTitle(props.children, title);
}

describe("Done column Clear", () => {
  it("hands only the tasks inside the time window to onClearDone", () => {
    const recent = doneTask("recent", Date.now());
    const older = doneTask("older", Date.now() - 10 * DAY);
    const cleared: unknown[] = [];
    const tree = columnTree({
      column: "done",
      tasks: [recent, older],
      childrenMap: {},
      onTaskClick: () => {},
      onMoveTask: () => {},
      onClearDone: (visible) => cleared.push(visible),
    });

    const clear = findByTitle(tree, "Archive visible done tasks");
    expect(clear).toBeDefined();
    clear!.onClick();

    expect(cleared).toEqual([[recent]]);
  });
});
