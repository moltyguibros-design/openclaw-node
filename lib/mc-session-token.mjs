/**
 * mc-session-token.mjs — read Mission Control's session token for local callers.
 *
 * Mission Control now requires its session token on EVERY /api method,
 * including GET (review C-4: any process that could open a loopback socket
 * could read every API, and a page load handed the token to anyone). The
 * local callers that use this helper — node-watch, mc-health and
 * memory-maintenance — read the same 0600 file MC wrote. scheduler-heartbeat
 * and the shell/python wrappers (mc-api, compile-boot) read that file
 * themselves.
 *
 * OPENCLAW_MC_TOKEN_FILE is a test-only override: Mission Control writes the
 * token under the root derived from its workspace (see defaultMcTokenPath) and
 * ignores it, so pointing a production client elsewhere only earns 401s.
 *
 * Never put the token on a command line (ps exposes argv); send it as a header.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mission Control writes the token under the root it derives from its workspace
// (mission-control/src/lib/config.ts OPENCLAW_ROOT), which is not ~/.openclaw when
// the installer ran with OPENCLAW_ROOT set; readers derive the same root.
/** @param {Record<string, string | undefined>} [env] */
export function mcOpenclawRoot(env = process.env) {
  return path.dirname(env.WORKSPACE_ROOT || env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace'));
}

/** @param {Record<string, string | undefined>} [env] */
export function defaultMcTokenPath(env = process.env) {
  return path.join(mcOpenclawRoot(env), 'config', 'mc-session-token');
}

export const DEFAULT_MC_TOKEN_PATH = defaultMcTokenPath();

/** The token, or null when the file is absent/empty (MC not yet started). */
export function readMcSessionToken(opts = {}) {
  const tokenPath = opts.tokenPath || process.env.OPENCLAW_MC_TOKEN_FILE || DEFAULT_MC_TOKEN_PATH;
  try {
    const t = fs.readFileSync(tokenPath, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Headers to attach to a request to Mission Control ({} when no token is available). */
export function mcAuthHeaders(opts = {}) {
  const t = readMcSessionToken(opts);
  return t ? { Authorization: `Bearer ${t}` } : {};
}
