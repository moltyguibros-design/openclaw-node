/**
 * The installer used to copy GOOGLE_API_KEY into .env.local as GEMINI_API_KEY once, so a
 * key added to openclaw.env later never reached the voice. The provider now resolves
 * GOOGLE_API_KEY from openclaw.env like the NATS settings.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createGoogleTtsProvider } from "../tts/google";

describe("Google TTS key resolution", () => {
  let home: string;
  const sentKeys: string[] = [];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "mc-tts-key-"));
    vi.stubEnv("OPENCLAW_HOME", home);
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    sentKeys.length = 0;
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
      sentKeys.push(init.headers["x-goog-api-key"]);
      const pcm = Buffer.alloc(4).toString("base64");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pcm } }] } }] }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("uses GOOGLE_API_KEY from the openclaw.env under OPENCLAW_HOME", async () => {
    writeFileSync(join(home, "openclaw.env"), "GOOGLE_API_KEY=from-openclaw-env\n");
    const res = await createGoogleTtsProvider().synthesize({ text: "hi" });
    expect(res.contentType).toBe("audio/wav");
    expect(sentKeys).toEqual(["from-openclaw-env"]);
  });

  it("an explicit GEMINI_API_KEY in the environment still wins", async () => {
    writeFileSync(join(home, "openclaw.env"), "GOOGLE_API_KEY=from-openclaw-env\n");
    vi.stubEnv("GEMINI_API_KEY", "from-process-env");
    await createGoogleTtsProvider().synthesize({ text: "hi" });
    expect(sentKeys).toEqual(["from-process-env"]);
  });

  it("refuses without any key, so the caller falls back to another voice", async () => {
    await expect(createGoogleTtsProvider().synthesize({ text: "hi" })).rejects.toThrow(/GOOGLE_API_KEY/);
    expect(sentKeys).toEqual([]);
  });
});
