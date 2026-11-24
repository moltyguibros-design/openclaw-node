'use strict';

// The JS side of scripts/install/root-guard.sh, for cli.js and openclaw-node-init.js:
// the same check and the same refusal text.

const fs = require('fs');
const os = require('os');

function isDefaultOpenclawRoot(root, home = os.homedir()) {
  if (!root) return true;
  const want = `${home.replace(/\/$/, '')}/.openclaw`;
  const got = root.replace(/(?<=.)\/+$/, '');
  if (got === want) return true;
  try {
    return fs.statSync(got).isDirectory() && fs.realpathSync(got) === fs.realpathSync(want);
  } catch {
    return false;
  }
}

/** The refusal to print for OPENCLAW_ROOT, or null when it names ~/.openclaw. */
function customRootRefusal(root, home = os.homedir()) {
  if (isDefaultOpenclawRoot(root, home)) return null;
  return [
    `OPENCLAW_ROOT=${root}: a custom install root is not supported. OpenClaw installs only to ${home.replace(/\/$/, '')}/.openclaw.`,
    'Its services (the NATS clients, the memory daemon, the mesh agent, the gateway plugin) would still read ~/.openclaw, so a node installed anywhere else would be half-configured.',
    'Nothing was written. Run "unset OPENCLAW_ROOT", then run this again.',
    "For a second node on one machine, the repo's bin/spawn-node.mjs --id <name> creates ~/.openclaw-<name> and prints the OPENCLAW_HOME=... commands that run its memory daemon and consolidation.",
  ].join('\n');
}

module.exports = { isDefaultOpenclawRoot, customRootRefusal };
