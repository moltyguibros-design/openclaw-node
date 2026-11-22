import fs from "fs";
import path from "path";
import os from "os";
import { OPENCLAW_ROOT, WORKSPACE_ROOT } from "../config";

/**
 * Represents a single activity event extracted from the JSONL transcript.
 */
export interface TranscriptEvent {
  timestamp: string;
  type: "file_write" | "file_edit" | "file_read" | "bash_command" | "bash_result" | "message";
  tool: string;
  detail: string;       // human-readable summary
  filePath?: string;     // for file operations
  command?: string;      // for bash commands
  success?: boolean;     // for bash results (exit code 0 = true)
}

/**
 * Encode a workspace path to the agent CLI's project directory format.
 * Same algorithm as agent-activity.js: strip leading /, replace / and . with -
 */
function toAgentProjectPath(workspacePath: string): string {
  return workspacePath.replace(/\\/g, "/").replace(/:/g, "").replace(/[/.]/g, "-");
}

const HOME = process.env.HOME || os.homedir();

const PARSED_FORMATS = new Set(["claude-code", "openclaw-gateway"]);

function registryDirs(): string[] {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(OPENCLAW_ROOT, "config", "transcript-sources.json"), "utf-8"),
    ) as { sources?: Array<{ path: string; format?: string; enabled?: boolean }> };
    return (reg.sources || [])
      .filter((s) => s.enabled !== false && PARSED_FORMATS.has(s.format || ""))
      .map((s) => (s.path.startsWith("~") ? path.join(HOME, s.path.slice(1)) : s.path));
  } catch {
    return [];
  }
}

// The two defaults stay in the union: the registry template hard-codes
// ~/.openclaw/agents/main/sessions/, which is wrong under a non-default OPENCLAW_ROOT.
const TRANSCRIPT_DIRS = [
  ...new Set(
    [
      path.join(HOME, ".claude/projects", toAgentProjectPath(WORKSPACE_ROOT)),
      path.join(OPENCLAW_ROOT, "agents", "main", "sessions"),
      ...registryDirs(),
    ].map((d) => path.resolve(d)),
  ),
];

const GATEWAY_TOOL_NAMES: Record<string, string> = { read: "Read", write: "Write", edit: "Edit", exec: "Bash" };

// The live sidebar polls every 5s. A full readdir + stat of every transcript per
// poll grows with every session, so each directory is re-listed only when its
// mtime changes (a session file was added or removed). Between scans only the
// remembered newest file is stat'ed; the periodic rescan catches an older
// session that resumed and was appended to, which leaves the directory mtime alone.
const RESCAN_MS = 60_000;
const TAIL_BYTES = 300_000;

interface DirScan {
  dirMtimeMs: number;
  scannedAt: number;
  latest: string | null;
}

const dirScans = new Map<string, DirScan>();
let tailCache: { path: string; size: number; mtimeMs: number; events: TranscriptEvent[] } | null = null;

async function statOrNull(p: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

async function scanDir(dir: string, dirMtimeMs: number): Promise<DirScan> {
  const names = (await fs.promises.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  const stats = await Promise.all(names.map((n) => statOrNull(path.join(dir, n))));
  let latest: string | null = null;
  let latestMtime = 0;
  for (let i = 0; i < names.length; i++) {
    const st = stats[i];
    if (st && st.mtimeMs > latestMtime) {
      latestMtime = st.mtimeMs;
      latest = path.join(dir, names[i]);
    }
  }
  const scan = { dirMtimeMs, scannedAt: Date.now(), latest };
  dirScans.set(dir, scan);
  return scan;
}

async function latestInDir(dir: string): Promise<{ path: string; stat: fs.Stats } | null> {
  const dirStat = await statOrNull(dir);
  if (!dirStat) {
    dirScans.delete(dir);
    return null;
  }
  let scan = dirScans.get(dir);
  if (!scan || scan.dirMtimeMs !== dirStat.mtimeMs || Date.now() - scan.scannedAt >= RESCAN_MS) {
    scan = await scanDir(dir, dirStat.mtimeMs);
  }
  if (!scan.latest) return null;
  const stat = await statOrNull(scan.latest);
  if (stat) return { path: scan.latest, stat };
  scan = await scanDir(dir, dirStat.mtimeMs);
  const retry = scan.latest ? await statOrNull(scan.latest) : null;
  return retry && scan.latest ? { path: scan.latest, stat: retry } : null;
}

/**
 * Find the most recently modified .jsonl transcript across all frontend sources.
 */
export async function findLatestTranscript(): Promise<{ path: string; stat: fs.Stats } | null> {
  let best: { path: string; stat: fs.Stats } | null = null;
  for (const dir of TRANSCRIPT_DIRS) {
    const found = await latestInDir(dir);
    if (found && (!best || found.stat.mtimeMs > best.stat.mtimeMs)) best = found;
  }
  return best;
}

/**
 * Read the last `bytes` of a JSONL file and parse its complete lines.
 */
async function tailJsonl(filePath: string, size: number, bytes: number): Promise<object[]> {
  const start = Math.max(0, size - bytes);
  const buf = Buffer.alloc(size - start);
  const fh = await fs.promises.open(filePath, "r");
  try {
    await fh.read(buf, 0, buf.length, start);
  } finally {
    await fh.close();
  }

  const lines = buf.toString("utf-8").split("\n");

  // Skip first line if we started mid-file (it's likely truncated)
  const startIdx = start > 0 ? 1 : 0;
  const results: object[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      results.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  return results;
}

/**
 * Extract activity events from the most recent transcript.
 * Returns the last `limit` events, most recent first.
 */
export async function getRecentTranscriptActivity(limit: number = 50): Promise<TranscriptEvent[]> {
  const latest = await findLatestTranscript();
  if (!latest) return [];

  const { size, mtimeMs } = latest.stat;
  if (!tailCache || tailCache.path !== latest.path || tailCache.size !== size || tailCache.mtimeMs !== mtimeMs) {
    const entries = await tailJsonl(latest.path, size, TAIL_BYTES);
    tailCache = { path: latest.path, size, mtimeMs, events: extractEvents(entries) };
  }

  // Return most recent first, limited
  return tailCache.events.slice(-limit).reverse();
}

function extractEvents(entries: object[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];

  for (const entry of entries) {
    const obj = entry as Record<string, unknown>;
    const timestamp = obj.timestamp as string;
    const type = obj.type as string;

    if (!timestamp) continue;

    // Handle both Claude Code (type: "assistant") and OpenClaw Gateway (type: "message" with role: "assistant")
    const msg = obj.message as Record<string, unknown> | undefined;
    const isAssistant =
      type === "assistant" ||
      (type === "message" && msg?.role === "assistant");

    if (isAssistant) {
      if (!msg) continue;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        const gateway = block.type === "toolCall";
        if (block.type === "tool_use" || gateway) {
          const toolName = gateway ? GATEWAY_TOOL_NAMES[block.name as string] : (block.name as string);
          const input = ((gateway ? block.arguments : block.input) || {}) as Record<string, unknown>;

          switch (toolName) {
            case "Write": {
              const fp = input.file_path as string;
              const shortPath = fp ? shortenPath(fp) : "unknown";
              events.push({
                timestamp,
                type: "file_write",
                tool: "Write",
                detail: `Wrote ${shortPath}`,
                filePath: fp,
              });
              break;
            }
            case "Edit": {
              const fp = input.file_path as string;
              const shortPath = fp ? shortenPath(fp) : "unknown";
              events.push({
                timestamp,
                type: "file_edit",
                tool: "Edit",
                detail: `Edited ${shortPath}`,
                filePath: fp,
              });
              break;
            }
            case "Read": {
              const fp = input.file_path as string;
              const shortPath = fp ? shortenPath(fp) : "unknown";
              events.push({
                timestamp,
                type: "file_read",
                tool: "Read",
                detail: `Read ${shortPath}`,
                filePath: fp,
              });
              break;
            }
            case "Bash": {
              const cmd = (input.command as string) || "";
              const desc = (input.description as string) || "";
              const shortCmd = desc || cmd.slice(0, 80);
              events.push({
                timestamp,
                type: "bash_command",
                tool: "Bash",
                detail: shortCmd,
                command: cmd,
              });
              break;
            }
            // Skip TodoWrite, Glob, Grep, etc. — too noisy
          }
        }
      }
    }
  }

  return events;
}

/**
 * Shorten a file path for display by removing the workspace prefix.
 */
function shortenPath(fp: string): string {
  const prefixes = [
    `${WORKSPACE_ROOT}/`,
    `${HOME}/`,
  ];
  for (const prefix of prefixes) {
    if (fp.startsWith(prefix)) {
      return fp.slice(prefix.length);
    }
  }
  return fp.split("/").slice(-2).join("/");
}
