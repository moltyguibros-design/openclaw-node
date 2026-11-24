import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const listItem = (id: number, source: string, title: string) => ({
  id,
  source,
  category: null,
  filePath: `/w/${source}/${title}.md`,
  title,
  date: null,
  modifiedAt: null,
});

vi.mock("@/lib/hooks", () => ({
  useMemoryDoc: () => ({
    doc: { id: 1, source: "lore", category: null, filePath: "/w/lore/a.md", title: "A", date: null, content: "x", frontmatter: null },
    isLoading: false,
  }),
  useMemoryDocs: () => ({
    docs: [listItem(1, "lore", "a"), listItem(2, "daily_log", "b"), listItem(3, "long_term_memory", "c")],
    total: 3,
    isLoading: false,
  }),
  useMemorySearch: () => ({ results: [], total: 0, isLoading: false }),
}));

import { MemoryList } from "@/components/memory/memory-list";
import { SearchResults } from "@/components/memory/search-results";
import { DocReader } from "@/components/memory/doc-reader";
import MemoryPage from "@/app/memory/page";

const src = (f: string) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");

describe("Memory page sources", () => {
  it("labels a lore document Lore in the list and the reader", () => {
    const list = renderToStaticMarkup(
      createElement(MemoryList, { docs: [listItem(1, "lore", "a")], isLoading: false, selectedPath: null, onSelect: () => {} }),
    );
    expect(list).toContain("Lore");
    expect(list).not.toContain("Daily Log");
    const reader = renderToStaticMarkup(createElement(DocReader, { filePath: "/w/lore/a.md" }));
    expect(reader).toContain("Lore");
    expect(reader).not.toContain("Daily Log");
  });

  it("gives search hits their own source badge with every underscore spaced", () => {
    const hit = (id: number, source: string) => ({
      id,
      source,
      category: null,
      filePath: `/w/${id}.md`,
      title: `t${id}`,
      date: null,
      modifiedAt: null,
      excerpt: "x",
      rank: 1,
    });
    const html = renderToStaticMarkup(
      createElement(SearchResults, {
        results: [hit(1, "long_term_memory"), hit(2, "lore")],
        total: 2,
        isLoading: false,
        query: "xy",
        selectedPath: null,
        onSelect: () => {},
      }),
    );
    expect(html).toContain("long term memory");
    expect(html).toMatch(/text-emerald-400[^>]*>lore</);
  });

  it("has a Lore chip and keeps per-source counts from the unfiltered list", () => {
    const html = renderToStaticMarkup(createElement(MemoryPage));
    expect(html).toMatch(/Lore<span class="opacity-60">\(1\)<\/span>/);
    expect(src("app/memory/page.tsx")).toMatch(/useMemoryDocs\(\)/);
  });
});
