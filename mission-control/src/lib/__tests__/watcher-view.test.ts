import { expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { watcherViews } from "../watcher-view";

it("derives the stream and the failure list from one newest-first poll", () => {
  const base = Date.parse("2026-11-22T12:00:00Z");
  const events = Array.from({ length: 150 }, (_, i) => ({
    ts: new Date(base - i * 1000).toISOString(),
    op: "memory.ingested",
    status: "ok",
  }));
  events[140].status = "noop";
  events[5].status = "error";
  events[120].status = "noop";
  events[60].status = "error";
  events[110].status = "noop";

  const { stream, failures } = watcherViews(events);
  expect(stream).toHaveLength(100);
  expect(stream[0]).toBe(events[0]);
  expect(failures.map((e) => events.indexOf(e))).toEqual([5, 60, 110, 120, 140]);
});

it("the watcher page polls /api/watcher once", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../app/watcher/page.tsx"), "utf8");
  expect(page.match(/useWatcher\(/g)).toHaveLength(1);
});
