/**
 * node-aliases.js — `--node <name>` resolution shared by the mesh CLIs.
 *
 * A name is an exact node id (as lib/node-id.js derives it and the deploy
 * listener and health publisher register it), "self"/"local", or an alias from
 * ~/.openclaw/mesh-aliases.json (openclaw-node-init writes it from
 * MESH_NODE_HEALTH) or the legacy defaults below.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// The two original VMs. The mac id is what lib/node-id.js derives from its
// hostname (MoltyMacs-Virtual-Machine.local), not the old dash-substituted form.
const LEGACY_ALIASES = {
  ubuntu: 'calos-vmware-virtual-platform',
  linux: 'calos-vmware-virtual-platform',
  calos: 'calos-vmware-virtual-platform',
  mac: 'moltymacs-virtual-machine',
  macos: 'moltymacs-virtual-machine',
  moltymac: 'moltymacs-virtual-machine',
};

function loadNodeAliases(home = os.homedir()) {
  const aliasPath = path.join(home, '.openclaw', 'mesh-aliases.json');
  try {
    if (fs.existsSync(aliasPath)) {
      return { ...LEGACY_ALIASES, ...JSON.parse(fs.readFileSync(aliasPath, 'utf8')) };
    }
  } catch (err) { console.warn(`[mesh] load node aliases: ${err.message}`); }
  return { ...LEGACY_ALIASES };
}

function resolveNodeName(name, { localId, aliases }) {
  const lower = String(name || '').toLowerCase();
  if (!lower || lower === 'self' || lower === 'local') return localId;
  return aliases[lower] || name;
}

/**
 * Split `--node` names into "this node" and remote ids. Remote ids still have
 * to be checked against the fleet registry (unknownNodes) before anything runs.
 */
function planNodeTargets(names, { localId, aliases }) {
  const ids = [...new Set(names.map(n => resolveNodeName(n, { localId, aliases })))];
  return { deployLocal: ids.includes(localId), remoteIds: ids.filter(id => id !== localId) };
}

function unknownNodes(ids, discovered) {
  const known = new Set(discovered.map(n => n.nodeId));
  return ids.filter(id => !known.has(id));
}

module.exports = { LEGACY_ALIASES, loadNodeAliases, resolveNodeName, planNodeTargets, unknownNodes };
