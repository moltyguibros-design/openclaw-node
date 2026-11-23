import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAgentName } from "@/lib/agent-name";

// OPENCLAW_AGENT_NAME reached only the server: client components read a
// NEXT_PUBLIC_AGENT_NAME nothing set, labels were literals, and MC's unit does not
// pass openclaw.env. Server, client bundle and labels now take one resolved name.

const SRC = path.resolve(__dirname, "..", "..");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("resolveAgentName", () => {
  const envFile = (body: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-name-"));
    fs.writeFileSync(path.join(dir, "openclaw.env"), body);
    return path.join(dir, "openclaw.env");
  };

  it("takes the environment first, then the first copy in openclaw.env, then Daedalus", () => {
    const file = envFile("OPENCLAW_AGENT_NAME='Icarus'\nOPENCLAW_AGENT_NAME=Later\n");
    expect(resolveAgentName({ OPENCLAW_AGENT_NAME: "Talos" }, file)).toBe("Talos");
    expect(resolveAgentName({}, file)).toBe("Icarus");
    expect(resolveAgentName({}, path.join(os.tmpdir(), "no-such-dir", "openclaw.env"))).toBe("Daedalus");
  });
});

describe("one agent name everywhere", () => {
  it("next.config inlines the resolved name for client components", async () => {
    vi.stubEnv("OPENCLAW_AGENT_NAME", "Icarus");
    const config = (await import("../../../next.config")).default;
    expect(config.env?.NEXT_PUBLIC_AGENT_NAME).toBe("Icarus");
  });

  it("the server's dispatch signal file follows the name", async () => {
    vi.stubEnv("OPENCLAW_AGENT_NAME", "Icarus");
    const { AGENT_NAME, DISPATCH_SIGNAL_FILE } = await import("@/lib/config");
    expect(AGENT_NAME).toBe("Icarus");
    expect(DISPATCH_SIGNAL_FILE).toBe("icarus-dispatch.json");
  });

  it.each([
    "components/board/task-card.tsx",
    "components/board/unified-task-dialog.tsx",
    "components/board/status-banner.tsx",
    "components/live/chat-bubble.tsx",
    "app/layout.tsx",
    "app/memory/page.tsx",
  ])("%s labels with the shared client name, not a literal", (file) => {
    const src = fs.readFileSync(path.join(SRC, file), "utf8");
    expect(src).toContain('from "@/lib/client-agent-name"');
    expect(src).not.toMatch(/Daedalus/);
  });
});
