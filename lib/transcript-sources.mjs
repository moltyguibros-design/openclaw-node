/**
 * transcript-sources.mjs — the one reader of config/transcript-sources.json.
 *
 * The memory daemon, session-recap, session-search --import and
 * heartbeat-detect all decide from here which transcript folders exist.
 * A readable registry is authoritative: its enabled sources, nothing else, so
 * an operator who disables every source stops ingest everywhere. The default
 * folders apply only when the registry is missing or cannot be parsed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { memoryDaemonPaths } from './memory-daemon-paths.mjs';

/**
 * @param {string} [openclawRoot] — node root holding config/ and agents/
 *   (default: OPENCLAW_HOME, else ~/.openclaw)
 * @param {object} [opts]
 * @param {string} [opts.workspace] — workspace whose Claude Code project folder
 *   is a default source (default: <root>/workspace)
 * @param {(msg: string) => void} [opts.warn] — told when the registry is unreadable
 * @returns {Array<{ name: string, path: string, format?: string, enabled?: boolean }>}
 */
export function loadTranscriptSources(openclawRoot = memoryDaemonPaths().root, opts = {}) {
  const home = os.homedir();
  const registry = path.join(openclawRoot, 'config', 'transcript-sources.json');
  if (fs.existsSync(registry)) {
    try {
      const reg = JSON.parse(fs.readFileSync(registry, 'utf-8'));
      return (Array.isArray(reg.sources) ? reg.sources : [])
        .filter((s) => s && s.enabled !== false && typeof s.path === 'string')
        .map((s) => ({ ...s, path: s.path.startsWith('~') ? path.join(home, s.path.slice(1)) : s.path }));
    } catch (err) {
      opts.warn?.(`transcript registry ${registry} unreadable (${err.message}); using the default sources`);
    }
  }

  const workspace = opts.workspace || path.join(openclawRoot, 'workspace');
  const workspaceAbs = fs.existsSync(workspace) ? fs.realpathSync(workspace) : workspace;
  return [
    { name: 'claude-code', path: path.join(home, '.claude', 'projects', workspaceAbs.replace(/[/.]/g, '-')), format: 'claude-code' },
    { name: 'claude-home', path: path.join(home, '.claude', 'projects', '-' + path.basename(home)), format: 'claude-code' },
    { name: 'gateway', path: path.join(openclawRoot, 'agents', 'main', 'sessions'), format: 'openclaw-gateway' },
  ];
}
