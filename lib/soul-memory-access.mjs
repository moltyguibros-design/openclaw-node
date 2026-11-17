/**
 * soul-memory-access.mjs — which memory-vault categories a soul may read or write.
 *
 * The one rule, read from the soul's own declaration: capabilities.json
 * `permissions.memory` = { shared: "read"|"readwrite", private: [soul ids], handoffs: "read"|"readwrite" }.
 * workspace-bin/clawvault-access-control (and through it clawvault-local) and Mission
 * Control's soul prompt and handoff routes all ask this module. Fails closed: an unknown
 * soul, a missing or malformed declaration, an unknown category or action is a denial.
 *
 * Categories: `shared`, `handoffs`, `private/<soul>`, and `vault` — the whole vault at
 * once, which a clawvault command run in a soul's context touches: it needs readwrite on
 * shared and handoffs and every soul's private memory.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const DEFAULT_SOULS_DIR = process.env.OPENCLAW_SOULS_DIR || path.join(os.homedir(), '.openclaw', 'souls');

const allows = (level, action) => level === 'readwrite' || level === action;

function memoryPermissions(soulId, soulsDir) {
  let caps;
  try {
    caps = JSON.parse(fs.readFileSync(path.join(soulsDir, soulId, 'capabilities.json'), 'utf8'));
  } catch (err) {
    return { error: err.code === 'ENOENT' ? `soul ${soulId} not found` : `soul ${soulId} capabilities.json unreadable: ${err.message}` };
  }
  const memory = caps?.permissions?.memory;
  if (!memory || typeof memory !== 'object') return { error: `soul ${soulId} declares no permissions.memory` };
  return { memory };
}

function soulIds(soulsDir) {
  try {
    return fs.readdirSync(soulsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(soulsDir, d.name, 'capabilities.json')))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * @returns {{ granted: boolean, reason: string }}
 */
export function checkSoulMemoryAccess({ soulId, category, action = 'read', soulsDir = DEFAULT_SOULS_DIR }) {
  const deny = (reason) => ({ granted: false, reason });
  if (typeof soulId !== 'string' || !SAFE_ID.test(soulId)) return deny('invalid soul id');
  if (action !== 'read' && action !== 'write') return deny(`unknown action ${action}`);
  const { memory, error } = memoryPermissions(soulId, soulsDir);
  if (error) return deny(error);

  const priv = Array.isArray(memory.private) ? memory.private : [];
  if (category === 'shared' || category === 'handoffs') {
    return allows(memory[category], action)
      ? { granted: true, reason: `${category}: ${memory[category]}` }
      : deny(`${soulId} may not ${action} ${category}/ (declared: ${memory[category] ?? 'none'})`);
  }
  if (typeof category === 'string' && category.startsWith('private/')) {
    const owner = category.slice('private/'.length);
    if (!SAFE_ID.test(owner)) return deny(`invalid category ${category}`);
    return priv.includes(owner)
      ? { granted: true, reason: `private: ${owner}` }
      : deny(`${soulId} may not access private/${owner}`);
  }
  if (category === 'vault') {
    const missing = [
      ...['shared', 'handoffs'].filter((c) => memory[c] !== 'readwrite'),
      ...soulIds(soulsDir).filter((id) => !priv.includes(id)).map((id) => `private/${id}`),
    ];
    return missing.length
      ? deny(`${soulId} may not use the whole vault (no readwrite on ${missing.join(', ')})`)
      : { granted: true, reason: 'vault: every category' };
  }
  return deny(`unknown category ${category}`);
}
