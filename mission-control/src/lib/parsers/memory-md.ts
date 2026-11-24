import fs from "fs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LongTermMemory {
  filePath: string;
  title: string;
  fullContent: string;
  modifiedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Parser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Parse MEMORY.md into its title (the first H1 heading) and raw content.
 *
 * Throws if the file does not exist.
 */
export function parseMemoryMd(filePath: string): LongTermMemory {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Memory file not found: ${filePath}`);
  }

  const fullContent = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);

  // Extract title from first H1 heading
  const titleMatch = fullContent.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : "MEMORY.md";

  return {
    filePath,
    title,
    fullContent,
    modifiedAt: stat.mtime.toISOString(),
  };
}
