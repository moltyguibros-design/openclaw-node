#!/usr/bin/env node

/**
 * openclaw-node CLI — entry point for `npx openclaw-node-harness`
 *
 * Routes to the appropriate installer:
 *   npx openclaw-node-harness              → full install (install.sh)
 *   npx openclaw-node-harness --update     → update existing install (install.sh --update)
 *   npx openclaw-node-harness --mesh-only  → mesh join only (openclaw-node-init.js)
 *
 * The full install deploys everything: identity, skills, souls, MC, services, rules.
 * --mesh-only is for worker nodes that just need the agent + NATS connection.
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PKG_ROOT = __dirname;
const INSTALL_SCRIPT = path.join(PKG_ROOT, 'install.sh');
const MESH_INIT_SCRIPT = path.join(PKG_ROOT, 'bin', 'openclaw-node-init.js');

const args = process.argv.slice(2);
const meshOnly = args.includes('--mesh-only');

// npx runs the package from its cache (~/.npm/_npx/<hash>/node_modules/<pkg>),
// which npm clears or replaces at will, and install.sh renders every mesh unit's
// ExecStart/WorkingDirectory from the directory it runs in. A full install runs
// from a stable per-version copy instead.
function stableInstallRoot(dryRun) {
  if (!PKG_ROOT.split(path.sep).includes('_npx')) return PKG_ROOT;
  const { version } = require(path.join(PKG_ROOT, 'package.json'));
  const dest = path.join(process.env.OPENCLAW_ROOT || path.join(os.homedir(), '.openclaw'), 'harness', version);
  if (dryRun) {
    console.log(`[dry-run] would copy ${PKG_ROOT} to ${dest} and install from there`);
    return PKG_ROOT;
  }
  if (!fs.existsSync(path.join(dest, 'install.sh'))) {
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    // npx hoists dependencies out of the package dir; install.sh installs them in the copy.
    const skip = path.join(PKG_ROOT, 'node_modules');
    fs.cpSync(PKG_ROOT, tmp, { recursive: true, filter: (src) => src !== skip });
    fs.renameSync(tmp, dest);
  }
  console.log(`Installing from ${dest} (stable copy of the npx package)`);
  return dest;
}

function compareVersions(a, b) {
  const [, ma, pa = ''] = a.match(/^(\d+\.\d+\.\d+)(?:-(.+))?$/);
  const [, mb, pb = ''] = b.match(/^(\d+\.\d+\.\d+)(?:-(.+))?$/);
  const core = ma.localeCompare(mb, 'en', { numeric: true });
  if (core || pa === pb) return core;
  if (!pa || !pb) return pa ? -1 : 1;
  return pa.localeCompare(pb, 'en', { numeric: true });
}

// Each copy is about 0.5 GB. install.sh has just moved the workspace and mesh-home
// dependency links onto `current`, so keep it and the newest other copy (a rollback
// target) and remove the rest, except a copy a rendered service unit still runs from.
function pruneHarnessCopies(current) {
  const harness = path.dirname(current);
  const unitDirs = [path.join(os.homedir(), 'Library', 'LaunchAgents'), path.join(os.homedir(), '.config', 'systemd', 'user')];
  const units = unitDirs.filter((dir) => fs.existsSync(dir))
    .flatMap((dir) => fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => fs.readFileSync(path.join(dir, e.name), 'utf8')));
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const others = fs.readdirSync(harness)
    .filter((v) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v) && path.join(harness, v) !== current)
    .sort(compareVersions);
  others.pop();
  for (const v of others) {
    const dir = path.join(harness, v);
    const inUse = new RegExp(`${escape(dir)}(?![\\w.+-])`);
    if (units.some((text) => inUse.test(text))) {
      console.log(`Keeping old harness copy ${dir}: a service unit still runs from it`);
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Removed old harness copy ${dir}`);
  }
}

// spawnSync reports a signal-killed or never-spawned child as status null.
function exitWith(result) {
  if (result.error) {
    console.error('ERROR:', result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (meshOnly) {
  // Mesh-only join — lightweight, no full install
  if (!fs.existsSync(MESH_INIT_SCRIPT)) {
    console.error('ERROR: bin/openclaw-node-init.js not found at', MESH_INIT_SCRIPT);
    process.exit(1);
  }
  const filteredArgs = args.filter(a => a !== '--mesh-only');
  const result = spawnSync(process.execPath, [MESH_INIT_SCRIPT, ...filteredArgs], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  exitWith(result);
} else {
  // Full install or update — runs install.sh
  if (!fs.existsSync(INSTALL_SCRIPT)) {
    console.error('ERROR: install.sh not found at', INSTALL_SCRIPT);
    console.error('Package may be corrupted. Reinstall with: npx openclaw-node-harness@latest');
    process.exit(1);
  }

  const dryRun = args.includes('--dry-run');
  let root;
  try {
    root = stableInstallRoot(dryRun);
  } catch (err) {
    console.error('ERROR: could not copy the package out of the npx cache:', err.message);
    process.exit(1);
  }

  // Forward args (--update, --dry-run, --enable-services, etc.). install.sh runs
  // with cwd=root, so a relative --project is resolved against the caller's
  // cwd here.
  const forwarded = args.map((a) => (a.startsWith('--project=')
    ? `--project=${path.resolve(a.slice('--project='.length))}`
    : a));
  const result = spawnSync('bash', [path.join(root, 'install.sh'), ...forwarded], {
    stdio: 'inherit',
    cwd: root,
  });
  const installed = !result.error && result.status === 0 && !dryRun && !args.some((a) => a === '--help' || a === '-h');
  if (installed && root !== PKG_ROOT) {
    try {
      pruneHarnessCopies(root);
    } catch (err) {
      console.error('WARN: could not remove old harness copies:', err.message);
    }
  }
  exitWith(result);
}
