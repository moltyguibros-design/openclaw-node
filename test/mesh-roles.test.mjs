/**
 * mesh-roles.test.mjs — the deploy listener's component filter names the
 * mesh-deploy MANIFEST ids. It used to hold gateway / companion-bridge /
 * service-defs (no such ids) and miss config, services, lane-watchdog,
 * log-rotate and mesh-tool-discord: a fleet `--component config` was skipped on
 * every node, and `--component gateway` "succeeded" having deployed nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { DEPLOY_COMPONENTS, ROLE_COMPONENTS, FLEET_COMPONENTS } = require('../lib/mesh-roles.js');

process.env.OPENCLAW_NODE_ROLE = 'lead';
process.env.OPENCLAW_REPO_DIR = path.join(os.tmpdir(), `mesh-roles-no-repo-${process.pid}`);
const { runDeploy } = require('../bin/mesh-deploy-listener.js');

const trigger = components => ({ sha: 'abcdef1', branch: 'main', components });

describe('fleet component filter', () => {
  it('lets every repo-sourced MANIFEST id through on the role that runs it', () => {
    assert.deepEqual(FLEET_COMPONENTS.lead, [
      'mesh-daemons', 'mesh-cli', 'shared-lib', 'mc', 'memory-daemon', 'workspace-bin',
      'souls', 'skills', 'boot', 'boot-manifest', 'workspace-docs', 'harness-rules', 'config', 'lane-watchdog',
      'log-rotate', 'mesh-tool-discord',
    ]);
    // Workers install and run the log-rotate timer too (service-manifest role 'both').
    assert.deepEqual(FLEET_COMPONENTS.worker, [
      'mesh-daemons', 'mesh-cli', 'shared-lib', 'workspace-bin', 'souls', 'skills', 'workspace-docs',
      'harness-rules', 'config', 'log-rotate',
    ]);
  });

  it('keeps the npm/git-sourced openclaw and companion local-only, but advertises them', () => {
    for (const role of ['lead', 'worker']) {
      assert.ok(!FLEET_COMPONENTS[role].includes('openclaw'));
      assert.ok(!FLEET_COMPONENTS[role].includes('companion'));
      assert.ok(ROLE_COMPONENTS[role].includes('openclaw'));
    }
    assert.ok(ROLE_COMPONENTS.lead.includes('companion'));
    assert.ok(!ROLE_COMPONENTS.worker.includes('companion'));
  });

  it('a fleet trigger naming config reaches the deploy on a lead', async () => {
    const r = await runDeploy(trigger(['config']));
    assert.equal(r.status, 'failed', 'passed the filter and reached the (missing) repo');
    assert.match(r.errors.join(' '), /Repo dir not found/);
  });

  for (const id of ['gateway', 'companion-bridge', 'service-defs', 'openclaw', 'companion']) {
    it(`a fleet trigger naming only ${id} is skipped, not reported deployed`, async () => {
      const r = await runDeploy(trigger([id]));
      assert.equal(r.status, 'skipped');
    });
  }
});

// mesh-deploy.js runs main() on load, so it is exercised as a process: a copy of
// the script beside an edited mesh-roles.js.
function runDeployWithRoles(rolesSource, args = ['--status']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-roles-manifest-'));
  for (const rel of ['bin/mesh-deploy.js', 'lib/tracer.js', 'lib/obs-db.js', 'lib/node-id.js', 'lib/node-aliases.js']) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  }
  fs.writeFileSync(path.join(dir, 'lib/mesh-roles.js'), rolesSource);
  const run = spawnSync(process.execPath, [path.join(dir, 'bin/mesh-deploy.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: path.join(dir, 'home'), OPENCLAW_REPO_DIR: path.join(dir, 'no-repo'),
      NODE_PATH: path.join(REPO, 'node_modules') },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return run;
}

describe('mesh-deploy MANIFEST and the role table are one list', () => {
  it('every MANIFEST id is in the table, and nothing else', () => {
    const src = fs.readFileSync(path.join(REPO, 'bin/mesh-deploy.js'), 'utf8');
    const start = src.indexOf('const MANIFEST = [');
    const block = src.slice(start, src.indexOf('\n];', start));
    const ids = [...block.matchAll(/^ {4}id: '([^']+)'/gm)].map(m => m[1]);
    assert.deepEqual(ids, DEPLOY_COMPONENTS.map(c => c.id));
    assert.doesNotMatch(block, /nodeFilter:/, 'nodeFilter is taken from lib/mesh-roles.js');
  });

  // memory-harness named two config files that never existed, so it could never
  // install anything: every literal repoPath must be in the tree.
  it('every literal repoPath names a file or dir in the repo', () => {
    const src = fs.readFileSync(path.join(REPO, 'bin/mesh-deploy.js'), 'utf8');
    const start = src.indexOf('const MANIFEST = [');
    const block = src.slice(start, src.indexOf('\n];', start));
    const lists = [...block.matchAll(/^ {4}repoPaths: \[((?:'[^']+'(?:, )?)*)\],$/gm)];
    assert.ok(lists.length >= 10);
    for (const [, list] of lists) {
      for (const [, rel] of list.matchAll(/'([^']+)'/g)) assert.ok(fs.existsSync(path.join(REPO, rel)), rel);
    }
    assert.ok(!DEPLOY_COMPONENTS.some(c => c.id === 'memory-harness'));
  });

  // No component was ever 'manual', the deploy has no service-definitions or
  // migrations component, and fileHash had no caller.
  it('every MANIFEST risk is safe or careful, and nothing branches on a manual tier', () => {
    const src = fs.readFileSync(path.join(REPO, 'bin/mesh-deploy.js'), 'utf8');
    const start = src.indexOf('const MANIFEST = [');
    const block = src.slice(start, src.indexOf('\n];', start));
    const risks = [...block.matchAll(/^ {4}risk: '([^']+)'/gm)].map(m => m[1]);
    assert.ok(risks.length >= 10);
    for (const risk of risks) assert.ok(risk === 'safe' || risk === 'careful', risk);
    assert.doesNotMatch(src, /risk === 'manual'|"manual"|manual-risk|C\.red\(comp\.risk\)/);
    assert.doesNotMatch(src, /function fileHash|require\('crypto'\)/);
    assert.doesNotMatch(src.slice(0, src.indexOf('*/')), /service definitions|database migrations/);
    const meshCli = block.slice(block.indexOf("    id: 'mesh-cli',"), block.indexOf('\n  },', block.indexOf("    id: 'mesh-cli',")));
    assert.doesNotMatch(meshCli, /postInstall/, 'nothing in the repo ships a ~/openclaw/bin/mesh wrapper to chmod');
  });

  it('log-rotate restarts the Linux timer service it ships to every node', () => {
    const src = fs.readFileSync(path.join(REPO, 'bin/mesh-deploy.js'), 'utf8');
    const entry = src.slice(src.indexOf("    id: 'log-rotate',"), src.indexOf('\n  },', src.indexOf("    id: 'log-rotate',")));
    assert.match(entry, /servicesLinux: \['openclaw-log-rotate'\]/);
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'services/service-manifest.json'), 'utf8'));
    assert.equal(manifest.find(u => u.name === 'openclaw-log-rotate').role, 'both');
    assert.equal(DEPLOY_COMPONENTS.find(c => c.id === 'log-rotate').nodeFilter, 'all');
  });

  // The services component's preInstall vetoed it unconditionally, so the flag
  // never installed a unit; units change only through the installer's renderer.
  it('has no services component, and refuses --include-services instead of ignoring it', () => {
    assert.ok(!DEPLOY_COMPONENTS.some(c => c.id === 'services'));
    const src = fs.readFileSync(path.join(REPO, 'lib/mesh-roles.js'), 'utf8');
    const run = runDeployWithRoles(src, ['--include-services']);
    assert.notEqual(run.status, 0);
    assert.match(run.stdout + run.stderr, /--include-services was removed: service units change only through install\.sh/);
  });

  it('mesh-deploy refuses to run when the table lacks a MANIFEST id', () => {
    const src = fs.readFileSync(path.join(REPO, 'lib/mesh-roles.js'), 'utf8');
    const run = runDeployWithRoles(src.replace("  { id: 'log-rotate', nodeFilter: 'all' },\n", ''));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /MANIFEST and lib\/mesh-roles\.js disagree: not in mesh-roles: log-rotate/);
  });

  it('mesh-deploy refuses to run when the table names an id the MANIFEST lacks', () => {
    const src = fs.readFileSync(path.join(REPO, 'lib/mesh-roles.js'), 'utf8');
    const run = runDeployWithRoles(src.replace("  { id: 'mc', nodeFilter: 'lead' },",
      "  { id: 'mc', nodeFilter: 'lead' },\n  { id: 'gateway', nodeFilter: 'lead' },"));
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /not in MANIFEST: gateway/);
  });
});

// A node's role was guessed from its OS when none was saved: a Mac that never
// saved one was deployed as the lead, a Linux box as a worker.
describe('a node without a saved role is refused, never given an OS default', () => {
  const { requireNodeRole } = require('../lib/mesh-roles.js');
  const noRoleEnv = (home) => {
    const env = { ...process.env, HOME: home, OPENCLAW_OBS_DB: path.join(home, 'obs.db'), OPENCLAW_NATS: 'nats://127.0.0.1:1' };
    delete env.OPENCLAW_NODE_ROLE;
    return env;
  };

  it('requireNodeRole reads the env, then openclaw.env, and refuses anything else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-roles-role-'));
    const envFile = path.join(dir, 'openclaw.env');
    assert.throws(() => requireNodeRole({ env: {}, envFile }), /OPENCLAW_NODE_ROLE is not set/);
    fs.writeFileSync(envFile, 'OPENCLAW_NODE_ROLE="worker"\n');
    assert.equal(requireNodeRole({ env: {}, envFile }), 'worker');
    assert.equal(requireNodeRole({ env: { OPENCLAW_NODE_ROLE: 'lead' }, envFile }), 'lead');
    assert.throws(() => requireNodeRole({ env: { OPENCLAW_NODE_ROLE: 'Lead' }, envFile }), /OPENCLAW_NODE_ROLE is "Lead"/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('the deploy listener exits at startup with the reason', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-roles-listener-'));
    const run = spawnSync(process.execPath, [path.join(REPO, 'bin/mesh-deploy-listener.js')], {
      encoding: 'utf8', timeout: 15_000, env: noRoleEnv(home),
    });
    fs.rmSync(home, { recursive: true, force: true });
    assert.equal(run.status, 1, `listener must refuse, not start: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, /OPENCLAW_NODE_ROLE is not set/);
  });

  it('mesh-deploy refuses a deploy with the reason', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-roles-deploy-'));
    const run = spawnSync(process.execPath, [path.join(REPO, 'bin/mesh-deploy.js'), '--to', 'HEAD', '--dry-run'], {
      encoding: 'utf8', timeout: 60_000, env: { ...noRoleEnv(home), OPENCLAW_REPO_DIR: REPO },
    });
    fs.rmSync(home, { recursive: true, force: true });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /DEPLOY_ERROR .*OPENCLAW_NODE_ROLE is not set/);
    assert.doesNotMatch(run.stdout, /Pinned deploy \(/);
  });
});
