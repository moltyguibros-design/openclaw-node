import { afterEach, describe, expect, it, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fetcher } from "../hooks";

afterEach(() => vi.unstubAllGlobals());

const reply = (body: string, status: number) => vi.fn(async () => new Response(body, { status }));

describe("fetcher", () => {
  it("rejects with the route's {error} on a non-2xx reply, so SWR sets error instead of data", async () => {
    vi.stubGlobal("fetch", reply(JSON.stringify({ error: "Secret path denied" }), 403));
    await expect(fetcher("/api/memory/doc?path=x.db")).rejects.toThrow("Secret path denied");
  });

  it("rejects with the HTTP status when the error body is not JSON", async () => {
    vi.stubGlobal("fetch", reply("bad gateway", 502));
    await expect(fetcher("/api/tasks")).rejects.toThrow("HTTP 502");
  });

  it("resolves the parsed body on success", async () => {
    vi.stubGlobal("fetch", reply(JSON.stringify([{ id: "t" }]), 200));
    await expect(fetcher("/api/tasks")).resolves.toEqual([{ id: "t" }]);
  });
});

const src = path.join(__dirname, "..", "..");
const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(path.join(src, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return /\.tsx?$/.test(e.name) ? [rel] : [];
  });

test("pages and components use the shared fetcher instead of defining their own", () => {
  const ownFetcher = ["app", "components"]
    .flatMap(sourceFiles)
    .filter((rel) => /\b(const|function)\s+fetcher\b/.test(fs.readFileSync(path.join(src, rel), "utf-8")));
  expect(ownFetcher).toEqual([]);
});
