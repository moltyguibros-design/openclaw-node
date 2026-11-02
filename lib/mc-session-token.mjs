/**
 * mc-session-token.mjs — read Mission Control's session token for local callers.
 *
 * Mission Control now requires its session token on EVERY /api method,
 * including GET (review C-4: any process that could open a loopback socket
 * could read every API, and a page load handed the token to anyone). The
 * daemons and watchdogs on the same host that legitimately call it — node-watch,
 * mc-health, memory-maintenance, scheduler-heartbeat — read the same 0600 file
 * MC wrote, exactly as scheduler-heartbeat already did. One helper, not four
 * copies.
 *
 * Never put the token on a command line (ps exposes argv); send it as a header.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_MC_TOKEN_PATH = path.join(os.homedir(), '.openclaw', 'config', 'mc-session-token');

export function initializeMcSessionToken(opts = {}) {
  const tokenPath = opts.tokenPath || process.env.OPENCLAW_MC_TOKEN_FILE || DEFAULT_MC_TOKEN_PATH;
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(tokenPath)) {
    const temporary = `${tokenPath}.init.${process.pid}.${randomBytes(8).toString('hex')}`;
    fs.writeFileSync(temporary, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    try { fs.linkSync(temporary, tokenPath); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { fs.unlinkSync(temporary); }
  }
  const stat = fs.lstatSync(tokenPath);
  if (!stat.isFile() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Mission Control session token must be a private file owned by this user');
  }
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (!token) throw new Error('Mission Control session token is empty');
  return token;
}

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
