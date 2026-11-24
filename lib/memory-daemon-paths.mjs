/**
 * memory-daemon-paths.mjs — where a memory daemon keeps its node state.
 *
 * OPENCLAW_HOME (default ~/.openclaw) is the node root: a spawned dev node
 * (bin/spawn-node.mjs) is its own root, so several daemons on one machine keep
 * separate config, databases and watcher logs instead of sharing ~/.openclaw.
 * With OPENCLAW_HOME unset every path is the one the daemon always used.
 */
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_INJECT_PORT = 7893;

export function memoryDaemonPaths(env = process.env, home = os.homedir()) {
  const root = env.OPENCLAW_HOME || path.join(home, '.openclaw');
  return {
    root,
    // An explicit OPENCLAW_HOME owns its workspace too; otherwise the daemon
    // keeps running from the workspace it is installed in.
    workspace: env.OPENCLAW_WORKSPACE || (env.OPENCLAW_HOME ? path.join(root, 'workspace') : null),
    config: path.join(root, 'config', 'daemon.json'),
    transcriptSources: path.join(root, 'config', 'transcript-sources.json'),
    gatewaySessions: path.join(root, 'agents', 'main', 'sessions'),
    stateDb: path.join(root, 'state.db'),
    knowledgeDb: path.join(root, 'workspace', '.knowledge.db'),
    graphCacheDb: env.GRAPH_CACHE_DB_PATH || path.join(root, 'graph-cache.db'),
    watcherLog: path.join(root, 'watcher.jsonl'),
    // The vault the flush writes notes into. Null keeps getVaultPath's own
    // resolution; a spawned node owns the obsidian-local spawn-node lays out.
    vault: env.OPENCLAW_HOME ? (env.OBSIDIAN_VAULT_PATH || path.join(root, 'obsidian-local')) : null,
    injectPort: Number(env.MEMORY_INJECT_PORT) || DEFAULT_INJECT_PORT,
  };
}
