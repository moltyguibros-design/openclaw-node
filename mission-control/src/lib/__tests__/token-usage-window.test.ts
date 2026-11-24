import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

// token_usage.timestamp defaults to datetime('now'), 'YYYY-MM-DD HH:MM:SS'. The period bounds
// were ISO ('...T...'), and since 'T' sorts after ' ', today always read 0 and week/month
// dropped every row of their first day.

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-tokens-"));
  vi.stubEnv("DB_PATH", path.join(root, "mission-control.db"));
  vi.stubEnv("WORKSPACE_ROOT", root);
  vi.resetModules();
});

afterEach(async () => {
  const { getRawDb } = await import("@/lib/db");
  getRawDb().close();
  vi.unstubAllEnvs();
  vi.resetModules();
  fs.rmSync(root, { recursive: true, force: true });
});

async function usage(period: string) {
  const { GET } = await import("@/app/api/mesh/tokens/route");
  return (await GET(new NextRequest(`http://x/api/mesh/tokens?period=${period}`))).json();
}

describe("GET /api/mesh/tokens", () => {
  it("counts a row recorded today in today's totals", async () => {
    const { POST } = await import("@/app/api/mesh/tokens/route");
    const body = { task_id: "T-1", node_id: "n1", model: "m", input_tokens: 10, output_tokens: 5, cost_usd: 0.25 };
    expect((await POST(new NextRequest("http://x/api/mesh/tokens", { method: "POST", body: JSON.stringify(body) }))).status).toBe(200);
    const today = await usage("today");
    expect(today.taskCount).toBe(1);
    expect(today.totalCost).toBe(0.25);
  });

  it("keeps the boundary day's rows in the week and month windows", async () => {
    const { getRawDb } = await import("@/lib/db");
    const raw = getRawDb();
    const insert = raw.prepare("INSERT INTO token_usage (model, input_tokens, output_tokens, cost_usd, timestamp) VALUES ('m', 1, 1, 1, datetime('now', ?, '+1 hour'))");
    insert.run("-7 days");
    insert.run("-1 month");
    expect((await usage("week")).taskCount).toBe(1);
    expect((await usage("month")).taskCount).toBe(2);
  });
});
