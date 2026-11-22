/**
 * soul-access.ts — ask lib/soul-memory-access.mjs whether a soul may read or write a
 * memory-vault category, the same rule workspace-bin/clawvault-access-control applies.
 *
 * Loaded at runtime by absolute path (root-lib.ts), like mesh-sign.ts loads operator-auth.mjs,
 * so there is one implementation of the rule rather than a TypeScript twin.
 * Fails closed: an unloadable rule is a denial.
 */

import { loadRootLib } from "./root-lib";

export interface SoulAccess {
  granted: boolean;
  reason: string;
}

type Check = (args: { soulId: string; category: string; action: "read" | "write"; soulsDir?: string }) => SoulAccess;

export async function checkSoulAccess(
  soulId: string,
  category: string,
  action: "read" | "write",
  soulsDir?: string,
): Promise<SoulAccess> {
  try {
    const { checkSoulMemoryAccess } = await loadRootLib<{ checkSoulMemoryAccess: Check }>("soul-memory-access.mjs");
    return checkSoulMemoryAccess({ soulId, category, action, soulsDir });
  } catch (err) {
    return { granted: false, reason: `access check unavailable: ${(err as Error).message}` };
  }
}
