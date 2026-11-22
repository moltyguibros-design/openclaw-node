import { describe, expect, it } from "vitest";
import { eventsUrl } from "@/lib/observability-query";

describe("eventsUrl", () => {
  it("sends the errors-only and module filters to the server", () => {
    const url = new URL(eventsUrl(500, "error", "mesh-agent"), "http://x");
    expect(url.pathname).toBe("/api/observability/events");
    expect(url.searchParams.get("hours")).toBe("24");
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.get("error")).toBe("true");
    expect(url.searchParams.get("module")).toBe("mesh-agent");
  });

  it("keeps the warn level and 'all modules' client-side", () => {
    const url = new URL(eventsUrl(1000, "warn", "all"), "http://x");
    expect(url.searchParams.has("error")).toBe(false);
    expect(url.searchParams.has("module")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("1000");
  });
});
