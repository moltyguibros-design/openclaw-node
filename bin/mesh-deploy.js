#!/usr/bin/env node

/**
 * mesh-deploy.js v2 — Full-stack OpenClaw deployment across all nodes.
 *
 * Covers the repo-sourced runtime: the repo node_modules and event-schemas
 * dist, mesh daemons and CLI, shared libs, Mission Control, memory daemon,
 * workspace scripts, souls, skills, boot compiler and manifest, workspace docs,
 * harness rules, config templates, lane watchdog, log rotation and the Discord
 * tool. The npm-sourced openclaw CLI and companion-bridge deploy only when
 * named. Service units change only through install.sh.
 *
 * ARCHITECTURE:
 *   Each deployable component is defined in the MANIFEST with:
 *   - id:          unique name
 *   - source:      where the canonical files live (repo path or npm package)
 *   - targets:     where files get installed on each node
 *   - detect:      how to tell if something changed
 *   - install:     how to deploy the change
 *   - restart:     which services to bounce
 *   - validate:    how to confirm the deploy worked
 *   - risk:        "safe" (auto-deploy) | "careful" (warn)
 *
 *   Every mode runs one function, deploy(fromSha, toSha): check out toSha, apply
 *   `git diff --name-status fromSha toSha` (deletions and renames included) to
 *   the affected components, then restart each affected service once. fromSha
 *   defaults to the sha this node last deployed in full (deploy state), not
 *   HEAD: the tree moves without a deploy (the lead's repo is a working
 *   checkout), and a HEAD-based diff is empty. The normal flow deploys, and
 *   triggers the fleet with, origin's tip of the deploy branch.
 *
 * USAGE (run as node bin/mesh-deploy.js; bin/mesh.js `mesh deploy` only publishes a fleet trigger and takes --force/--component/--node):
 *   mesh deploy                       — deploy everything that changed
 *   mesh deploy --dry-run               — preview what would happen
 *   mesh deploy --component mc          — reinstall only Mission Control (all its files)
 *   mesh deploy --component all         — reinstall everything (even unchanged)
 *   mesh deploy --force                 — reinstall every repo-sourced component, changed or not
 *   mesh deploy --local                 — this node only
 *   mesh deploy --local --to <sha> [--from <sha>]
 *                                       — pinned: no fetch; check out <sha> and apply the
 *                                         diff from <from> (default: last deployed sha)
 *   mesh deploy --node <id>             — only that node (repeatable): an id from
 *                                         MESH_NODES/MESH_NODE_HEALTH, "self", or an alias
 *                                         (~/.openclaw/mesh-aliases.json; legacy: ubuntu,
 *                                         linux, calos, mac, macos, moltymac); unknown ids
 *                                         are refused
 *   mesh deploy --rollback              — revert the last deploy (one that failed partway
 *                                         on this node first: back to the sha before it);
 *                                         refused below the memory store's schema unless
 *                                         --force
 *   mesh deploy --status                — show what's deployed vs what's in git
 *
 * ENVIRONMENT:
 *   OPENCLAW_DEPLOY_BRANCH   — git branch (default: main)
 *   OPENCLAW_REPO_DIR        — repo location (default: ~/openclaw)
 *   OPENCLAW_NATS            — NATS server URL (from env or openclaw.env)
 *   OPENCLAW_CLI_VERSION     — exact openclaw version `--component openclaw` installs
 *                              (required; no deploy updates the CLI implicitly)
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTracer } = require('../lib/tracer');
const { resolveNodeId } = require('../lib/node-id');
const { loadNodeAliases, planNodeTargets, unknownNodes } = require('../lib/node-aliases');
const tracer = createTracer('mesh-deploy');

// ── Constants ────────────────────────────────────────────────────────────

const IS_MAC = os.platform() === 'darwin';
const HOME = os.homedir();
const DEPLOY_BRANCH = process.env.OPENCLAW_DEPLOY_BRANCH || 'main';
if (!/^[a-zA-Z0-9._\/-]+$/.test(DEPLOY_BRANCH)) {
  console.error(`Invalid DEPLOY_BRANCH: ${DEPLOY_BRANCH}`);
  process.exit(1);
}
const REPO_DIR = process.env.OPENCLAW_REPO_DIR || path.join(HOME, 'openclaw');

// KNOWN ISSUE: Two-directory problem
// ~/openclaw-node is the git repo (source of truth). mesh-deploy pulls into it,
// then copies files to ~/openclaw (the runtime location). These can drift if
// files are edited directly in ~/openclaw without back-porting to the repo.
// Resolution path: unify to a single directory. Either symlink ~/openclaw →
// ~/openclaw-node, or change REPO_DIR default + DIRS to point at the same tree.
// Until then, mesh-deploy.js is the only sanctioned way to propagate changes.

// The node's workspace as the installer set it (its units pass OPENCLAW_WORKSPACE).
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(HOME, '.openclaw', 'workspace');

// Standard directory layout
const DIRS = {
  OPENCLAW_HOME:    path.join(HOME, '.openclaw'),
  WORKSPACE,
  WORKSPACE_BIN:    path.join(WORKSPACE, 'bin'),
  WORKSPACE_LIB:    path.join(WORKSPACE, 'lib'),
  CLI_BIN:          path.join(HOME, 'openclaw', 'bin'),
  CLI_LIB:          path.join(HOME, 'openclaw', 'lib'),
  MC_PROJECT:       path.join(WORKSPACE, 'projects', 'mission-control'),
  SKILLS:           path.join(WORKSPACE, 'skills'),
  MANAGED_SKILLS:   path.join(HOME, '.openclaw', 'skills'),
  SOULS:            path.join(HOME, '.openclaw', 'souls'),
  CONFIG:           path.join(HOME, '.openclaw', 'config'),
  BOOT:             path.join(WORKSPACE, '.boot'),
  BOOT_SRC:         path.join(WORKSPACE, 'bin'),  // compile-boot lives here
  SERVICES_MAC:     path.join(HOME, 'Library', 'LaunchAgents'),
  COMPANION:        path.join(HOME, 'companion-adapter'),
  DEPLOY_STATE:     path.join(HOME, '.openclaw', '.deploy-state.json'),
};

// Node role — determines which components deploy here. Resolved when a deploy
// plans its components; an unset or unknown role refuses there.
let NODE_ROLE = null;
function nodeRole() {
  return (NODE_ROLE ??= require('../lib/mesh-roles').requireNodeRole({ envFile: path.join(HOME, '.openclaw', 'openclaw.env') }));
}

// ── Console helpers ──────────────────────────────────────────────────────

const C = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
};

function ok(msg)     { console.log(`  ${C.green('[OK]')} ${msg}`); }
function warn(msg)   { console.log(`  ${C.yellow('[WARN]')} ${msg}`); }
function fail(msg)   { console.log(`  ${C.red('[FAIL]')} ${msg}`); }
function info(msg)   { console.log(`  ${C.cyan('-->>')} ${msg}`); }
function skip(msg)   { console.log(`  ${C.dim('[SKIP]')} ${msg}`); }
function header(msg) { console.log(`\n${C.bold(`═══ ${msg} ═══`)}\n`); }

// ── Shell helpers ────────────────────────────────────────────────────────

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: opts.timeout || 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      ...opts,
    }).trim();
  } catch (err) {
    if (opts.ignoreError) return err.stdout?.trim() || '';
    throw err;
  }
}

// Git takes shas and paths as argv, never through a shell.
function git(repoDir, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoDir, encoding, timeout: 120000, maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitLine(repoDir, args) {
  return git(repoDir, args).trim();
}

// npm builds native modules (better-sqlite3) for the node it runs under, so the
// install scripts run with this deploy's node leading PATH. Under the deploy
// listener that is the units' NODE_BIN, the node every daemon runs.
const NODE_BIN_DIR = path.dirname(process.execPath);

/** Run one of the checkout's install scripts, its output streamed into the deploy's. */
function runRepoScript(repoDir, script, args, timeout) {
  info(`Running ${script}...`);
  execFileSync('bash', [path.join(repoDir, script), ...args], {
    cwd: repoDir, timeout, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PATH: `${NODE_BIN_DIR}${path.delimiter}${process.env.PATH}` },
  });
  ok(`${script} done`);
}

function resolveCommit(repoDir, rev) {
  if (!rev || rev.startsWith('-')) return null;
  try { return gitLine(repoDir, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]); } catch { return null; }
}

function isAncestor(repoDir, ancestor, descendant) {
  try { git(repoDir, ['merge-base', '--is-ancestor', ancestor, descendant]); return true; } catch { return false; }
}

function currentBranch(repoDir) {
  try { return gitLine(repoDir, ['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { return null; }
}

/**
 * Refuse a checkout whose tracked files differ from its commit, staged or not.
 * The mesh daemons run this checkout's own files (their units exec
 * ${OPENCLAW_REPO_DIR}/bin/...), installFiles copies from it, and a checkout
 * carries such an edit onto the next commit — so the edit would go live and be
 * reported as the sha. Installing from `git show` could not stop the daemons
 * running it, so the deploy refuses. Untracked files stay out: nothing installs
 * them. So do mode-only changes (the installer's `chmod +x bin/*.sh` makes them
 * where the checkout is the mesh home): no runtime copy takes git's mode.
 */
function assertCommitted(repoDir) {
  const dirty = git(repoDir, ['-c', 'core.fileMode=false', 'status', '--porcelain', '--untracked-files=no'])
    .split('\n').filter(Boolean);
  if (dirty.length === 0) return;
  const shown = dirty.slice(0, 5).map(l => l.trim()).join(', ') + (dirty.length > 5 ? `, +${dirty.length - 5} more` : '');
  throw new Error(`tracked files in ${repoDir} differ from the commit (${shown}) — ` +
    'a deploy installs exactly the commit: commit, stash or discard them first');
}

/**
 * Render a config template the way install.sh does (scripts/install/config.sh
 * generate_config): openclaw.env values over the process environment,
 * OPENCLAW_WORKSPACE forced to the workspace (config.sh exports it after
 * reading the env file), and every ${VAR} replaced — an unset one with
 * nothing, as envsubst does. The old regen only substituted keys present in
 * openclaw.env, which left a literal ${OPENCLAW_WORKSPACE} in openclaw.json.
 */
function renderConfigTemplate(template, envText) {
  const vars = { ...process.env };
  for (const line of envText.split('\n')) {
    if (/^\s*(#|$)/.test(line) || !line.includes('=')) continue;
    const key = line.slice(0, line.indexOf('=')).trim();
    // Same trim + one surrounding quote pair as scripts/install/config.sh.
    const value = line.slice(line.indexOf('=') + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) vars[key] = value;
  }
  vars.OPENCLAW_WORKSPACE = DIRS.WORKSPACE;
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => vars[name] ?? '');
}

// The deploy listener runs bin/mesh-deploy-listener.js and ../lib from the
// checkout. A component with restartsListener restarts it — but never in-band
// from a pinned deploy (`--to`): that is the listener's own child, and a
// restart of its unit would kill the deploy mid-run. A pinned deploy reports
// it in DEPLOY_RESULT.deferredRestart, and the listener schedules its own
// delayed restart once the result is written.
// The file mesh-agent loads its harness rules from (bin/mesh-agent.js HARNESS_PATH).
const HARNESS_RULES_PATH = process.env.OPENCLAW_HARNESS_RULES || path.join(DIRS.OPENCLAW_HOME, 'harness-rules.json');

const LISTENER_SERVICE = IS_MAC ? 'ai.openclaw.mesh-deploy-listener' : 'openclaw-mesh-deploy-listener';

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT MANIFEST — every deployable piece of OpenClaw
// ═══════════════════════════════════════════════════════════════════════════

const MANIFEST = [

  // ── DEPENDENCIES ────────────────────────────────────────────────────────

  {
    id: 'deps',
    name: 'Dependencies',
    description: 'Repo node_modules and the event-schemas dist, refreshed when package.json, package-lock.json or packages/ change',
    risk: 'careful',
    repoPaths: ['package.json', 'package-lock.json', 'packages/'],
    // Nothing is copied: install.sh's own step installs in the checkout (npm ci
    // when package.json/package-lock.json differ from what node_modules came from),
    // rebuilds a stale dist, and refreshes the workspace packages/ and its links.
    targets: [],
    // Every daemon that loads the repo's node_modules or the event-schemas dist.
    servicesMac: ['ai.openclaw.mesh-task-daemon', 'ai.openclaw.mesh-bridge',
                  'ai.openclaw.mesh-agent', 'ai.openclaw.mesh-health-publisher',
                  'ai.openclaw.mesh-tool-discord', 'ai.openclaw.memory-daemon',
                  'ai.openclaw.node-watch', 'ai.openclaw.health-watch'],
    servicesLinux: ['openclaw-mesh-task-daemon', 'openclaw-mesh-bridge', 'openclaw-mesh-agent',
                    'openclaw-mesh-health-publisher', 'openclaw-mesh-tool-discord',
                    'openclaw-memory-daemon', 'openclaw-node-watch', 'openclaw-health-watch'],
    restartsListener: true,
    postInstall: (changedFiles, changes, { repoDir }) =>
      runRepoScript(repoDir, 'scripts/install/deps.sh', [repoDir, DIRS.WORKSPACE], 900000),
  },

  // ── MESH INFRASTRUCTURE ─────────────────────────────────────────────────

  {
    id: 'mesh-daemons',
    name: 'Mesh Daemons',
    description: 'Task daemon, bridge, agent, health publisher',
    risk: 'safe',
    repoPaths: ['bin/mesh-task-daemon.js', 'bin/mesh-bridge.js', 'bin/mesh-agent.js',
                'bin/mesh-health-publisher.js', 'bin/mesh-deploy-listener.js'],
    targets: [DIRS.CLI_BIN],
    // Lead runs all 4; worker runs only agent + health publisher.
    // Service names differ: macOS=launchd labels, Linux=systemd unit names
    // (services/service-manifest.json). A service not installed on this node
    // is skipped at restart time, so one list serves both roles.
    servicesMac: ['ai.openclaw.mesh-task-daemon', 'ai.openclaw.mesh-bridge',
                  'ai.openclaw.mesh-agent', 'ai.openclaw.mesh-health-publisher'],
    servicesLinux: ['openclaw-mesh-task-daemon', 'openclaw-mesh-bridge',
                    'openclaw-mesh-agent', 'openclaw-mesh-health-publisher'],
    restartsListener: true,
    validate: () => {
      // The Linux agent unit is started by hand (autostart false); the health
      // publisher runs on every role.
      if (IS_MAC) {
        return exec('launchctl list ai.openclaw.mesh-task-daemon 2>/dev/null | grep PID', { ignoreError: true }).length > 0;
      }
      return exec('systemctl --user is-active openclaw-mesh-health-publisher 2>/dev/null', { ignoreError: true }) === 'active';
    },
  },

  {
    id: 'mesh-cli',
    name: 'Mesh CLI Tools',
    description: 'mesh command, health check, repair, deploy, fleet-deploy',
    risk: 'safe',
    repoPaths: ['bin/mesh.js', 'bin/mesh-deploy.js', 'bin/fleet-deploy.js'],
    targets: [DIRS.CLI_BIN],
    servicesMac: [],
    servicesLinux: [],
  },

  {
    id: 'shared-lib',
    name: 'Shared Libraries',
    description: 'nats-resolve.js, agent-activity.js, kanban-io.js, mesh-registry.js, mesh-tasks.js',
    risk: 'safe',
    repoPaths: ['lib/'],
    // The workspace daemons (memory daemon, node-watch, health-watch) import their own
    // ../lib under the workspace, which install.sh copies from lib/ too.
    targets: [DIRS.CLI_LIB, DIRS.WORKSPACE_LIB],
    guardedTargets: [DIRS.WORKSPACE_LIB],
    // Every daemon that loads one of those lib trees at runtime.
    servicesMac: ['ai.openclaw.mesh-task-daemon', 'ai.openclaw.mesh-bridge',
                  'ai.openclaw.mesh-agent', 'ai.openclaw.mesh-health-publisher',
                  'ai.openclaw.mesh-tool-discord', 'ai.openclaw.memory-daemon',
                  'ai.openclaw.node-watch', 'ai.openclaw.health-watch'],
    servicesLinux: ['openclaw-mesh-task-daemon', 'openclaw-mesh-bridge', 'openclaw-mesh-agent',
                    'openclaw-mesh-health-publisher', 'openclaw-mesh-tool-discord',
                    'openclaw-memory-daemon', 'openclaw-node-watch', 'openclaw-health-watch'],
    restartsListener: true,
  },

  // ── MISSION CONTROL ─────────────────────────────────────────────────────

  {
    id: 'mc',
    name: 'Mission Control',
    description: 'Next.js dashboard — kanban, memory, souls, graph, calendar',
    risk: 'safe',
    repoPaths: ['mission-control/'],
    targets: [DIRS.MC_PROJECT],
    servicesMac: ['ai.openclaw.mission-control'],
    servicesLinux: ['openclaw-mission-control'],
    // The service runs `next start`, which serves the prebuilt .next — a restart
    // without a rebuild keeps serving the old UI. install.sh's own steps: npm@10 ci
    // and the better-sqlite3 rebuild under this deploy's node when the lockfile or
    // node changed, and a build that puts the previous one back when it fails.
    postInstall: (changedFiles, changes, { repoDir }) =>
      runRepoScript(repoDir, 'scripts/install/mc-build.sh', [DIRS.MC_PROJECT, NODE_BIN_DIR], 1200000),
    validate: () => {
      const dbPath = path.join(DIRS.MC_PROJECT, 'data', 'mission-control.db');
      return fs.existsSync(dbPath);
    },
    notes: 'DB migrations run automatically on MC startup via db/index.ts runMigrations(). ' +
           'New columns (ALTER TABLE) are idempotent. Schema-breaking changes need a ' +
           'migration plan before deploy.',
  },

  // ── MEMORY SYSTEM ───────────────────────────────────────────────────────

  {
    id: 'memory-daemon',
    name: 'Memory Daemon',
    description: 'Session recap, ClawVault maintenance, daily log generation, Obsidian sync',
    risk: 'safe',
    repoPaths: ['workspace-bin/memory-daemon.mjs', 'workspace-bin/memory-maintenance.mjs'],
    targets: [DIRS.WORKSPACE_BIN],
    servicesMac: ['ai.openclaw.memory-daemon'],
    servicesLinux: ['openclaw-memory-daemon'],
  },

  {
    id: 'workspace-bin',
    name: 'Workspace Scripts',
    description: 'workspace-bin/ and the repo bin/ files install.sh copies into the workspace bin',
    risk: 'safe',
    // The set scripts/install/workspace.sh Step 3 installs.
    repoPaths: ['workspace-bin/', ...['node-watch.mjs', 'node-acceptance.mjs', 'openclaw-notify.mjs',
      'obsidian-graph-cache.mjs', 'observer.mjs', 'consolidation-scheduler.mjs', 'consolidate.mjs',
      'hyperagent.mjs', 'embed-probe.mjs', 'scheduler-heartbeat.mjs', 'memory-subscriber.mjs',
      'memory-promoter.mjs', 'health-watch.mjs', 'nats-legacy-lock.py'].map(f => `bin/${f}`)],
    exclude: [
      // Owned by 'memory-daemon' and 'boot'.
      'workspace-bin/memory-daemon.mjs', 'workspace-bin/memory-maintenance.mjs', 'workspace-bin/compile-boot',
      'workspace-bin/routing-eval-tests.json',
      // The timer cohort and its sources keep their reviewed handoff
      // (workspace-bin/timer-hold-control.py TIMERS): a deploy never rewrites them.
      'workspace-bin/archive-transcripts.sh', 'bin/scheduler-heartbeat.mjs',
      'bin/consolidation-scheduler.mjs', 'bin/consolidate.mjs', 'bin/observer.mjs',
    ],
    targets: [DIRS.WORKSPACE_BIN],
    guardedTargets: [DIRS.WORKSPACE_BIN],
    servicesMac: ['ai.openclaw.memory-daemon', 'ai.openclaw.node-watch', 'ai.openclaw.health-watch'],
    servicesLinux: ['openclaw-memory-daemon', 'openclaw-node-watch', 'openclaw-health-watch'],
  },

  // ── SOUL SYSTEM ─────────────────────────────────────────────────────────

  {
    id: 'souls',
    name: 'Soul Definitions',
    description: 'Daedalus and specialist soul files, trust registry, evolution config',
    risk: 'careful',
    repoPaths: ['souls/'],
    targets: [DIRS.SOULS],
    servicesMac: [],
    servicesLinux: [],
    // A soul's evolved genes and event log are learned on the node; the repo
    // copy only seeds a soul that has none. The old backup-then-overwrite reset
    // them to the seed on every --force and kept one .pre-deploy copy.
    seedOnly: /^souls\/[^/]+\/evolution\/(genes\.json|events\.jsonl)$/,
    notes: 'Evolution genes (genes.json) and event logs (events.jsonl) contain ' +
           'learned behavior: seeded where missing, never overwritten.',
  },

  // ── SKILLS ──────────────────────────────────────────────────────────────

  {
    id: 'skills',
    name: 'Skill Library',
    description: 'Skill definitions for AI agent capabilities',
    risk: 'safe',
    repoPaths: ['skills/'],
    // Quarantined skills must never reach a node (skills/_quarantine/README.md):
    // neither installed nor, through the diff, removed. skills/dist/ (build
    // bundles, gitignored) and the top-level skills/scripts/ are not skills,
    // matching the installer's rsync excludes.
    exclude: ['skills/_quarantine/', 'skills/dist/', 'skills/scripts/'],
    targets: [DIRS.SKILLS],
    servicesMac: [],
    servicesLinux: [],
    postInstall: () => retireManagedSkillCopies(),
  },

  // ── BOOT SYSTEM ─────────────────────────────────────────────────────────

  {
    id: 'boot',
    name: 'Boot Compiler',
    description: 'Profile-aware boot artifact generation (Python script)',
    risk: 'safe',
    repoPaths: ['workspace-bin/compile-boot'],
    targets: [DIRS.BOOT_SRC],  // = WORKSPACE_BIN (compile-boot lives there)
    servicesMac: [],
    servicesLinux: [],
    postInstall: () => recompileBoot(),
  },

  {
    id: 'boot-manifest',
    name: 'Boot Manifest',
    description: 'Profile definitions compile-boot reads (.boot/manifest.yaml)',
    risk: 'safe',
    repoPaths: ['boot/manifest.yaml'],
    targets: [DIRS.BOOT],
    servicesMac: [],
    servicesLinux: [],
    postInstall: () => recompileBoot(),
  },

  // ── WORKSPACE ROOT DOCUMENTS ────────────────────────────────────────────

  {
    id: 'workspace-docs',
    name: 'Workspace Root Documents',
    description: 'Agent docs from identity/: CLAUDE, SOUL, PRINCIPLES, AGENTS, DELEGATION, HEARTBEAT, MEMORY_SPEC, TOOLS',
    risk: 'careful',
    // The same source and file list as install.sh (scripts/install/workspace.sh
    // Step 4), so an installed and a deployed node carry the same docs.
    repoPaths: ['CLAUDE.md', 'SOUL.md', 'PRINCIPLES.md', 'AGENTS.md', 'DELEGATION.md',
                'HEARTBEAT.md', 'MEMORY_SPEC.md', 'TOOLS.md'].map(f => `identity/${f}`),
    targets: [DIRS.WORKSPACE],
    servicesMac: [],
    servicesLinux: [],
    // Per file, as install.sh does: a doc that differs on this node keeps its
    // copy (the repo version is saved beside it as .repo); the others install.
    // The old all-or-nothing veto left every doc behind for one edited one.
    preInstall: (files, { repoDir, toSha, dryRun }) => {
      const kept = files.filter(f => {
        const basename = path.basename(f);
        const targetPath = path.join(DIRS.WORKSPACE, basename);
        if (!fs.existsSync(targetPath)) return false;
        // A dry run has not checked out toSha: compare against it and write nothing.
        if (dryRun) {
          if (fs.readFileSync(targetPath).equals(git(repoDir, ['show', `${toSha}:${f}`], 'buffer'))) return false;
          warn(`${basename} differs from repo version — a deploy would save it as ${basename}.repo and keep this node's copy`);
          return true;
        }
        const srcPath = path.join(repoDir, f);
        const diff = exec(`diff "${targetPath}" "${srcPath}" | head -20`, { ignoreError: true });
        if (!diff) return false;
        warn(`${basename} differs from repo version:`);
        console.log(C.dim(diff.split('\n').map(l => `      ${l}`).join('\n')));
        info(`Repo version saved to ${basename}.repo — merge manually if needed`);
        fs.copyFileSync(srcPath, targetPath + '.repo');
        return true;
      });
      // installFiles copies the list this hook was handed.
      for (const f of kept) files.splice(files.indexOf(f), 1);
      if (kept.length > 0 && files.length === 0) return false;
    },
    // The compiled boot profiles are built from AGENTS.md; only where 'boot' runs.
    postInstall: (changedFiles) => {
      const bootFilter = MANIFEST.find(c => c.id === 'boot').nodeFilter;
      if (changedFiles.includes('identity/AGENTS.md') && (bootFilter === 'all' || bootFilter === nodeRole())) recompileBoot();
    },
    notes: 'These files are your agent identity docs. They are NOT auto-overwritten. ' +
           'If the repo has updates, they are saved as .repo files for manual merge.',
  },

  // ── HARNESS RULES ───────────────────────────────────────────────────────

  {
    id: 'harness-rules',
    name: 'Harness Rules',
    description: 'Merges config/harness-rules.json into the copy mesh-agent reads (user edits kept)',
    risk: 'careful',
    repoPaths: ['config/harness-rules.json'],
    // Nothing is copied: the live file is a merge of the repo rules and the
    // node's edits, written by harness-sync (as install.sh does).
    targets: [],
    servicesMac: ['ai.openclaw.mesh-agent'],
    servicesLinux: ['openclaw-mesh-agent'],
    postInstall: (changedFiles, changes, { repoDir }) => {
      const src = path.join(repoDir, 'config', 'harness-rules.json');
      if (!fs.existsSync(src)) return;
      info(`Merging harness rules into ${HARNESS_RULES_PATH}...`);
      const out = execFileSync(process.execPath, [
        path.join(repoDir, 'bin', 'harness-sync.js'), 'apply', '--src', src, '--dst', HARNESS_RULES_PATH,
      ], { cwd: repoDir, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const line of out.trim().split('\n').filter(Boolean)) console.log(`    ${C.dim(line)}`);
      ok('Harness rules merged');
    },
  },

  // ── CONFIG TEMPLATES ────────────────────────────────────────────────────

  {
    id: 'config',
    name: 'Configuration',
    description: 'Daemon configs, transcript configs, sync settings',
    risk: 'careful',
    repoPaths: ['config/'],
    // Owned by 'harness-rules': nothing reads a copy under ~/.openclaw/config.
    exclude: ['config/harness-rules.json'],
    targets: [DIRS.CONFIG],
    servicesMac: [],
    servicesLinux: [],
    postInstall: (changedFiles, changes) => {
      const templatePath = path.join(DIRS.CONFIG, 'openclaw.json.template');
      const envPath = path.join(DIRS.OPENCLAW_HOME, 'openclaw.env');
      const outPath = path.join(DIRS.OPENCLAW_HOME, 'openclaw.json');
      // openclaw.json is the node's live gateway config (channels, tokens, auth
      // profiles); the template only seeds it. Create it when missing; rewrite
      // it only when this diff changed the template itself — never on a same-sha
      // --force/--component reinstall, never for another file under config/.
      const exists = fs.existsSync(outPath);
      const templateChanged = changes.some(c => c.path === 'config/openclaw.json.template' && c.status !== 'D');
      if (exists && !templateChanged) return;
      if (!fs.existsSync(templatePath) || !fs.existsSync(envPath)) return;
      info(`${exists ? 'Regenerating' : 'Generating'} openclaw.json from template + env...`);
      try {
        const rendered = renderConfigTemplate(fs.readFileSync(templatePath, 'utf8'), fs.readFileSync(envPath, 'utf8'));
        if (exists) {
          // Written 0600 from the start: the file carries the node's tokens.
          const backupPath = `${outPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
          fs.writeFileSync(backupPath, fs.readFileSync(outPath), { mode: 0o600, flag: 'wx' });
          info(`Previous openclaw.json kept as ${path.basename(backupPath)}`);
        }
        fs.writeFileSync(outPath, rendered, { mode: 0o600 });
        fs.chmodSync(outPath, 0o600); // an existing file keeps its mode through writeFileSync
        ok(`openclaw.json ${exists ? 'regenerated' : 'generated'}`);
      } catch (err) {
        warn(`Config regen failed: ${err.message}`);
      }
    },
    notes: 'openclaw.env is NEVER deployed — it contains API keys and is per-node.',
  },

  // ── OPENCLAW GATEWAY (npm package) ──────────────────────────────────────

  {
    id: 'openclaw',
    name: 'OpenClaw Gateway',
    description: 'The TUI/gateway — installed globally via npm',
    risk: 'careful',
    repoPaths: [],
    targets: [],
    servicesMac: ['ai.openclaw.gateway'],
    servicesLinux: ['openclaw-gateway'],
    detect: () => {
      try {
        const current = exec('openclaw --version 2>/dev/null', { ignoreError: true });
        const latest = exec('npm view openclaw version 2>/dev/null', { ignoreError: true });
        const installed = current.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/)?.[0] || current;
        if (installed && latest && installed !== latest) {
          return { changed: true, current: installed, latest };
        }
      } catch (err) { console.warn(`[mesh-deploy] detect openclaw version: ${err.message}`); }
      return { changed: false };
    },
    // Deployed only when named (--component openclaw), at an exact version.
    // `npm update -g openclaw` ran implicitly on every fetching deploy and
    // installed whatever the registry served that minute.
    install: (dryRun) => {
      const version = process.env.OPENCLAW_CLI_VERSION || '';
      if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
        throw new Error('--component openclaw installs an exact pinned version: set OPENCLAW_CLI_VERSION=<x.y.z>' +
          (version ? ` (got ${JSON.stringify(version).slice(0, 40)})` : ''));
      }
      // npm creates <prefix>/lib/node_modules on first use: probe the nearest existing ancestor.
      const prefix = exec('npm prefix -g');
      let probe = path.join(prefix, 'lib', 'node_modules');
      while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      let writable = true;
      try { fs.accessSync(probe, fs.constants.W_OK); } catch { writable = false; }
      const hint = `the global npm prefix ${prefix} is not writable by this user — run: sudo npm install -g openclaw@${version}`;
      if (dryRun) {
        if (writable) info(`Would run: npm install -g openclaw@${version}`);
        else warn(`Would refuse: ${hint}`);
        return;
      }
      if (!writable) throw new Error(hint);
      info(`Installing OpenClaw gateway ${version}...`);
      exec(`npm install -g openclaw@${version}`, { timeout: 180000 });
      ok(`OpenClaw ${version} installed`);
    },
  },

  // ── COMPANION BRIDGE ────────────────────────────────────────────────────

  {
    id: 'companion',
    name: 'Companion Bridge',
    description: 'companion-bridge npm package + local adapter.ts patches',
    risk: 'careful',
    repoPaths: [],
    targets: [],
    servicesMac: ['ai.openclaw.gateway'],
    servicesLinux: ['openclaw-gateway'],
    detect: () => {
      try {
        if (fs.existsSync(DIRS.COMPANION)) {
          const status = exec('git status --porcelain', { cwd: DIRS.COMPANION, ignoreError: true });
          if (status) return { changed: true, reason: 'uncommitted local changes' };
        }
        const current = exec('npm ls companion-bridge --json 2>/dev/null', { ignoreError: true });
        const latest = exec('npm view companion-bridge version 2>/dev/null', { ignoreError: true });
        if (current && latest) {
          return { changed: !current.includes(latest), current, latest };
        }
      } catch (err) { console.warn(`[mesh-deploy] detect companion version: ${err.message}`); }
      return { changed: false };
    },
    install: (dryRun) => {
      if (dryRun) {
        info('Would update companion-bridge');
        return;
      }
      if (fs.existsSync(DIRS.COMPANION)) {
        info('Pulling companion-bridge source...');
        exec('git pull origin main', { cwd: DIRS.COMPANION, ignoreError: true });
        exec('npm install && npm run build', { cwd: DIRS.COMPANION, timeout: 120000 });
        ok('companion-bridge rebuilt');
      }
    },
  },

  // ── LANE WATCHDOG ───────────────────────────────────────────────────────

  {
    id: 'lane-watchdog',
    name: 'Lane Watchdog',
    description: 'Kanban lane health monitoring',
    risk: 'safe',
    repoPaths: ['bin/lane-watchdog.js'],
    targets: [DIRS.CLI_BIN],
    servicesMac: ['ai.openclaw.lane-watchdog'],
    servicesLinux: ['openclaw-lane-watchdog'],
  },

  // ── LOG ROTATION ────────────────────────────────────────────────────────

  {
    id: 'log-rotate',
    name: 'Log Rotation',
    description: 'Weekly log file rotation (copytruncate)',
    risk: 'safe',
    repoPaths: ['bin/log-rotate'],
    targets: [DIRS.CLI_BIN],
    servicesMac: ['ai.openclaw.log-rotate'],
    servicesLinux: ['openclaw-log-rotate'],
  },

  // ── DISCORD TOOL ────────────────────────────────────────────────────────

  {
    id: 'mesh-tool-discord',
    name: 'Discord NATS Tool',
    description: 'Discord channel history reader over NATS',
    risk: 'safe',
    repoPaths: ['bin/mesh-tool-discord.js', 'bin/discord-read.js'],
    targets: [DIRS.CLI_BIN],
    servicesMac: ['ai.openclaw.mesh-tool-discord'],
    servicesLinux: ['openclaw-mesh-tool-discord'],
  },
];

// Which role runs each component comes from lib/mesh-roles.js, the list the
// deploy listener filters fleet triggers through and the health record
// advertises: an id here that it lacks (or the reverse) is refused, not skipped.
const { DEPLOY_COMPONENTS } = require('../lib/mesh-roles');
{
  const roles = new Map(DEPLOY_COMPONENTS.map(c => [c.id, c]));
  const unlisted = MANIFEST.filter(c => !roles.has(c.id)).map(c => c.id);
  const unknown = DEPLOY_COMPONENTS.filter(r => !MANIFEST.some(c => c.id === r.id)).map(r => r.id);
  if (unlisted.length || unknown.length) {
    throw new Error('MANIFEST and lib/mesh-roles.js disagree: ' +
      [unlisted.length && `not in mesh-roles: ${unlisted.join(', ')}`,
       unknown.length && `not in MANIFEST: ${unknown.join(', ')}`].filter(Boolean).join('; '));
  }
  for (const comp of MANIFEST) Object.assign(comp, { nodeFilter: roles.get(comp.id).nodeFilter, localOnly: !!roles.get(comp.id).localOnly });
}

// ═══════════════════════════════════════════════════════════════════════════
// DEPLOY ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load deploy state — tracks what was deployed when.
 */
function loadDeployState() {
  try {
    if (fs.existsSync(DIRS.DEPLOY_STATE)) {
      return JSON.parse(fs.readFileSync(DIRS.DEPLOY_STATE, 'utf8'));
    }
  } catch (err) { console.warn(`[mesh-deploy] load deploy state: ${err.message}`); }
  return { lastDeploy: null, lastSha: null, deployedSha: null, components: {} };
}

function saveDeployState(state) {
  const dir = path.dirname(DIRS.DEPLOY_STATE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DIRS.DEPLOY_STATE, JSON.stringify(state, null, 2));
}

/**
 * The sha this node last deployed in full — the base of the next diff. Falls
 * back to HEAD on a node mesh-deploy has not recorded yet.
 */
function deployedBase(repoDir) {
  return resolveCommit(repoDir, loadDeployState().deployedSha) || gitLine(repoDir, ['rev-parse', 'HEAD']);
}

/**
 * mesh-deploy used to ship the skill library to ~/.openclaw/skills, where the
 * workspace copies install.sh wrote take precedence, so those copies never
 * loaded. Move each leftover repo skill the workspace now holds (and the
 * dist/ and scripts/ packaging dirs) into a dated archive; never delete. The
 * mesh skill stays: integrations.sh installs it there for every agent.
 *
 * A skill retired-files.txt lists (quarantined or deleted) is archived from
 * both dirs, as install.sh does: the diff misses it on a node this deploy has
 * not recorded, and archiving only the workspace copy would un-shadow an old
 * managed one.
 */
function retireManagedSkillCopies() {
  const date = new Date().toISOString().slice(0, 10);
  const retired = retiredSkillNames();
  const archiveTo = (src, dst) => {
    if (fs.existsSync(dst)) {
      warn(`  ${src} left in place — ${dst} already exists`);
      return;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    console.log(`  ${C.dim('retire')} ${src} → ${dst}`);
  };
  for (const name of retired) {
    const src = path.join(DIRS.SKILLS, name);
    if (fs.existsSync(src)) archiveTo(src, path.join(DIRS.OPENCLAW_HOME, 'retired', date, 'skills', name));
  }
  if (!fs.existsSync(DIRS.MANAGED_SKILLS)) return;
  const repoSkills = new Set(fs.readdirSync(path.join(REPO_DIR, 'skills')));
  const archive = path.join(DIRS.OPENCLAW_HOME, `skills.retired-${date}`);
  for (const name of fs.readdirSync(DIRS.MANAGED_SKILLS)) {
    if (name === 'mesh') continue;
    if (!retired.includes(name)) {
      if (!repoSkills.has(name)) continue;
      const packaging = name === 'dist' || name === 'scripts';
      if (!packaging && !fs.existsSync(path.join(DIRS.SKILLS, name))) continue;
    }
    archiveTo(path.join(DIRS.MANAGED_SKILLS, name), path.join(archive, name));
  }
}

// Without --all compile-boot prints the main profile to stdout and writes no
// .boot/<profile>.compiled.md; install.sh runs the same command.
function recompileBoot() {
  const compilerPath = path.join(DIRS.BOOT_SRC, 'compile-boot');
  if (!fs.existsSync(compilerPath)) return;
  info('Recompiling boot profiles...');
  try {
    exec(`python3 "${compilerPath}" --all`, { cwd: DIRS.WORKSPACE });
    ok('Boot profiles recompiled');
  } catch (err) {
    warn(`Boot recompile failed: ${err.message}`);
  }
}

// The `skills` names in retired-files.txt, refused like retire_shipped_files
// refuses them so nothing outside the skill dirs and no backup is ever moved.
function retiredSkillNames() {
  return fs.readFileSync(path.join(REPO_DIR, 'scripts', 'install', 'retired-files.txt'), 'utf8')
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(([group, name]) => group === 'skills' && name && !name.includes('/') && !name.startsWith('.') && !name.includes('.bak'))
    .map(([, name]) => name);
}

/**
 * `git diff --name-status` between two commits. --no-renames turns a rename
 * into delete-old + add-new, which is what the runtime needs.
 */
function diffChanges(repoDir, fromSha, toSha) {
  if (fromSha === toSha) return [];
  const parts = git(repoDir, ['diff', '--name-status', '--no-renames', '-z', fromSha, toSha]).split('\0');
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    changes.push({ status: parts[i], path: parts[i + 1] });
  }
  return changes;
}

function listFiles(repoDir, sha, repoPaths) {
  return git(repoDir, ['ls-tree', '-r', '--name-only', '-z', sha, '--', ...repoPaths]).split('\0').filter(Boolean);
}

function ownsPath(comp, file) {
  if ((comp.exclude || []).some(ex => file.startsWith(ex))) return false;
  return comp.repoPaths.some(rp => rp.endsWith('/') ? file.startsWith(rp) : file === rp);
}

// Destination of a repo file under a target: the matching repoPath prefix is stripped.
function targetSubPath(comp, file) {
  for (const rp of comp.repoPaths) {
    if (rp.endsWith('/') && file.startsWith(rp)) return file.slice(rp.length);
    if (file === rp) return path.basename(file);
  }
  return file;
}

/**
 * Which components the changes touch, and with which files. A component named
 * with --component (every component under --force or --component all) is
 * reinstalled in full: all its files at the target sha, changed or not.
 * npm/git-sourced components (no repoPaths) deploy only when named — never
 * implicitly: --force and --component all leave them out too.
 */
function planComponents(changes, { filterIds = [], force = false, listAll }) {
  const named = filterIds.filter(id => id !== 'all');
  const reinstallAll = force || filterIds.includes('all');
  const plans = [];

  for (const comp of MANIFEST) {
    if (comp.nodeFilter !== 'all' && comp.nodeFilter !== nodeRole()) continue;
    if (named.length > 0 && !named.includes(comp.id)) continue;

    if (comp.repoPaths.length === 0) {
      if (named.includes(comp.id)) plans.push({ comp, install: [], remove: [] });
      continue;
    }

    const own = changes.filter(c => ownsPath(comp, c.path));
    const remove = own.filter(c => c.status === 'D').map(c => c.path);
    const install = (reinstallAll || named.includes(comp.id))
      ? listAll(comp.repoPaths).filter(f => ownsPath(comp, f))
      : own.filter(c => c.status !== 'D').map(c => c.path);
    if (install.length > 0 || remove.length > 0) plans.push({ comp, install, remove });
  }
  return plans;
}

/**
 * The targets a component may write. A guarded target (the workspace lib and
 * bin) that is a symlink is never written through: one that resolves to the
 * component's own checkout dir already is the deployed tree and is skipped;
 * any other is refused, since writing through it changes a tree this deploy
 * does not own.
 */
function writableTargets(comp, repoDir) {
  return comp.targets.filter(target => {
    if (!(comp.guardedTargets || []).includes(target)) return true;
    let link;
    try { link = fs.lstatSync(target).isSymbolicLink(); } catch { return true; }
    if (!link) return true;
    const own = comp.repoPaths.length === 1 && comp.repoPaths[0].endsWith('/')
      ? path.join(repoDir, comp.repoPaths[0]) : null;
    if (own && fs.existsSync(own) && fs.realpathSync(target) === fs.realpathSync(own)) {
      skip(`  ${target} links to the checkout — nothing to copy`);
      return false;
    }
    throw new Error(`refusing to write through symlinked ${target} (→ ${fs.realpathSync(target)})`);
  });
}

/**
 * Copy a component's files from the checked-out tree to its targets.
 */
function installFiles(comp, repoDir, files, dryRun) {
  let count = 0;
  for (const target of comp.targets) {
    for (const relFile of files) {
      const srcPath = path.join(repoDir, relFile);
      const dstPath = path.join(target, targetSubPath(comp, relFile));
      if (comp.seedOnly && comp.seedOnly.test(relFile) && fs.existsSync(dstPath)) {
        console.log(`  ${C.dim('keep')} ${dstPath} (learned on this node — the repo copy only seeds)`);
        continue;
      }
      if (dryRun) {
        info(`  ${relFile} → ${dstPath}`);
        count++;
        continue;
      }
      if (!fs.existsSync(srcPath)) {
        warn(`  ${relFile} is missing from the working tree — not installed`);
        continue;
      }
      // Where the repo IS the runtime (bin/ and lib/ under the default
      // ~/openclaw), the checkout already installed the file — and a chmod
      // would dirty the tree and make the next checkout refuse.
      if (fs.existsSync(dstPath) && fs.realpathSync(dstPath) === fs.realpathSync(srcPath)) {
        count++;
        continue;
      }
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      console.log(`  ${C.dim('copy')} ${srcPath} → ${dstPath}`);
      if (relFile.endsWith('.js') || relFile.endsWith('.sh')) fs.chmodSync(dstPath, 0o755);
      count++;
    }
  }
  return count;
}

/**
 * Remove what the diff deleted (or renamed away) from a component's targets —
 * but only copies still identical to what fromSha shipped. A copy edited on
 * this node (learned soul genes, an operator's doc) stays, with a warning.
 */
function removeFiles(comp, repoDir, fromSha, files, dryRun) {
  let count = 0;
  for (const target of comp.targets) {
    for (const relFile of files) {
      const dstPath = path.join(target, targetSubPath(comp, relFile));
      if (!fs.existsSync(dstPath)) continue;
      const shipped = git(repoDir, ['show', `${fromSha}:${relFile}`], 'buffer');
      if (!fs.readFileSync(dstPath).equals(shipped)) {
        warn(`  ${dstPath} left in place — removed from the repo but modified on this node`);
        continue;
      }
      if (dryRun) {
        info(`  remove ${dstPath}`);
        count++;
        continue;
      }
      fs.unlinkSync(dstPath);
      console.log(`  ${C.dim('remove')} ${dstPath}`);
      let dir = path.dirname(dstPath);
      while (dir.startsWith(target + path.sep) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
      }
      count++;
    }
  }
  return count;
}

/**
 * Restart one service if it is running. One not installed on this node (no
 * plist; a unit systemd does not know) is skipped — component service lists
 * span roles. One installed but stopped is left stopped and reported as such:
 * some are off on purpose (openclaw-mesh-agent is autostart:false, the Mac
 * agent RunAtLoad=false and started by hand), and a deploy must not bring a
 * worker online that the operator took offline. A failed restart throws: a
 * deploy whose new code is not running did not succeed, and the listener rolls
 * it back.
 */
function restartService(svc, { probeOnly = false } = {}) {
  try {
    if (IS_MAC) {
      const plistPath = path.join(DIRS.SERVICES_MAC, `${svc}.plist`);
      if (!fs.existsSync(plistPath)) {
        skip(`  ${svc} not installed on this node`);
        return false;
      }
      // kickstart -k restarts a running job in place; unload/load killed a
      // hand-started agent and left it stopped. The state line is the one
      // lib/fed-probes.mjs parseLaunchdPrint reads (ESM, not loadable here);
      // a job that is not loaded fails `print`, so it reads as not running.
      const target = `gui/${process.getuid()}/${svc}`;
      const state = exec(`launchctl print ${target}`, { ignoreError: true }).match(/^\s*state = (.+)$/m)?.[1]?.trim();
      if (state !== 'running') {
        skip(`  ${svc} not running${state === 'not running' ? '' : ` (${state || 'not loaded'})`} — left stopped`);
        return false;
      }
      if (probeOnly) return true;
      exec(`launchctl kickstart -k ${target}`);
    } else {
      const loadState = exec(`systemctl --user show -p LoadState --value ${svc}`);
      if (loadState !== 'loaded') {
        skip(`  ${svc} not installed on this node (${loadState})`);
        return false;
      }
      // `restart` starts an inactive unit. try-restart only restarts a running
      // one, and stays a no-op if it stops between this check and the call.
      const activeState = exec(`systemctl --user is-active ${svc}`, { ignoreError: true });
      if (!['active', 'activating', 'reloading'].includes(activeState)) {
        skip(`  ${svc} not running (${activeState || 'unknown'}) — left stopped`);
        return false;
      }
      if (probeOnly) return true;
      exec(`systemctl --user try-restart ${svc}`);
    }
  } catch (err) {
    fail(`  Restart ${svc} failed`);
    throw new Error(`restart ${svc} failed: ${String(err.stderr || err.message).trim()}`);
  }
  ok(`  Restarted ${svc}`);
  return true;
}

/**
 * Deploy toSha on this node: check it out, apply the fromSha..toSha diff to
 * every affected component, then restart each affected service once — after
 * all files are in place, so no daemon boots new bin/ against old lib/.
 * Throws on any failed step. Never fetches: the caller brought toSha in.
 */
function deploy({ repoDir, fromSha, toSha, filterIds = [], force = false,
                  dryRun = false, noRestart = false, pinned = false }) {
  assertCommitted(repoDir);
  // A deploy that throws past this point leaves part of toSha installed. The
  // first such sha is kept until a run completes, so --rollback reverts it (and
  // the listener's own rollback deploy, from it, does not replace it).
  let setPending = false;
  if (!dryRun && fromSha !== toSha) {
    const state = loadDeployState();
    if (!state.pendingSha) {
      Object.assign(state, { pendingSha: toSha, pendingFrom: fromSha });
      saveDeployState(state);
      setPending = true;
    }
  }
  if (!dryRun && gitLine(repoDir, ['rev-parse', 'HEAD']) !== toSha) {
    info(`Checking out ${toSha.slice(0, 8)}`);
    git(repoDir, ['checkout', '--detach', '--quiet', toSha]);
  }
  const changes = diffChanges(repoDir, fromSha, toSha);
  info(`${fromSha.slice(0, 8)} → ${toSha.slice(0, 8)}: ${changes.length} changed file(s)`);

  const plans = planComponents(changes, {
    filterIds, force,
    listAll: repoPaths => listFiles(repoDir, toSha, repoPaths),
  });
  if (plans.length === 0) ok('No components affected');
  else info(`${plans.length} component(s) to deploy:\n`);

  const deployed = [];
  const services = [];
  let listenerAffected = false;
  for (const { comp, install, remove } of plans) {
    const risk = comp.risk === 'safe' ? C.green('●') : C.yellow('●');
    console.log(`  ${risk} ${C.bold(comp.name)} ${C.dim(`(${comp.id})`)}`);
    console.log(`    ${C.dim(comp.description)}`);

    // Pre-install hook (backup, merge protection, etc.) — false vetoes the component
    if (comp.preInstall && comp.preInstall(install, { repoDir, toSha, dryRun }) === false) continue;

    let installed = 0;
    let removed = 0;
    if (comp.install) {
      comp.install(dryRun);
    } else {
      const writable = { ...comp, targets: writableTargets(comp, repoDir) };
      installed = installFiles(writable, repoDir, install, dryRun);
      removed = removeFiles(writable, repoDir, fromSha, remove, dryRun);
      if (!dryRun) ok(`    Installed ${installed}, removed ${removed} file(s)`);
    }

    // Post-install hook (npm install, next build, config regen, boot compile, etc.).
    // It also gets the diff: under --force/--component, `install` lists every file.
    if (comp.postInstall && !dryRun) comp.postInstall([...install, ...remove], changes, { repoDir });

    for (const svc of (IS_MAC ? comp.servicesMac : comp.servicesLinux) || []) {
      if (!services.includes(svc)) services.push(svc);
    }
    if (comp.restartsListener) listenerAffected = true;
    if (comp.notes && dryRun) console.log(`    ${C.dim('Note: ' + comp.notes)}`);
    console.log('');
    deployed.push({ comp, installed, removed });
  }

  const deferredRestart = [];
  if (listenerAffected && pinned && !dryRun && !noRestart) {
    if (restartService(LISTENER_SERVICE, { probeOnly: true })) {
      deferredRestart.push(LISTENER_SERVICE);
      info(`${LISTENER_SERVICE} restart deferred to the listener (it runs this deploy)`);
    }
  } else if (listenerAffected) {
    services.push(LISTENER_SERVICE);
  }

  const restarted = [];
  if (services.length > 0 && dryRun) {
    info(`Would restart the running ones of: ${services.join(', ')}`);
  } else if (services.length > 0 && noRestart) {
    info(`${services.length} service(s) need manual restart: ${services.join(', ')}`);
  } else {
    for (const svc of services) {
      if (restarted.length > 0) exec('sleep 1', { ignoreError: true }); // rolling, one at a time
      if (restartService(svc)) restarted.push(svc);
    }
  }

  if (!dryRun) {
    for (const { comp } of deployed) {
      if (!comp.validate) continue;
      if (comp.validate()) ok(`${comp.name}: validated`);
      else warn(`${comp.name}: validation failed — check manually`);
    }
    recordDeploy({ fromSha, toSha, filterIds, deployed, setPending });
  }

  return {
    from: fromSha,
    to: toSha,
    changedFiles: changes.length,
    components: deployed.map(({ comp, installed, removed }) => ({ id: comp.id, installed, removed })),
    restarted,
    deferredRestart,
  };
}

/**
 * deployedSha (the next diff base) moves only on an unfiltered run: a
 * --component run leaves the other components behind. lastSha (the --rollback
 * target) moves only when this run changed something and left a version that
 * had actually been deployed — not on a run that deploys nothing, and not on
 * a rollback away from a sha that failed. The failed deploy's pendingSha clears
 * once the run that set it, a complete run, or its revert succeeds.
 */
function recordDeploy({ fromSha, toSha, filterIds, deployed, setPending }) {
  const state = loadDeployState();
  const complete = filterIds.every(id => id === 'all');
  const revertsPending = !!state.pendingSha && fromSha === state.pendingSha;
  const leftDeployedVersion = fromSha !== toSha && !revertsPending &&
    (!state.deployedSha || state.deployedSha === fromSha);
  const clearsPending = !!state.pendingSha && (setPending || complete || revertsPending);
  if (clearsPending) {
    delete state.pendingSha;
    delete state.pendingFrom;
  }
  if (deployed.length > 0) {
    if (leftDeployedVersion) state.lastSha = fromSha;
    state.lastDeploy = new Date().toISOString();
    for (const { comp, installed, removed } of deployed) {
      state.components[comp.id] = { deployedAt: state.lastDeploy, sha: toSha.slice(0, 8), filesChanged: installed + removed };
    }
  }
  if (complete) state.deployedSha = toSha;
  if (complete || deployed.length > 0 || clearsPending) saveDeployState(state);
}

/** Refuse --node ids the fleet registry has never seen, before anything deploys. */
async function assertKnownNodes(ids) {
  const { discoverNodes } = require('./fleet-deploy');
  const { connect } = require('nats');
  const { natsConnectOpts } = require('../lib/nats-resolve');
  let nc;
  try {
    nc = await connect(natsConnectOpts({ name: 'deploy-node-check', timeout: 10000 }));
  } catch (err) {
    throw new Error(`cannot check --node ${ids.join(', ')} against MESH_NODES/MESH_NODE_HEALTH: ${err.message}`);
  }
  try {
    const nodes = await discoverNodes(nc);
    const unknown = unknownNodes(ids, nodes);
    if (unknown.length > 0) {
      throw new Error(`unknown node ${unknown.join(', ')} — known: ${nodes.map(n => n.nodeId).join(', ') || 'none'}`);
    }
  } finally {
    await nc.close();
  }
}

// Every node may build Mission Control (npm ci + next build), so the run waits
// for a deploying node as long as its listener lets the deploy run.
const FLEET_RESULT_WAIT_MS = 20 * 60 * 1000;

/** Publish a fleet trigger and wait for the nodes: { outcome } from fleetDeploy, or { error }. */
async function triggerFleet(connName, opts) {
  try {
    const { fleetDeploy } = require('./fleet-deploy');
    const { connect } = require('nats');
    const { natsConnectOpts } = require('../lib/nats-resolve');
    const nc = await connect(natsConnectOpts({ name: connName, timeout: 10000 }));
    try {
      return { outcome: await fleetDeploy(nc, { ...opts, timeoutMs: FLEET_RESULT_WAIT_MS }) };
    } finally {
      await nc.close();
    }
  } catch (error) {
    return { error };
  }
}

// A node that never reported catches up on reconnect, so only an error or a
// failed node fails the run.
function fleetFailed({ outcome, error }) {
  return !!error || outcome.failed > 0;
}

function remoteSummary({ outcome, error }) {
  if (error) return C.red(`FAILED (${error.message.split('\n')[0]})`);
  if (outcome.failed > 0) return C.red(`FAILED (${outcome.failed} of ${outcome.expected} node(s))`);
  if (outcome.expected === 0) return C.dim('no remote nodes');
  if (outcome.missing + outcome.stillDeploying > 0) {
    return C.yellow(`partial (${outcome.missing} pending catch-up, ${outcome.stillDeploying} still deploying)`);
  }
  return C.green('deployed');
}

// ── Tracer Instrumentation ───────────────────────────────────────────────
planComponents = tracer.wrap('planComponents', planComponents, { tier: 2, category: 'lifecycle' });
installFiles = tracer.wrap('installFiles', installFiles, { tier: 2, category: 'lifecycle' });
removeFiles = tracer.wrap('removeFiles', removeFiles, { tier: 2, category: 'lifecycle' });
restartService = tracer.wrap('restartService', restartService, { tier: 2, category: 'lifecycle' });
deploy = tracer.wrap('deploy', deploy, { tier: 2, category: 'lifecycle' });

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const localOnly = args.includes('--local');
  const noRestart = args.includes('--no-restart');
  const doRollback = args.includes('--rollback');
  // Its component could never install (its preInstall always vetoed), and units
  // hold templates only the installer renders: refused rather than ignored.
  if (args.includes('--include-services')) {
    throw new Error('--include-services was removed: service units change only through install.sh ' +
      '(scripts/install/services.sh)');
  }
  const forceAll = args.includes('--force');
  const showStatus = args.includes('--status');

  // Parse --component flag (can be repeated)
  const filterIds = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--component' && args[i + 1]) {
      filterIds.push(args[i + 1]);
      i++;
    }
  }

  // --to <sha> [--from <sha>]: pinned mode — no fetch, this node only
  const argValue = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const fromArg = argValue('--from');
  const toArg = argValue('--to');

  // Not in pinned mode: the listener's rollback runs the previous sha's script
  // with the forward deploy's --component args, which may name a newer id.
  if (!toArg) {
    const known = MANIFEST.map(c => c.id);
    const unknown = filterIds.filter(id => id !== 'all' && !known.includes(id));
    if (unknown.length > 0) throw new Error(`unknown component ${unknown.join(', ')} — known: ${known.join(', ')}`);
  }

  // --node <id> (repeatable): exactly those nodes. An unknown name used to
  // match neither alias list and fell through to "this node + every node".
  const nodeNames = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--node' && args[i + 1]) {
      nodeNames.push(args[i + 1]);
      i++;
    }
  }
  let deployLocal = true, deployRemote = !localOnly, targetNodes = null;
  if (nodeNames.length > 0) {
    const localId = resolveNodeId();
    const plan = planNodeTargets(nodeNames, { localId, aliases: loadNodeAliases() });
    if (localOnly && plan.remoteIds.length > 0) {
      throw new Error(`--local conflicts with --node ${plan.remoteIds.join(', ')} (this node is ${localId})`);
    }
    deployLocal = plan.deployLocal;
    deployRemote = plan.remoteIds.length > 0;
    targetNodes = deployRemote ? plan.remoteIds : null;
  }

  // ── Status mode ──
  if (showStatus) {
    header('Deployment Status');
    const state = loadDeployState();
    info(`Fetching origin/${DEPLOY_BRANCH}...`);
    git(REPO_DIR, ['fetch', 'origin', DEPLOY_BRANCH]);
    const head = gitLine(REPO_DIR, ['rev-parse', 'HEAD']);
    const remoteSha = gitLine(REPO_DIR, ['rev-parse', `origin/${DEPLOY_BRANCH}^{commit}`]);
    const changes = diffChanges(REPO_DIR, deployedBase(REPO_DIR), remoteSha);

    console.log(`  Repo:     ${REPO_DIR}`);
    console.log(`  Branch:   ${DEPLOY_BRANCH}`);
    console.log(`  HEAD:     ${head.slice(0, 8)}`);
    console.log(`  Remote:   ${remoteSha.slice(0, 8)}`);
    console.log(`  Deployed: ${state.deployedSha ? state.deployedSha.slice(0, 8) : 'not recorded (HEAD assumed)'}`);
    console.log(`  Status:   ${changes.length === 0 ? C.green('up to date') : C.yellow(`${changes.length} files behind`)}`);

    if (state.lastDeploy) {
      console.log(`  Last deploy: ${state.lastDeploy}`);
    }

    if (changes.length > 0) {
      console.log(`\n  Changed files:`);
      for (const c of changes) {
        console.log(`    ${c.status} ${c.path}`);
      }

      const affected = planComponents(changes, { listAll: () => [] });
      if (affected.length > 0) {
        console.log(`\n  Affected components:`);
        for (const { comp, install, remove } of affected) {
          const risk = comp.risk === 'safe' ? C.green(comp.risk) : C.yellow(comp.risk);
          console.log(`    ${comp.name} [${risk}] — ${install.length + remove.length} files`);
        }
      }
    }

    // Check npm packages
    for (const comp of MANIFEST.filter(c => c.detect)) {
      const result = comp.detect();
      if (result.changed) {
        console.log(`\n  ${C.yellow('Update available:')} ${comp.name}`);
        if (result.current) console.log(`    Current: ${result.current}`);
        if (result.latest) console.log(`    Latest:  ${result.latest}`);
        if (result.reason) console.log(`    Reason:  ${result.reason}`);
      }
    }

    return;
  }

  if (targetNodes) await assertKnownNodes(targetNodes);

  // ── Rollback mode ──
  if (doRollback) {
    header('Rolling Back Last Deploy');
    const state = loadDeployState();
    // Older code carries no newer-schema check of its own: refuse to put it in
    // front of a memory store a later deploy migrated, unless told to (--force).
    const assertStoreSchema = (toSha) => {
      const refusal = require('../lib/store-schema-guard').schemaRollbackRefusal({
        repoDir: REPO_DIR, toSha, dbPath: path.join(DIRS.OPENCLAW_HOME, 'state.db'),
      });
      if (!refusal) return;
      if (!forceAll) throw new Error(`${refusal} (or roll back anyway: mesh-deploy.js --rollback --force)`);
      warn(`${refusal} — rolling back anyway (--force)`);
    };
    // A deploy that failed partway on this node: revert it, not the one before.
    // The fleet never received it (the trigger goes out after the local deploy).
    const pendingSha = deployLocal ? resolveCommit(REPO_DIR, state.pendingSha) : null;
    if (pendingSha) {
      const toSha = resolveCommit(REPO_DIR, state.pendingFrom);
      if (!toSha) {
        fail(`pendingFrom in deploy state is not a commit in ${REPO_DIR}: ${JSON.stringify(state.pendingFrom).slice(0, 50)}`);
        process.exitCode = 1;
        return;
      }
      warn(`Rolling back ${pendingSha.slice(0, 7)} → ${toSha.slice(0, 7)}: reverting the failed deploy of ${pendingSha.slice(0, 7)}`);
      assertStoreSchema(toSha);
      deploy({ repoDir: REPO_DIR, fromSha: pendingSha, toSha, dryRun, noRestart });
      ok(`Rolled back to ${toSha.slice(0, 8)}`);
      if (deployRemote) skip('Remote nodes never received the failed deploy — remote rollback skipped');
      return;
    }
    if (!state.lastSha) {
      fail('No previous deploy state found — cannot rollback');
      return;
    }
    const toSha = resolveCommit(REPO_DIR, state.lastSha);
    if (!toSha) {
      fail(`lastSha in deploy state is not a commit in ${REPO_DIR}: ${JSON.stringify(state.lastSha).slice(0, 50)}`);
      return;
    }
    const fromSha = deployedBase(REPO_DIR);
    warn(`Rolling back ${fromSha.slice(0, 7)} → ${toSha.slice(0, 7)}`);
    if (deployLocal) {
      assertStoreSchema(toSha);
      deploy({ repoDir: REPO_DIR, fromSha, toSha, dryRun, noRestart });
      ok(`Rolled back to ${toSha.slice(0, 8)}`);
    } else {
      skip('This node is not targeted — local rollback skipped');
    }

    if (deployRemote) {
      header('Rolling back remote nodes');
      // Listeners check out the rollback sha exactly.
      const remote = await triggerFleet('deploy-rollback', {
        components: null, targetNodes, sha: toSha.slice(0, 7), branch: DEPLOY_BRANCH, dryRun, force: true,
      });
      if (remote.error?.code === 'MODULE_NOT_FOUND') warn('Fleet deploy not available — remote rollback skipped');
      else if (remote.error) fail(`Remote rollback failed: ${remote.error.message}`);
      else if (remote.outcome.failed > 0) fail(`Remote rollback failed on ${remote.outcome.failed} of ${remote.outcome.expected} node(s)`);
      else if (!dryRun) ok('Remote rollback triggered via fleet deploy');
      if (fleetFailed(remote)) process.exitCode = 1;
    }
    return;
  }

  // ── Pinned mode: no fetch, this node only (the deploy listener's forward
  // deploy and its rollback). DEPLOY_RESULT is the line the listener parses.
  if (toArg) {
    header(`Pinned deploy (${nodeRole()})`);
    const toSha = resolveCommit(REPO_DIR, toArg);
    if (!toSha) throw new Error(`--to ${toArg} is not a commit in ${REPO_DIR} (pinned mode never fetches)`);
    const fromSha = fromArg ? resolveCommit(REPO_DIR, fromArg) : deployedBase(REPO_DIR);
    if (!fromSha) throw new Error(`--from ${fromArg} is not a commit in ${REPO_DIR}`);
    const result = deploy({ repoDir: REPO_DIR, fromSha, toSha, filterIds, force: forceAll, dryRun, noRestart, pinned: true });
    console.log(`DEPLOY_RESULT ${JSON.stringify(result)}`);
    return;
  }

  // ═══ Normal deploy flow ═══

  if (deployLocal) header(`Deploying to ${IS_MAC ? 'macOS' : 'Linux'} (${nodeRole()})`);

  if (!fs.existsSync(REPO_DIR)) {
    fail(`Repo not found at ${REPO_DIR}`);
    console.log(`  Clone it: git clone https://github.com/moltyguibros-design/openclaw-node.git "${REPO_DIR}"`);
    process.exit(1);
  }

  // One target for this node and the fleet, dry run or not: origin's tip. The
  // lead's HEAD is a working checkout, and only the local deploy moves it.
  info(`Fetching origin/${DEPLOY_BRANCH}...`);
  git(REPO_DIR, ['fetch', 'origin', DEPLOY_BRANCH]);
  const toSha = gitLine(REPO_DIR, ['rev-parse', `origin/${DEPLOY_BRANCH}^{commit}`]);
  const toShort = gitLine(REPO_DIR, ['rev-parse', '--short', toSha]);

  if (deployLocal) {
    const head = gitLine(REPO_DIR, ['rev-parse', 'HEAD']);
    if (!isAncestor(REPO_DIR, head, toSha)) {
      throw new Error(`HEAD ${head.slice(0, 8)} has commits that are not on origin/${DEPLOY_BRANCH} — ` +
        'push them first, or deploy an exact commit with --local --to <sha>');
    }
    // Before the fast-forward, so a refused tree leaves the branch where it was.
    assertCommitted(REPO_DIR);
    // Read before the fast-forward: with nothing recorded the base is HEAD, and
    // after the merge HEAD is already the target.
    const fromSha = deployedBase(REPO_DIR);
    if (!dryRun && head !== toSha && currentBranch(REPO_DIR) === DEPLOY_BRANCH) {
      git(REPO_DIR, ['merge', '--ff-only', '--quiet', toSha]);
      ok(`Fast-forwarded ${DEPLOY_BRANCH}: ${head.slice(0, 7)} → ${toSha.slice(0, 7)}`);
    }
    const result = deploy({
      repoDir: REPO_DIR, fromSha, toSha, filterIds, force: forceAll, dryRun, noRestart,
    });
    console.log(`DEPLOY_RESULT ${JSON.stringify(result)}`);
  }

  // ── Fleet deploy (replaces old SSH remote block) ──
  const localOnlyIds = filterIds.filter(id => MANIFEST.some(c => c.id === id && c.localOnly));
  const fleetIds = filterIds.filter(id => !localOnlyIds.includes(id));
  if (deployRemote && localOnlyIds.length > 0) {
    warn(`${localOnlyIds.join(', ')}: local-only (not from this repo) — run \`mesh deploy --local --component <id>\` on each node`);
    if (fleetIds.length === 0) deployRemote = false;
  }
  let remote = null;
  if (deployRemote) {
    remote = await triggerFleet('deploy-cli', {
      components: filterIds.length > 0 ? filterIds : null,
      targetNodes,  // null: every node but this one
      sha: toShort,
      branch: DEPLOY_BRANCH,
      dryRun,
      force: forceAll,
    });
    if (remote.error?.code === 'MODULE_NOT_FOUND') {
      warn('Fleet deploy not available (fleet-deploy.js or nats not found)');
      info('Install: npm install nats && copy fleet-deploy.js to bin/');
    } else if (remote.error) {
      fail(`Fleet deploy failed: ${remote.error.message}`);
    }
    if (fleetFailed(remote)) process.exitCode = 1;
  }

  // ── Summary ──
  if (!dryRun && (deployLocal || deployRemote)) {
    header('Deploy Complete');
    console.log(`  Commit:  ${toShort}`);
    console.log(`  Branch:  ${DEPLOY_BRANCH}`);
    console.log(`  Local:   ${deployLocal ? C.green('deployed') : C.dim('skipped')}`);
    console.log(`  Remote:  ${remote ? remoteSummary(remote) : C.dim('skipped')}`);
    console.log('');
  }
}

main().catch(err => {
  fail(`Deploy error: ${err.message}`);
  // The listener (pinned, --to) reverts a failed deploy itself.
  const { pendingSha } = loadDeployState();
  if (pendingSha && !process.argv.includes('--to')) {
    info(`Recover: node bin/mesh-deploy.js --rollback (reverts the failed deploy of ${pendingSha.slice(0, 7)})`);
  }
  console.log(`DEPLOY_ERROR ${JSON.stringify(err.message)}`); // the cause the listener reports
  process.exit(1);
});
