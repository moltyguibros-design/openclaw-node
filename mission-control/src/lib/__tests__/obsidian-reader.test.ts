import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ObsidianReader } from "@/components/obsidian/obsidian-reader";

it("renders a resolved [[wikilink]] as an in-app button and still neutralises javascript: links", () => {
  const html = renderToStaticMarkup(
    createElement(ObsidianReader, {
      doc: {
        id: 1,
        source: "daily_log",
        category: null,
        filePath: "memory/a.md",
        title: "a",
        date: null,
        content: "see [[b]] and [x](javascript:alert(1))",
        frontmatter: null,
      },
      filePath: "memory/a.md",
      isLoading: false,
      onWikilinkClick: () => {},
      onClose: () => {},
      allDocs: [{ id: "memory/b.md", title: "b", source: "daily_log", category: null, linkCount: 0 }],
    }),
  );
  expect(html).toMatch(/<button[^>]*>b<\/button>/);
  expect(html).not.toMatch(/<a [^>]*>b<\/a>/);
  expect(html).not.toMatch(/href="javascript:/i);
});
