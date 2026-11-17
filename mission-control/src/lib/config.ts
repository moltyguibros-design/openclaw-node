import path from "path";
import fs from "fs";
import os from "os";

export const WORKSPACE_ROOT =
  process.env.WORKSPACE_ROOT ||
  process.env.OPENCLAW_WORKSPACE ||
  path.join(os.homedir(), ".openclaw", "workspace");

export const DB_PATH =
  process.env.DB_PATH ||
  path.join(WORKSPACE_ROOT, "projects", "mission-control", "data", "mission-control.db");

export const MEMORY_DIR = path.join(WORKSPACE_ROOT, "memory");
export const MEMORY_MD = path.join(WORKSPACE_ROOT, "MEMORY.md");

// The LIVE memory stores the daemon writes (siblings of WORKSPACE_ROOT, under
// ~/.openclaw). state.db holds the actual remembered content (entities,
// decisions, themes); the memory vault holds the synthesized concept/session
// notes — since the 2026-07-04 vault fusion it can live INSIDE the operator's
// real Obsidian vault (obsidian-sync.json memoryVaultPath, same resolution as
// lib/obsidian-vault.mjs getVaultPath), falling back to legacy obsidian-local.
export const STATE_DB_PATH =
  process.env.OPENCLAW_STATE_DB ||
  process.env.STATE_DB_PATH ||
  path.join(path.dirname(WORKSPACE_ROOT), "state.db");

function configuredMemoryVaultPath(): string | null {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), ".openclaw", "config", "obsidian-sync.json"), "utf8"),
    );
    if (!cfg.memoryVaultPath) return null;
    return path.isAbsolute(cfg.memoryVaultPath)
      ? cfg.memoryVaultPath
      : path.join(WORKSPACE_ROOT, cfg.memoryVaultPath);
  } catch {
    return null;
  }
}
export const OBSIDIAN_DIR =
  process.env.OBSIDIAN_DIR ||
  configuredMemoryVaultPath() ||
  path.join(path.dirname(WORKSPACE_ROOT), "obsidian-local");
// ~/.openclaw — the root containing every memory store/log a watcher event can
// point at (vault notes, the injections log, MEMORY.md). Read route is jailed here.
export const OPENCLAW_ROOT = path.dirname(WORKSPACE_ROOT);
export const ACTIVE_TASKS_MD = path.join(MEMORY_DIR, "active-tasks.md");
export const CLAWVAULT_DIR = path.join(WORKSPACE_ROOT, "memory-vault");
export const CLAWVAULT_INDEX = path.join(CLAWVAULT_DIR, ".clawvault-index.json");

// Lore knowledge base directories
export const LORE_DIRS = [
  path.join(WORKSPACE_ROOT, "projects", "arcane", "lore", "research"),
  path.join(WORKSPACE_ROOT, "projects", "arcane", "lore", "canon"),
  path.join(WORKSPACE_ROOT, "projects", "arcane", "lore", "drafts"),
];

// ── Identity Configuration ──
// Override via env vars to use any agent name or human name.

/** Name of the autonomous agent (shown in kanban, scheduler, notifications) */
export const AGENT_NAME = process.env.OPENCLAW_AGENT_NAME || "Daedalus";

/** Name of the human operator (shown in done-gate, manual task ownership) */
export const HUMAN_NAME = process.env.OPENCLAW_HUMAN_NAME || "Gui";

/** Dispatch signal filename (agent picks up auto-dispatched tasks via this file) */
export const DISPATCH_SIGNAL_FILE = `${AGENT_NAME.toLowerCase()}-dispatch.json`;

// ── Node Identity (Distributed MC) ──
import { hostname } from "os";

/** This node's unique identifier in the mesh: the id every daemon on it uses. */
export const NODE_ID = resolveDaemonNodeId();

/**
 * lib/node-id.js's rule, which the daemons use (and the memory daemon names
 * `.daemon-state-<id>.md` with). Their units get OPENCLAW_NODE_ID rendered from
 * openclaw.env, which MC's unit does not pass, so read that file before
 * falling back to the hostname rule.
 */
export function resolveDaemonNodeId(
  env: Record<string, string | undefined> = process.env,
  host: string = hostname(),
  envFile: string = path.join(os.homedir(), ".openclaw", "openclaw.env"),
): string {
  const fromEnv = (env.OPENCLAW_NODE_ID || "").trim();
  if (fromEnv) return fromEnv;
  let fromFile = "";
  try {
    const hits = [...fs.readFileSync(envFile, "utf8").matchAll(/^\s*OPENCLAW_NODE_ID\s*=(.*)$/gm)];
    fromFile = (hits.pop()?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  } catch {
    // no openclaw.env on this node
  }
  if (fromFile) return fromFile;
  const legacy = (env.MESH_NODE_ID || "").trim();
  if (legacy) return legacy;
  return host.split(".")[0].toLowerCase().replace(/[^a-z0-9-]/g, "") || "node";
}

/** This node's role: "lead" (full authority) or "worker" (read + propose) */
export const NODE_ROLE: "lead" | "worker" =
  (process.env.OPENCLAW_NODE_ROLE as "lead" | "worker") || "lead";

/** Platform identifier for display */
export const NODE_PLATFORM = process.platform === "darwin" ? "macOS" : "Linux";
