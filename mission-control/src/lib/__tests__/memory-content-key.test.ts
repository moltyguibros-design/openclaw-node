import { describe, it, expect } from "vitest";
import { memoryContentKey } from "../hooks";

describe("memoryContentKey", () => {
  it("fetches the unscoped top-N view for the page's empty filter", () => {
    expect(memoryContentKey("")).toBe("/api/memory-content?");
  });

  it("scopes by text filter", () => {
    expect(memoryContentKey("abc")).toBe("/api/memory-content?q=abc");
  });

  it("scopes by session for the watcher panel", () => {
    expect(memoryContentKey(undefined, "s1")).toBe("/api/memory-content?session=s1");
  });

  it("fetches nothing for a session-less watcher panel (repair 6.4)", () => {
    expect(memoryContentKey(undefined, undefined)).toBeNull();
  });
});
