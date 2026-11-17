/**
 * soul-access.ts — ask lib/soul-memory-access.mjs whether a soul may read or write a
 * memory-vault category, the same rule workspace-bin/clawvault-access-control applies.
 *
 * Loaded at runtime by absolute path, like mesh-sign.ts loads operator-auth.mjs, so there
 * is one implementation of the rule rather than a TypeScript twin. Candidates, first that
 * exists wins: $OPENCLAW_LIB_DIR, <cwd>/../../lib (installed), <cwd>/../lib (repo checkout).
 * Fails closed: an unloadable rule is a denial.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export interface SoulAccess {
  granted: boolean;
  reason: string;
}

type Check = (args: { soulId: string; category: string; action: "read" | "write"; soulsDir?: string }) => SoulAccess;

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.OPENCLAW_LIB_DIR) out.push(path.join(process.env.OPENCLAW_LIB_DIR, "soul-memory-access.mjs"));
  out.push(path.resolve(process.cwd(), "..", "..", "lib", "soul-memory-access.mjs"));
  out.push(path.resolve(process.cwd(), "..", "lib", "soul-memory-access.mjs"));
  return out;
}

async function loadCheck(): Promise<Check> {
  const found = candidates().find((p) => fs.existsSync(p));
  if (!found) throw new Error(`soul-memory-access.mjs not found (tried: ${candidates().join(", ")})`);
  const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(found).href);
  return mod.checkSoulMemoryAccess as Check;
}

export async function checkSoulAccess(
  soulId: string,
  category: string,
  action: "read" | "write",
  soulsDir?: string,
): Promise<SoulAccess> {
  try {
    return (await loadCheck())({ soulId, category, action, soulsDir });
  } catch (err) {
    return { granted: false, reason: `access check unavailable: ${(err as Error).message}` };
  }
}
