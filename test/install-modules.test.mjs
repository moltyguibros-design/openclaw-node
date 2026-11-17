import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_SH = join(ROOT, 'install.sh');

const MODULES = [
  'helpers.sh',
  'llm-host.sh',
  'system-deps.sh',
  'env.sh',
  'workspace.sh',
  'config.sh',
  'components.sh',
  'services.sh',
  'integrations.sh',
  'verify.sh',
];

const FLAGS = [
  '--dry-run',
  '--update',
  '--skip-mesh',
  '--enable-services',
  '--skip-llm',
  '--skip-verify',
  '--skip-frontend',
  '--verify-frontend',
  '--sandbox',
  '--role=',
  '--cluster-peers=',
  '--cluster-bind=',
  '--lead-pubkey=',
  '--provider=',
  '--project=',
];

const installSrc = readFileSync(INSTALL_SH, 'utf8');
const moduleSrc = Object.fromEntries(
  MODULES.map((m) => [m, readFileSync(join(ROOT, 'scripts/install', m), 'utf8')]),
);
const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const rootLock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const heartbeatLaunchd = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.scheduler-heartbeat.plist'), 'utf8');
const heartbeatSystemd = readFileSync(join(ROOT, 'services/systemd/openclaw-scheduler-heartbeat.service'), 'utf8');

function bashN(file) {
  return spawnSync('bash', ['-n', file], { encoding: 'utf8' });
}

test('install.sh passes bash -n', () => {
  const r = bashN(INSTALL_SH);
  assert.equal(r.status, 0, r.stderr);
});

test('every module passes bash -n', () => {
  const scripts = readdirSync(join(ROOT, 'scripts/install')).filter((f) => f.endsWith('.sh')).sort();
  for (const m of scripts) {
    const r = bashN(join(ROOT, 'scripts/install', m));
    assert.equal(r.status, 0, `${m}: ${r.stderr}`);
  }
});

test('install.sh sources every module, in order', () => {
  let last = -1;
  for (const m of MODULES) {
    const idx = installSrc.indexOf(`source "$REPO_DIR/scripts/install/${m}"`);
    assert.notEqual(idx, -1, `install.sh does not source ${m}`);
    assert.ok(idx > last, `${m} sourced out of order`);
    last = idx;
  }
});

test('flag parser still accepts the full flag inventory', () => {
  const r = spawnSync('bash', [INSTALL_SH, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of FLAGS) {
    assert.ok(r.stdout.includes(f), `--help output missing ${f}`);
    assert.ok(installSrc.includes(`${f}`), `parser case missing ${f}`);
  }
  assert.match(installSrc, /--help\|-h\)/);
});

test('the 3 unit-render dry-run guards live in services.sh', () => {
  const guard = /\[dry-run\] would render \$TEMPLATE -> \$DEST/g;
  assert.equal(moduleSrc['services.sh'].match(guard)?.length, 3);
  assert.equal(installSrc.match(guard), null);
});

// Bare envsubst blanked every $VAR, so the NATS units shipped
// `ExecReload=/bin/kill -HUP ` and check_rendered (which looks for ${VAR}) missed it.
test('unit renders hand envsubst the placeholder list, so $MAINPID survives', (t) => {
  const svc = moduleSrc['services.sh'];
  assert.equal(svc.match(/envsubst < "\$TEMPLATE"/g), null);
  const unitVars = svc.match(/UNIT_VARS='([^']*)'/)?.[1];
  assert.ok(unitVars, 'services.sh must define UNIT_VARS');
  const templates = [
    ...readdirSync(join(ROOT, 'services/systemd')).map((f) => join(ROOT, 'services/systemd', f)),
    ...readdirSync(join(ROOT, 'services/launchd')).filter((f) => /^ai\.openclaw\..*\.plist$/.test(f)).map((f) => join(ROOT, 'services/launchd', f)),
  ];
  for (const f of templates) {
    for (const [v] of readFileSync(f, 'utf8').matchAll(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g)) {
      assert.ok(unitVars.split(' ').includes(v), `${v} in ${f} is missing from UNIT_VARS`);
    }
  }
  if (spawnSync('sh', ['-c', 'command -v envsubst']).status !== 0) {
    t.diagnostic('envsubst not installed; render check skipped');
    return;
  }
  const r = spawnSync('envsubst', [unitVars], {
    encoding: 'utf8',
    input: readFileSync(join(ROOT, 'services/systemd/openclaw-nats.service'), 'utf8'),
    env: { PATH: process.env.PATH, HOME: '/h', NATS_SERVER_BIN: '/x/nats-server' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('ExecReload=/bin/kill -HUP $MAINPID'), r.stdout);
  assert.ok(r.stdout.includes('ExecStart=/x/nats-server --config /h/.openclaw/config/nats.conf'), r.stdout);
});

// The gateway units hardcoded /usr/local/lib/node_modules/openclaw, which is not
// where npm -g installs on Apple-Silicon Homebrew (/opt/homebrew/lib) or NodeSource (/usr/lib).
test('gateway units run the openclaw package npm -g actually installed', () => {
  for (const f of ['services/launchd/ai.openclaw.gateway.plist', 'services/systemd/openclaw-gateway.service']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(src.includes('${OPENCLAW_GATEWAY_JS}'), f);
    assert.ok(!src.includes('/usr/local/lib/node_modules'), f);
    assert.ok(!src.includes('2026.3.7'), `${f} carries a hardcoded service version`);
  }
  const svc = moduleSrc['services.sh'];
  assert.ok(svc.match(/UNIT_VARS='([^']*)'/)[1].split(' ').includes('${OPENCLAW_GATEWAY_JS}'));
  const sedLists = svc.match(/-e "s\|\\\$\{NPM_BIN\}\|/g).length;
  assert.equal(svc.match(/-e "s\|\\\$\{OPENCLAW_GATEWAY_JS\}\|\$OPENCLAW_GATEWAY_JS\|g"/g)?.length, sedLists, 'every sed fallback renders the gateway path');

  const line = moduleSrc['env.sh'].split('\n').find((l) => l.startsWith('export OPENCLAW_GATEWAY_JS='));
  assert.ok(line, 'env.sh exports OPENCLAW_GATEWAY_JS');
  const dir = mkdtempSync(join(tmpdir(), 'oc-gateway-js-'));
  const npm = join(dir, 'npm');
  writeFileSync(npm, '#!/bin/sh\n[ "$1 $2 $3" = "root -g --logs-max=0" ] && echo /opt/homebrew/lib/node_modules\n', { mode: 0o755 });
  const resolve = (npmBin) => spawnSync('bash', ['-c', `${line}\necho "$OPENCLAW_GATEWAY_JS"`], {
    encoding: 'utf8', env: { PATH: process.env.PATH, NPM_BIN: npmBin },
  }).stdout.trim();
  assert.equal(resolve(npm), '/opt/homebrew/lib/node_modules/openclaw/dist/index.js');
  assert.equal(resolve(join(dir, 'no-npm')), '/usr/local/lib/node_modules/openclaw/dist/index.js');
});

// --update --enable-services on Linux used `start`, a no-op on a running unit,
// so re-rendered units and new code waited for a reboot (macOS unloads/loads).
test('Linux --enable-services restarts re-rendered autostart units', () => {
  const svc = moduleSrc['services.sh'];
  assert.doesNotMatch(svc, /systemctl --user start "\$\{SVC_NAME\}\.service"/, 'start is a no-op on a running unit');
  assert.match(svc, /run systemctl --user daemon-reload\n\s+run systemctl --user enable "\$\{SVC_NAME\}\.service"\n(\s+#[^\n]*\n)?\s+run systemctl --user restart "\$\{SVC_NAME\}\.service"/);
  assert.match(svc, /run systemctl --user daemon-reload\n\s+run systemctl --user enable "\$\{SVC_NAME\}\.timer"/);
});

test('cluster dry-run guard and cluster security live in config.sh', () => {
  const cfg = moduleSrc['config.sh'];
  assert.ok(cfg.includes('[dry-run] would render cluster nats.conf'));
  assert.ok(cfg.includes('Refusing to bind 0.0.0.0.'));
  assert.ok(cfg.includes('tailscale ip -4'));
  assert.ok(cfg.includes('OPENCLAW_NATS_CLUSTER_PASS="$(openssl rand -hex 32)"'));
  assert.ok(cfg.includes('OPENCLAW_DEPLOY_TRUSTED_KEYS'));
});

test('NATS cluster plists come only from services/launchd, pointed at the rendered configs', () => {
  assert.deepEqual(readdirSync(join(ROOT, 'services/nats')).filter((f) => f.endsWith('.plist')), []);
  const guide = readFileSync(join(ROOT, 'docs/NATS_CLUSTER.md'), 'utf8');
  assert.ok(!guide.includes('services/nats/ai.openclaw.nats-'));
  // A hand render that fills only ${HOME} leaves ${NATS_SERVER_BIN} in the plist; install.sh renders them all.
  assert.ok(!/> ~\/Library\/LaunchAgents\/ai\.openclaw\.nats-/.test(guide), 'the guide hand-renders the cluster plists');
  assert.ok(guide.includes('./install.sh --update'));
  for (const n of [1, 2, 3]) {
    const plist = readFileSync(join(ROOT, `services/launchd/ai.openclaw.nats-${n}.plist`), 'utf8');
    assert.ok(plist.includes(`\${HOME}/.openclaw/config/nats-${n}.conf`), `nats-${n} plist must run the rendered config`);
  }
});

test('workspace agent docs have one source: identity/, shipped by both install.sh and mesh-deploy', () => {
  assert.deepEqual(readdirSync(join(ROOT, 'workspace-docs')).filter((f) => !/^RUNBOOK_.*\.md$/.test(f)), []);
  const installed = moduleSrc['workspace.sh'].match(/^for f in (.+); do\n  if \[ -f "\$REPO_DIR\/identity\/\$f" \]/m)[1].split(' ');
  const deploySrc = readFileSync(join(ROOT, 'bin/mesh-deploy.js'), 'utf8');
  const start = deploySrc.indexOf("id: 'workspace-docs'");
  const comp = deploySrc.slice(start, deploySrc.indexOf("id: '", start + 1));
  const shipped = comp.match(/repoPaths: \[([^\]]+)\]\.map\(f => `identity\/\$\{f\}`\)/)[1].match(/'([^']+)'/g).map((q) => q.slice(1, -1));
  assert.deepEqual(shipped, installed);
  const agents = readFileSync(join(ROOT, 'identity/AGENTS.md'), 'utf8');
  assert.doesNotMatch(agents, /Task-Start Protocol|Task Close Protocol|memory\/performance\.jsonl|\[meta\] reflection/, 'hyperagent D1 removed the telemetry protocol from local prompting');
  assert.ok(agents.includes('## Skill Enforcement'));
});

test('every unit that runs a repo-shipped bin/ tool execs it from ${OPENCLAW_REPO_DIR}, on both OSes', () => {
  const units = [
    ...readdirSync(join(ROOT, 'services/launchd')).map((f) => `services/launchd/${f}`),
    ...readdirSync(join(ROOT, 'services/systemd')).map((f) => `services/systemd/${f}`),
  ];
  let binUnits = 0;
  for (const rel of units) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /\$\{HOME\}\/openclaw\/bin\//, `${rel} execs the ~/openclaw copy`);
    if (!/\$\{OPENCLAW_REPO_DIR\}\/bin\//.test(src)) continue;
    binUnits++;
    for (const [, root] of src.matchAll(/NODE_PATH(?:=|<\/key>\s*<string>)([^:\n<]+)\/node_modules/g)) {
      assert.equal(root, '${OPENCLAW_REPO_DIR}', `${rel} NODE_PATH`);
    }
    for (const [, dir] of src.matchAll(/^WorkingDirectory=(.*)$/gm)) assert.equal(dir, '${OPENCLAW_REPO_DIR}', `${rel} WorkingDirectory`);
  }
  assert.ok(binUnits >= 16, `bin/ units found: ${binUnits}`);
});

test('preserved behaviors sit in their modules', () => {
  assert.ok(moduleSrc['env.sh'].includes('claude_project_path() {'));
  assert.ok(moduleSrc['env.sh'].includes("sed 's|[/.]|-|g'"));
  // The Node >= 22 check moved into prereqs.sh (node_ok); system-deps.sh now
  // delegates to it rather than carrying its own version comparison.
  assert.ok(moduleSrc['system-deps.sh'].includes('PREREQ_SCRIPT'));
  assert.ok(moduleSrc['helpers.sh'].includes('echo "  [dry-run] $*"'));
  assert.ok(moduleSrc['verify.sh'].includes('node-acceptance.mjs'));
  // --skip-llm must reach the gate as --skip-axis llm, or every documented
  // model-less install is rejected by its own acceptance step.
  assert.ok(moduleSrc['verify.sh'].includes('--skip-axis llm'));
  // P5-4: an INCOMPLETE gate (exit 2) under --skip-llm is a loud warning, not
  // a failed install; a REJECTED gate (exit 1) still fails it.
  assert.ok(moduleSrc['verify.sh'].includes('"$GATE_RC" -eq 2 ] && $SKIP_LLM'));
});

test('mcp-knowledge is owned by the root dependency workspace', () => {
  assert.ok(rootPackage.workspaces.includes('lib/mcp-knowledge'));
  assert.ok(rootLock.packages['lib/mcp-knowledge']);
  assert.equal(rootLock.packages['node_modules/@openclaw/mcp-knowledge'].link, true);
  assert.equal(existsSync(join(ROOT, 'lib/mcp-knowledge/package-lock.json')), false);

  const mcpPackage = JSON.parse(readFileSync(join(ROOT, 'lib/mcp-knowledge/package.json'), 'utf8'));
  for (const [dep, range] of Object.entries(mcpPackage.dependencies)) {
    assert.equal(range, rootPackage.dependencies[dep], `lib/mcp-knowledge ${dep} drifts from the root range`);
  }
  assert.equal(mcpPackage.engines.node, rootPackage.engines.node);
  assert.deepEqual(rootLock.packages['lib/mcp-knowledge'].dependencies, mcpPackage.dependencies);
  assert.deepEqual(rootLock.packages['lib/mcp-knowledge'].engines, mcpPackage.engines);

  const rootRequire = createRequire(join(ROOT, 'package.json'));
  const sharp = rootRequire('sharp');
  assert.ok(Number(sharp.versions.sharp.split('.')[1]) >= 35, `Sharp ${sharp.versions.sharp} is below 0.35`);
  assert.equal(existsSync(join(ROOT, 'lib/mcp-knowledge/node_modules/sharp')), false);
});

test('the nkey codec dependency is declared at the root, pinned to the version nats uses', () => {
  assert.equal(rootPackage.dependencies['nkeys.js'], rootLock.packages['node_modules/nats'].dependencies['nkeys.js']);
  assert.equal(rootLock.packages[''].dependencies['nkeys.js'], rootPackage.dependencies['nkeys.js']);
  assert.equal(rootLock.packages['node_modules/nkeys.js'].version, rootPackage.dependencies['nkeys.js']);
});

test('installer never creates or copies nested mcp-knowledge dependencies', () => {
  const workspace = moduleSrc['workspace.sh'];
  assert.doesNotMatch(workspace, /mcp-knowledge\/node_modules/);
  assert.doesNotMatch(workspace, /cd \"\$WORKSPACE\/lib\/mcp-knowledge\"/);
  assert.doesNotMatch(workspace, /cd \"\$MESH_LIB\/mcp-knowledge\"/);
  assert.ok(workspace.includes("run rsync -av --exclude='node_modules' \\\n  \"$REPO_DIR/lib/\" \"$WORKSPACE/lib/\""));
  assert.ok(workspace.includes("run rsync -av --exclude='node_modules' \"$REPO_DIR/lib/\" \"$MESH_LIB/\""));
});

test('INSTALL_TEST_PROTOCOL T1 and NODE_SPEC describe what the installer leaves on disk', () => {
  const protocol = readFileSync(join(ROOT, 'docs/INSTALL_TEST_PROTOCOL.md'), 'utf8');
  const nodeSpec = readFileSync(join(ROOT, 'docs/NODE_SPEC.md'), 'utf8');
  assert.doesNotMatch(protocol, /mcp-knowledge\/node_modules/, 'T1.3 must not require the nested tree the installer never creates');
  assert.doesNotMatch(protocol, /provider=ollama/, 'MESH_LLM_PROVIDER has no default');
  assert.match(moduleSrc['config.sh'], /OPENCLAW_IDENTITY_DIR="\$OPENCLAW_ROOT"/);
  assert.match(protocol, /~\/\.openclaw\/identity\.key/);
  assert.doesNotMatch(nodeSpec, /^\s+identity\/\s/m, 'the keypair is identity.key/identity.pub in OPENCLAW_ROOT, not a directory');
});

test('INSTALL_TEST_PROTOCOL T4 matches the D11 worker guard and the mesh CLI', () => {
  const protocol = readFileSync(join(ROOT, 'docs/INSTALL_TEST_PROTOCOL.md'), 'utf8');
  const { isOpenClawWorkerProvider } = createRequire(join(ROOT, 'package.json'))('./lib/llm-providers.js');
  assert.equal(isOpenClawWorkerProvider('shell', {}), false);
  assert.equal(isOpenClawWorkerProvider('ollama', {}), false);
  const shellAgents = protocol.split('\n').filter((l) => /MESH_LLM_PROVIDER=shell .*mesh-agent\.js/.test(l));
  assert.ok(shellAgents.length > 0);
  for (const line of shellAgents) assert.ok(line.includes('MESH_ALLOW_MOCK_WORKERS=1'), `shell agents are declined without the mock flag: ${line}`);
  assert.doesNotMatch(protocol, /mesh\.js tasks show/, 'mesh tasks has no show subcommand');
  assert.doesNotMatch(protocol, /inherit `ollama`/);
});

test('the retired npx openclaw-mesh layer is neither advertised nor run', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /`npx openclaw-mesh`\) still exists/);
  const code = moduleSrc['integrations.sh'].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /npx\s+(--yes\s+)?openclaw-mesh/);
});

test('sync-to-harness is gone from the repo and an --update moves the installed copy out of bin/', () => {
  assert.equal(existsSync(join(ROOT, 'workspace-bin/sync-to-harness')), false);
  assert.match(readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8'), /^workspace-bin sync-to-harness$/m);
  assert.ok(moduleSrc['workspace.sh'].includes('retire_shipped_files workspace-bin "$WORKSPACE/bin"'));
  const root = mkdtempSync(join(tmpdir(), 'retired-ws-'));
  const bin = join(root, 'workspace', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'sync-to-harness'), '#!/bin/sh\n');
  writeFileSync(join(bin, 'kept'), '#!/bin/sh\n');
  const r = spawnSync('bash', ['-c', `source "${join(ROOT, 'scripts/install/helpers.sh')}"; retire_shipped_files workspace-bin "$1"`, 'x', bin], {
    encoding: 'utf8', env: { ...process.env, DRY_RUN: 'false', REPO_DIR: ROOT, OPENCLAW_ROOT: root },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(bin, 'sync-to-harness')), false);
  assert.equal(existsSync(join(bin, 'kept')), true);
});

test('the pre-silo plan tools are gone, retired on --update, and nothing points at them', () => {
  const retired = readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8');
  for (const f of ['memory-plan-status.sh', 'memory-plan-timeline.sh', 'memory-plan-notify.sh']) {
    assert.equal(existsSync(join(ROOT, 'workspace-bin', f)), false, `${f} still ships`);
    assert.match(retired, new RegExp(`^workspace-bin ${f.replace(/\./g, '\\.')}$`, 'm'));
    for (const doc of ['docs/NOTIFICATIONS.md', 'workspace-bin/workplan-viewer.mjs', 'bin/health-watch.mjs']) {
      assert.ok(!readFileSync(join(ROOT, doc), 'utf8').includes(f), `${doc} still names ${f}`);
    }
  }
  assert.doesNotMatch(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /TIMELINE\.md/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'workspace-bin/memory-plan-pretty-stream.sh'), 'utf8'), /memory-plan-tick\.sh/);
});

test('pair-session and its Teams transport are retired: not shipped, not documented, archived on update', () => {
  assert.equal(existsSync(join(ROOT, 'workspace-bin/pair-session.js')), false);
  assert.equal(existsSync(join(ROOT, 'lib/pair-transport-teams.js')), false);
  assert.match(readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8'), /^workspace-bin pair-session\.js$/m);
  assert.doesNotMatch(readFileSync(join(ROOT, 'docs/OBSERVABILITY.md'), 'utf8'), /pair-transport-teams|TeamsTransport/);
});

test('skills that ship memory or code off the node are quarantined, and an --update removes installed copies', () => {
  const quarantine = readFileSync(join(ROOT, 'skills/_quarantine/README.md'), 'utf8');
  for (const s of ['second-brain', 'refactor-suggest']) {
    assert.equal(existsSync(join(ROOT, 'skills', s)), false, `${s} still ships`);
    assert.equal(existsSync(join(ROOT, 'skills/_quarantine', s, 'SKILL.md')), true, `${s} not in _quarantine`);
    assert.match(quarantine, new RegExp(`^\\| \`${s}\` \\|`, 'm'), `${s} has no README row`);
  }
  for (const s of ['memory-setup', 'memory-hygiene']) assert.equal(existsSync(join(ROOT, 'skills', s)), false, `${s} still ships`);

  const src = moduleSrc['workspace.sh'];
  const start = src.indexOf('RETIRED_SKILLS=(');
  assert.ok(start >= 0, 'workspace.sh lists retired skills');
  const block = src.slice(start, src.indexOf('\ndone\n', start) + '\ndone\n'.length);
  const ws = mkdtempSync(join(tmpdir(), 'retired-skills-'));
  for (const s of ['second-brain', 'refactor-suggest', 'memory-setup', 'memory-hygiene', 'self-reflection', 'kept']) {
    mkdirSync(join(ws, 'skills', s), { recursive: true });
    writeFileSync(join(ws, 'skills', s, 'SKILL.md'), '# x\n');
  }
  const r = spawnSync('bash', ['-euc', `run() { "$@"; }\nWORKSPACE="$1"\n${block}`, 'bash', ws], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(join(ws, 'skills')), ['kept']);
});

test('installer links scoped packages into both deployed parent trees', () => {
  const workspace = moduleSrc['workspace.sh'];
  assert.ok(workspace.includes('for scoped_dir in "$pkgdir"*/'));
  assert.ok(workspace.includes('link_dependency_tree "$MESH_NM" "$WS_NM"'));
  assert.ok(workspace.includes('link_dependency_tree "$MESH_NM" "$MESH_HOME_NM"'));
  assert.ok(moduleSrc['components.sh'].includes('$WORKSPACE/node_modules/@huggingface/transformers'));
  assert.ok(!moduleSrc['components.sh'].includes('$WORKSPACE/lib/mcp-knowledge/node_modules'));
});

test('the promotion policy ships beside the workspace lib/ that consolidation loads it from', () => {
  assert.ok(moduleSrc['workspace.sh'].includes('run cp "$REPO_DIR/config/promotion-policy.yaml" "$WORKSPACE/config/promotion-policy.yaml"'));
  assert.ok(moduleSrc['workspace.sh'].includes('run rsync -av --exclude=\'node_modules\' \\\n  "$REPO_DIR/lib/" "$WORKSPACE/lib/"'));
});

test('the installer makes ~/.openclaw/souls a git repo on main that Mission Control can commit evolutions to', () => {
  const block = moduleSrc['workspace.sh'].match(/if \[ ! -d "\$OPENCLAW_ROOT\/souls\/\.git" \]; then\n[\s\S]*?\nfi\n/)[0];
  const root = mkdtempSync(join(tmpdir(), 'souls-git-init-'));
  try {
    mkdirSync(join(root, 'souls', 'daedalus', 'evolution'), { recursive: true });
    writeFileSync(join(root, 'souls', 'daedalus', 'evolution', 'genes.json'), '{"genes":[]}');
    const script = `run() { "$@"; }\ninfo() { :; }\nOPENCLAW_ROOT=${JSON.stringify(root)}\n${block}${block}`;
    const r = spawnSync('bash', ['-c', script], { env: { ...process.env, HOME: root }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const git = (...a) => spawnSync('git', ['-C', join(root, 'souls'), ...a], { env: { ...process.env, HOME: root }, encoding: 'utf8' }).stdout.trim();
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.equal(git('status', '--porcelain'), '');
    assert.equal(git('rev-list', '--count', 'HEAD'), '1', 'a second install run leaves the existing history alone');
    assert.equal(git('config', 'user.email'), 'mission-control@openclaw.local');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scheduler heartbeat helper is installer-owned and both units invoke it', () => {
  assert.ok(moduleSrc['workspace.sh'].includes('scheduler-heartbeat.mjs'));
  assert.ok(heartbeatLaunchd.includes('${NODE_BIN}'));
  assert.ok(heartbeatLaunchd.includes('${OPENCLAW_WORKSPACE}/bin/scheduler-heartbeat.mjs'));
  assert.ok(heartbeatSystemd.includes('${NODE_BIN} ${OPENCLAW_WORKSPACE}/bin/scheduler-heartbeat.mjs'));
  assert.doesNotMatch(heartbeatLaunchd, /\/usr\/bin\/curl/);
  assert.doesNotMatch(heartbeatSystemd, /\/usr\/bin\/curl/);
  assert.doesNotMatch(`${heartbeatLaunchd}\n${heartbeatSystemd}`, /Authorization|Bearer/);
});

// The stack, the NATS user transfer and the timer-hold tooling all count
// transcript-archive among the standard timer jobs; the installer did not.
test('fresh installs schedule transcript-archive hourly on both platforms', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'services/service-manifest.json'), 'utf8'));
  const entries = manifest.filter((s) => s.name === 'openclaw-transcript-archive');
  assert.deepEqual(entries, [{ name: 'openclaw-transcript-archive', role: 'both', autostart: true, timer: true }]);
  const plist = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.transcript-archive.plist'), 'utf8');
  assert.match(plist, /<key>StartInterval<\/key><integer>3600<\/integer>/);
  const service = readFileSync(join(ROOT, 'services/systemd/openclaw-transcript-archive.service'), 'utf8');
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^ExecStart=\/bin\/sh \$\{OPENCLAW_WORKSPACE\}\/bin\/archive-transcripts\.sh$/m);
  assert.match(readFileSync(join(ROOT, 'services/systemd/openclaw-transcript-archive.timer'), 'utf8'), /^OnUnitActiveSec=3600$/m);
  assert.ok(existsSync(join(ROOT, 'workspace-bin/archive-transcripts.sh')), 'the installer copies workspace-bin/ to $WORKSPACE/bin/');
  // launchd will not start a job whose log directory is missing, and the plist
  // logs into the archive dir before the script can create it.
  const logDir = plist.match(/<key>StandardErrorPath<\/key><string>\$\{HOME\}\/\.openclaw\/([^<]+)\/[^/<]+<\/string>/)?.[1];
  assert.equal(logDir, 'transcript-archive');
  assert.equal((moduleSrc['services.sh'].match(/mkdir -p [^\n]*"\$OPENCLAW_ROOT\/transcript-archive"/g) || []).length, 1);
});

test('every timer in the service manifest ships its launchd plist and its systemd service + timer', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'services/service-manifest.json'), 'utf8'));
  for (const { name, timer } of manifest.filter((s) => s.timer)) {
    assert.equal(timer, true);
    assert.ok(existsSync(join(ROOT, `services/launchd/ai.openclaw.${name.replace(/^openclaw-/, '')}.plist`)), `${name}: launchd plist`);
    for (const ext of ['service', 'timer']) assert.ok(existsSync(join(ROOT, `services/systemd/${name}.${ext}`)), `${name}: systemd .${ext}`);
  }
});

test('every launchd nats unit execs the installer-resolved nats-server', () => {
  const dir = join(ROOT, 'services/launchd');
  const units = readdirSync(dir).filter((f) => /^ai\.openclaw\.nats(-\d)?\.plist$/.test(f));
  assert.equal(units.length, 4);
  for (const f of units) {
    const src = readFileSync(join(dir, f), 'utf8');
    assert.match(src, /<key>ProgramArguments<\/key>\s*<array>\s*<string>\$\{NATS_SERVER_BIN\}<\/string>/, f);
    assert.ok(!src.includes('/opt/homebrew/bin/nats-server'), f);
  }
});

// mesh-install.sh treats the join-token payload as untrusted: an expired token
// or one steering the clone at a foreign repo must die before touching the
// machine (no node install, no git clone). Both checks run at script top level,
// before any package manager is invoked, so they are safe to exercise here.
const MESH_INSTALL = join(ROOT, 'mesh-install.sh');
const b64url = obj => Buffer.from(JSON.stringify({ p: obj, s: 'deadbeef' })).toString('base64url');
const runMeshInstall = token => spawnSync('bash', [MESH_INSTALL], {
  encoding: 'utf8',
  env: { ...process.env, MESH_JOIN_TOKEN: token, HOME: join(ROOT, 'test', '.no-such-home') },
});

test('mesh-install.sh refuses an expired join token', () => {
  const r = runMeshInstall(b64url({ v: 3, repo: 'https://github.com/moltyguibros-design/openclaw-node.git', expires: Date.now() - 60_000 }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /expired/);
});

test('mesh-install.sh refuses a join token pointing at a repo outside the allowlist', () => {
  const r = runMeshInstall(b64url({ v: 3, repo: 'https://github.com/evil/openclaw-node.git', expires: Date.now() + 3_600_000 }));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /unrecognised repo/);
  assert.doesNotMatch(r.stdout + r.stderr, /Cloning/);
});

// P4-3: --dry-run must be dry. Run the whole installer against an empty HOME
// in sandbox mode and assert nothing under it was created. The heredoc
// writers (write_file), generate_config, service renders, sed -i edits,
// chmods and launchctl/systemctl calls all used to bypass run().
test('install.sh --dry-run writes nothing under $HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-dry-'));
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  const r = spawnSync('bash', [INSTALL_SH, '--dry-run', '--sandbox', '--role=worker'], {
    encoding: 'utf8', timeout: 300_000,
    env: { ...process.env, HOME: home, OPENCLAW_HOME: join(home, '.openclaw') },
  });
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  walk(home);
  assert.deepEqual(files, [], `dry-run created files: ${files.join(', ')}\n--- tail ---\n${r.stdout.slice(-1500)}`);
  assert.equal(r.status, 0, `dry-run must complete: exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-500)}`);
  assert.doesNotMatch(r.stdout, /SOURCE MISSING/);
});

// config.sh appended a generated token and the LLM defaults to an EXISTING env
// file with no dry-run guard; the empty-HOME run above has no env file to hit.
test('install.sh --dry-run leaves an existing env file untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-dry-env-'));
  mkdirSync(join(home, '.openclaw'), { recursive: true });
  const envFile = join(home, '.openclaw', 'openclaw.env');
  writeFileSync(envFile, 'OTHER=kept\n');
  const env = { ...process.env, HOME: home, OPENCLAW_HOME: join(home, '.openclaw') };
  delete env.OPENCLAW_NATS_TOKEN;
  const r = spawnSync('bash', [INSTALL_SH, '--dry-run', '--sandbox', '--role=worker'], { encoding: 'utf8', timeout: 300_000, env });
  assert.equal(readFileSync(envFile, 'utf8'), 'OTHER=kept\n');
  assert.equal(r.status, 0, `dry-run must complete: exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-500)}`);
});

// The Linux launcher render bypassed the dry-run guard (wrote the .desktop, or
// aborted on a headless box), and DRY_RUN_ERRORS never became the documented exit 1.
test('dry-run guards the Linux launcher render and exits 1 on a missing source', () => {
  const svc = moduleSrc['services.sh'];
  const guard = svc.indexOf('[dry-run] would install $DESKTOP_DIR/openclaw-stack.desktop');
  assert.ok(guard > svc.indexOf('DESKTOP_DIR='), 'guard must follow DESKTOP_DIR=');
  assert.ok(guard < svc.indexOf('envsubst < "$REPO_DIR/services/launcher/openclaw-stack.desktop"'), 'guard must precede the render');
  assert.match(installSrc, /if \$DRY_RUN && \[ "\$DRY_RUN_ERRORS" -gt 0 \]; then\n[^\n]*\n\s+exit 1/);
});

// The role was never persisted, and env.sh resolved it before the env file was
// read: a Linux node installed with --role=lead went back to worker on every
// --update that omitted --role.
test('env.sh reads the persisted role and config.sh persists the resolved one', () => {
  const env = moduleSrc['env.sh'];
  const start = env.indexOf('# ── Resolve node role ──');
  const end = env.indexOf('# Lead pubkey handed');
  assert.ok(start > 0 && end > start, 'role block must exist in env.sh');
  const block = env.slice(start, end);
  const root = mkdtempSync(join(tmpdir(), 'openclaw-role-'));
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_NODE_ROLE=lead\n');
  const script = `
    set -euo pipefail
    info() { :; }; error() { echo "$*" >&2; }
    NODE_ROLE=""; OS=linux; ENV_FILE="${envFile}"
    ${block}
    printf '%s|%s' "$NODE_ROLE" "$OPENCLAW_NODE_ROLE"
  `;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'lead|lead');

  // Nothing saved and no --role: refused on either OS, never a platform default.
  writeFileSync(envFile, 'OTHER=1\n');
  for (const os of ['macos', 'linux']) {
    const none = spawnSync('bash', ['-c', script.replace('OS=linux', `OS=${os}`)], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(none.status, 1, `${os}: ${none.stdout}`);
    assert.equal(none.stdout, '');
    assert.match(none.stderr, /No node role: pass --role=lead or --role=worker/);
  }
  assert.match(moduleSrc['config.sh'], /set_env_key OPENCLAW_NODE_ROLE "\$NODE_ROLE"\nfi\nexport OPENCLAW_NODE_ROLE="\$NODE_ROLE"/);
});

// config.sh trimmed env values with xargs, which exits 1 on a lone quote, so a
// value like "Gui's node" killed every install at Step 7 under set -e.
test('config.sh never overwrites a rendered config, --update or not: the render goes to <file>.new', () => {
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf('generate_config() {');
  const fn = cfg.slice(start, cfg.indexOf('\n}\n', start) + 3);
  const dir = mkdtempSync(join(tmpdir(), 'oc-genconfig-'));
  const template = join(dir, 'openclaw.json.template');
  const out = join(dir, 'openclaw.json');
  writeFileSync(template, '{"node":"${OPENCLAW_NODE_ID}","auth":{"profiles":{}}}\n');
  const gen = (update) => spawnSync('bash', ['-c', `set -eo pipefail
info() { echo "INFO $*"; }; warn() { echo "WARN $*"; }; run() { "$@"; }
${fn}
generate_config "$1" "$2"`, 'x', template, out], {
    encoding: 'utf8',
    env: { ...process.env, DRY_RUN: 'false', UPDATE_ONLY: String(update), OPENCLAW_NODE_ID: 'n1', HOME: dir, WORKSPACE: dir, REPO_DIR: dir },
  });
  const fresh = '{"node":"n1","auth":{"profiles":{}}}\n';
  let r = gen(false);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, 'utf8'), fresh);
  assert.equal(statSync(out).mode & 0o777, 0o600);

  r = gen(true);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /openclaw\.json up to date/);
  assert.ok(!existsSync(`${out}.new`), 'an unchanged render leaves no .new');

  const operator = '{"node":"n1","auth":{"profiles":{"default":{"provider":"configured"}}}}\n';
  writeFileSync(out, operator);
  for (const update of [true, false]) {
    r = gen(update);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(out, 'utf8'), operator, `--update=${update} overwrote the operator's config`);
    assert.equal(readFileSync(`${out}.new`, 'utf8'), fresh);
    assert.equal(statSync(`${out}.new`).mode & 0o777, 0o600);
    assert.match(r.stdout, /WARN Config openclaw\.json differs .* openclaw\.json\.new/);
  }
  assert.match(cfg, /\[ -n "\$CLUSTER_PEERS" \] \|\| generate_config "\$REPO_DIR\/services\/nats\/nats-single\.conf"/);
});

// A cluster node's --update ran without --cluster-peers and rendered the
// single-node nats.conf (as .new), since the peers and bind were never saved.
test('config.sh saves the cluster peers and bind, and a flagless --update re-renders the cluster nats.conf', () => {
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf("# A cluster node's peers and bind address");
  const end = cfg.indexOf('generate_config "$REPO_DIR/config/obsidian-sync.json.template"');
  assert.ok(start > 0 && end > start, 'NATS render block must exist in config.sh');
  const block = cfg.slice(start, end);
  const root = mkdtempSync(join(tmpdir(), 'oc-cluster-'));
  mkdirSync(join(root, 'config'));
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_NATS_TOKEN=tok\n');
  const conf = join(root, 'config', 'nats.conf');
  const run = (flags) => spawnSync('bash', ['-c', `set -euo pipefail
step() { :; }; info() { echo "INFO $*"; }; warn() { echo "WARN $*"; }; error() { echo "ERR $*" >&2; }
run() { "$@"; }; generate_config() { echo "GEN $(basename "$2")"; }
while IFS='=' read -r k v; do export "$k=$v"; done < "$ENV_FILE"
${block}`], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH, HOME: root, OPENCLAW_ROOT: root, ENV_FILE: envFile, REPO_DIR: ROOT,
      DRY_RUN: 'false', OPENCLAW_NODE_ID: 'n1', CLUSTER_PEERS: '', CLUSTER_BIND: '', ...flags,
    },
  });

  let r = run({ CLUSTER_PEERS: '100.64.0.2,100.64.0.3', CLUSTER_BIND: '100.64.0.1' });
  assert.equal(r.status, 0, r.stderr);
  const env = readFileSync(envFile, 'utf8');
  assert.match(env, /^OPENCLAW_NATS_CLUSTER_PEERS=100\.64\.0\.2,100\.64\.0\.3$/m);
  assert.match(env, /^OPENCLAW_NATS_CLUSTER_BIND=100\.64\.0\.1$/m);
  const rendered = readFileSync(conf, 'utf8');
  assert.match(rendered, /100\.64\.0\.1/);
  assert.match(rendered, /100\.64\.0\.3/);

  r = run({});
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /GEN nats\.conf/, 'a cluster node must not get the single-node render');
  assert.match(r.stdout, /nats\.conf up to date/);
  assert.equal(readFileSync(conf, 'utf8'), rendered);
  assert.ok(!existsSync(`${conf}.new`), 'an unchanged cluster render leaves no .new');

  const operator = rendered + '# operator edit\n';
  writeFileSync(conf, operator);
  r = run({});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(conf, 'utf8'), operator, 'a flagless --update kept the operator edit');
  assert.equal(readFileSync(`${conf}.new`, 'utf8'), rendered);
  rmSync(root, { recursive: true, force: true });
});

test('config.sh env-file parse keeps quotes, spacing and backslashes like renderConfigTemplate', () => {
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf('# Source env file for config generation');
  const end = cfg.indexOf('# Persist the node id');
  assert.ok(start > 0 && end > start, 'env-file loop must exist in config.sh');
  const root = mkdtempSync(join(tmpdir(), 'openclaw-envparse-'));
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, [`NAME=Gui's node`, 'Q="quoted value"', "S='single'", '  SPACED  =  a  b  ', 'B=a\\b', ''].join('\n'));
  const script = `set -euo pipefail\n${cfg.slice(start, end)}\nprintf '%s|%s|%s|%s|%s' "$NAME" "$Q" "$S" "$SPACED" "$B"`;
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: envFile } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "Gui's node|quoted value|single|a  b|a\\b");
});

// P7-0: the deploy/operator trust allowlists must be seeded with the RAW base64
// identity pubkey (what trustedDeployKeys() compares), not the SPKI PEM text of
// identity.pub — that mismatch made strict signed deploy refuse every trigger on
// installed nodes. Run the exact shell functions config.sh uses, against a temp
// identity, then prove a trigger signed by that identity verifies under the
// seeded allowlist. Merge semantics: operator-added keys survive, no duplicates.
test('config.sh seeds trust allowlists with the raw base64 identity pubkey and merges', async () => {
  const { getOrCreateIdentity } = await import('../lib/node-identity.mjs');
  const { signDeployTrigger, verifyDeployTrigger } = await import('../lib/deploy-trigger-auth.mjs');
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf('identity_pubkey_base64() {');
  const end = cfg.indexOf('# Deploy-trigger trust');
  assert.ok(start > 0 && end > start, 'seeding helpers must exist in config.sh');
  const helpers = cfg.slice(start, end);

  const root = mkdtempSync(join(tmpdir(), 'openclaw-trust-'));
  const identity = getOrCreateIdentity(root);
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_DEPLOY_TRUSTED_KEYS=operatorKeyAAA\n');

  const script = `
    set -euo pipefail
    run() { "$@"; }
    ${helpers}
    SELF="$(identity_pubkey_base64)"
    merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS "$SELF"
    merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS "$SELF"
    merge_trusted_key OPENCLAW_OPERATOR_TRUSTED_KEYS "$SELF"
    printf '%s' "$SELF"
  `;
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, OPENCLAW_ROOT: root, REPO_DIR: ROOT, NODE_BIN: process.execPath, ENV_FILE: envFile },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, identity.publicKeyBase64);
  assert.equal(r.stdout.length, 44);
  assert.doesNotMatch(r.stdout, /BEGIN PUBLIC KEY/);

  const env = readFileSync(envFile, 'utf8');
  const deploy = env.match(/^OPENCLAW_DEPLOY_TRUSTED_KEYS=(.*)$/m)[1];
  assert.equal(deploy, `operatorKeyAAA,${identity.publicKeyBase64}`, 'merge keeps operator keys, adds ours once');
  assert.equal(env.match(/^OPENCLAW_OPERATOR_TRUSTED_KEYS=(.*)$/m)[1], identity.publicKeyBase64);

  const signed = signDeployTrigger({ sha: 'abc123', node_id: 'ci' }, { identityDir: root });
  const ok = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: deploy.split(','), seenIds: null });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const pem = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [readFileSync(join(root, 'identity.pub'), 'utf8').replace(/\n/g, '')], seenIds: null });
  assert.equal(pem.ok, false, 'the PEM text must NOT be accepted as a trusted key (the old bug)');
});

// Virgin-Mac run of 2026-09-07: under `curl | bash` a child (the Homebrew
// installer) read the pipe bash was still reading its program from, the
// script printed its own source mid-run and stopped after the Tailscale step;
// install.sh never started. The fix is structural — the whole script is one
// function invoked on the last line, so bash parses everything before any
// child runs — and structure is what this locks. The Tailscale cask ships the
// CLI inside the app bundle, so the bootstrap must link it onto PATH.
test('bootstrap.sh is pipe-safe: one main() parsed in full before anything runs', () => {
  const src = readFileSync(join(ROOT, 'bootstrap.sh'), 'utf8');
  const lines = src.split('\n');
  const code = lines.filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.equal(code[code.length - 1].trim(), 'main "$@"', 'last statement must invoke main');
  const mainAt = lines.findIndex((l) => l === 'main() {');
  assert.ok(mainAt > 0, 'main() must be defined');
  // Nothing but shebang, comments, blank lines and the pipefail/set line may precede main().
  const before = lines.slice(0, mainAt).filter((l) => l.trim() && !l.trim().startsWith('#'));
  assert.deepEqual(before, ['set -o pipefail'], `top-level code before main(): ${before.join(' | ')}`);
  assert.equal(spawnSync('bash', ['-n', join(ROOT, 'bootstrap.sh')], { encoding: 'utf8' }).status, 0);
  // Every brew install is cut off from the pipe, and the Tailscale CLI gets linked.
  for (const m of src.matchAll(/^\s*brew install [^\n]*$/gm)) {
    assert.match(m[0], /<\/dev\/null/, `brew install must not read stdin: ${m[0].trim()}`);
  }
  assert.match(src, /Tailscale\.app\/Contents\/MacOS\/Tailscale/);
  assert.match(src, /link_tailscale_cli\n/);
  assert.match(moduleSrc['prereqs.sh'] ?? readFileSync(join(ROOT, 'scripts/install/prereqs.sh'), 'utf8'), /Tailscale\.app\/Contents\/MacOS\/Tailscale/);
});

// install.sh reaches prereqs.sh directly (system-deps.sh), so a node installed
// without bootstrap.sh must get the same verified bus binary.
test('prereqs.sh verifies nats-server with the same pinned SHA256 as bootstrap.sh', () => {
  const prereqs = readFileSync(join(ROOT, 'scripts/install/prereqs.sh'), 'utf8');
  const bootstrap = readFileSync(join(ROOT, 'bootstrap.sh'), 'utf8');
  const re = /(2\.12\.6-(?:amd64|arm64))\) EXPECT_SHA="([0-9a-f]{64})"/g;
  const pins = (src) => [...src.matchAll(re)].map((m) => m.slice(1));
  assert.equal(pins(bootstrap).length, 2);
  assert.deepEqual(pins(prereqs), pins(bootstrap));
  assert.doesNotMatch(prereqs, /nats-server[^\n]*\|\s*tar/);
  assert.match(prereqs, /\*\) EXPECT_SHA="\$\{OPENCLAW_NATS_SERVER_SHA256:-\}"/);
  assert.match(prereqs, /sha256sum "\$TGZ"/);
  assert.match(prereqs, /if \[ "\$ACTUAL_SHA" != "\$EXPECT_SHA" \]; then\n\s*error "nats-server checksum MISMATCH/);
});

// The same virgin-Mac run: install.sh never compiled packages/event-schemas
// (dist/ is gitignored, the tarball ships .ts only, --omit=dev brings no tsc),
// so the memory daemon exited at startup. env.sh must build it and refuse to
// hand over a tree without dist/index.js.
test('env.sh builds the event-schemas dist the memory daemon needs at startup', () => {
  const env = moduleSrc['env.sh'];
  assert.match(env, /packages\/event-schemas\/dist\/index\.js/);
  assert.match(env, /npx --yes --package typescript@5 tsc -p packages\/event-schemas\/tsconfig\.json/);
  assert.match(env, /event-schemas build produced no dist\/index\.js[^\n]*\n\s*exit 1/);
  // The daemon's loader is the reason this matters: it fails loud on a missing dist.
  assert.match(readFileSync(join(ROOT, 'lib/event-schemas.mjs'), 'utf8'), /event-schemas dist missing/);
});

// Provider-agnostic install (2026-09-08). The runtime drives nine providers
// (lib/llm-providers.js); the installer used to detect three and silently
// `npm install -g` one vendor's CLI when none was found, and the env example
// shipped that vendor as the default. Lock the agnostic behaviour.
test('installer seats the operator\'s provider and never installs a vendor CLI unasked', () => {
  assert.ok(FLAGS.includes('--provider='));
  const env = moduleSrc['env.sh'];
  assert.match(env, /KNOWN_PROVIDERS="claude openai gemini deepseek kimi minimax aider ollama shell"/);
  assert.match(env, /for p in claude openai gemini deepseek kimi minimax aider; do/, 'detection covers every CLI-backed provider');
  const comp = moduleSrc['components.sh'];
  assert.doesNotMatch(comp, /Installing the default frontend/);
  assert.doesNotMatch(comp, /for fe in claude codex gemini; do/, 'the three-vendor detection loop is gone');
  // Every npm install of a vendor CLI sits inside the operator-chosen case arm.
  assert.match(comp, /claude\) PKG="@anthropic-ai\/claude-code" ;;/);
  assert.match(comp, /openai\) PKG="@openai\/codex" ;;/);
  assert.match(comp, /gemini\) PKG="@google\/gemini-cli" ;;/);
  assert.equal((comp.match(/npm install -g "\$PKG"/g) || []).length, 2, 'the only vendor installs are PKG-driven');
  assert.doesNotMatch(comp, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(comp, /9\) none for now/);
  assert.match(comp, /exec 3<\/dev\/tty/, 'the prompt reads the terminal, not the piped script');
  assert.doesNotMatch(moduleSrc['config.sh'], /MESH_LLM_PROVIDER=claude/);
  const example = readFileSync(join(ROOT, 'openclaw.env.example'), 'utf8');
  assert.doesNotMatch(example, /^MESH_LLM_PROVIDER=\w+/m, 'no vendor default in the env example');
  const llm = readFileSync(join(ROOT, 'scripts/install/llm-setup.sh'), 'utf8');
  assert.match(llm, /--endpoint\) ENDPOINT="\$2"/);
  assert.match(llm, /\[e\] use an OpenAI-compatible endpoint/);
});

// Virgin-Mac wave 2 (2026-09-08): the embedder prefetch failed and printed only
// "prefetch failed", discarding core.mjs's precise cause (403 / offline / disk).
// A cold embedder then fails MEM-L2-INJECT on the next gate run with no
// explanation, so the reason must survive and the retry must not re-pull a model.
test('llm-setup keeps the embedder failure reason and offers a model-free retry', () => {
  const llm = readFileSync(join(ROOT, 'scripts/install/llm-setup.sh'), 'utf8');
  assert.match(llm, /EMBED_LOG="\$OPENCLAW_ROOT\/logs\/embedder-prefetch\.log"/);
  assert.match(llm, />"\$EMBED_LOG" 2>&1; then/, 'prefetch output is captured, not discarded');
  assert.match(llm, /grep -E 'Error\|error:\|ENOSPC\|EACCES\|ENOTFOUND\|Forbidden\|denied\|timed out' "\$EMBED_LOG"/);
  assert.match(llm, /--embedder-only\) MODE=embedder ;;/);
  // The retry needs neither ollama nor a model pull.
  assert.match(llm, /if \[ "\$MODE" != embedder \] && \[ -z "\$ENDPOINT" \]; then\n\s+have ollama \|\|/);
  assert.match(llm, /elif \[ "\$MODE" = embedder \]; then\n\s+# --embedder-only/);
});

// A re-run of install.sh (--update included) rsynced souls/ over ~/.openclaw/souls and reset
// every soul's approved genes and evolution log to the repo seed. mesh-deploy's souls
// component already treats those two files as seed-only.
test('installer seeds but never overwrites learned soul genes/events', (t) => {
  if (spawnSync('rsync', ['--version']).status !== 0) {
    t.skip('rsync not on PATH');
    return;
  }
  const repo = mkdtempSync(join(tmpdir(), 'oc-souls-repo-'));
  const root = mkdtempSync(join(tmpdir(), 'oc-souls-root-'));
  const put = (base, rel, body) => {
    mkdirSync(dirname(join(base, rel)), { recursive: true });
    writeFileSync(join(base, rel), body);
  };
  put(repo, 'souls/daedalus/evolution/genes.json', '{"genes":"seed"}\n');
  put(repo, 'souls/daedalus/evolution/events.jsonl', '{"event":"seed"}\n');
  put(repo, 'souls/daedalus/SOUL.md', 'soul v2 longer\n');
  put(repo, 'souls/newcomer/evolution/genes.json', '{"genes":"newcomer seed"}\n');
  put(root, 'souls/daedalus/evolution/genes.json', '{"genes":"learned on this node"}\n');
  put(root, 'souls/daedalus/evolution/events.jsonl', '{"event":"learned on this node"}\n');
  put(root, 'souls/daedalus/SOUL.md', 'soul v1\n');

  const lines = moduleSrc['workspace.sh'].split('\n').filter((l) => l.startsWith('run rsync') && l.includes('/souls/'));
  assert.ok(lines.length > 0, 'workspace.sh has a souls rsync');
  const r = spawnSync('bash', ['-c', 'run() { "$@"; }\n' + lines.join('\n')], {
    encoding: 'utf8',
    env: { ...process.env, REPO_DIR: repo, OPENCLAW_ROOT: root },
  });
  assert.equal(r.status, 0, r.stderr);

  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  assert.equal(read('souls/daedalus/evolution/genes.json'), '{"genes":"learned on this node"}\n');
  assert.equal(read('souls/daedalus/evolution/events.jsonl'), '{"event":"learned on this node"}\n');
  assert.equal(read('souls/daedalus/SOUL.md'), 'soul v2 longer\n');
  assert.equal(read('souls/newcomer/evolution/genes.json'), '{"genes":"newcomer seed"}\n');
});

test('installer archives the retired files it once shipped, never backups or operator tools', () => {
  const repo = mkdtempSync(join(tmpdir(), 'oc-retire-repo-'));
  const root = mkdtempSync(join(tmpdir(), 'oc-retire-root-'));
  const bin = join(root, 'workspace', 'bin');
  mkdirSync(join(repo, 'scripts/install'), { recursive: true });
  writeFileSync(join(repo, 'scripts/install/retired-files.txt'),
    '# comment\nworkspace-bin daily-log-writer.mjs\nworkspace-bin brainstorm-server\nworkspace-bin old.bak\nworkspace-bin ../escape\nmesh-bin daily-log-writer.mjs\n');
  mkdirSync(join(bin, 'brainstorm-server'), { recursive: true });
  writeFileSync(join(bin, 'brainstorm-server', 'index.js'), 'srv\n');
  for (const f of ['daily-log-writer.mjs', 'daily-log-writer.mjs.bak', 'old.bak', 'my-own-tool']) writeFileSync(join(bin, f), `${f}\n`);
  writeFileSync(join(root, 'workspace', 'escape'), 'outside\n');
  const retire = () => spawnSync('bash', ['-c', `source "${join(ROOT, 'scripts/install/helpers.sh')}"; retire_shipped_files workspace-bin "$1"`, 'x', bin], {
    encoding: 'utf8', env: { ...process.env, DRY_RUN: 'false', REPO_DIR: repo, OPENCLAW_ROOT: root },
  });
  let r = retire();
  assert.equal(r.status, 0, r.stderr);
  const dated = readdirSync(join(root, 'retired'));
  assert.equal(dated.length, 1);
  const archive = join(root, 'retired', dated[0], 'workspace-bin');
  assert.deepEqual(readdirSync(archive).sort(), ['brainstorm-server', 'daily-log-writer.mjs']);
  assert.equal(readFileSync(join(archive, 'brainstorm-server', 'index.js'), 'utf8'), 'srv\n');
  assert.deepEqual(readdirSync(bin).sort(), ['daily-log-writer.mjs.bak', 'my-own-tool', 'old.bak']);
  assert.ok(existsSync(join(root, 'workspace', 'escape')));

  writeFileSync(join(bin, 'daily-log-writer.mjs'), 'shipped again\n');
  r = retire();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /left in place/);
  assert.equal(readFileSync(join(archive, 'daily-log-writer.mjs'), 'utf8'), 'daily-log-writer.mjs\n', 'an archived copy is never overwritten');

  // A mesh home that is the checkout itself is never pruned.
  mkdirSync(join(repo, 'bin'));
  writeFileSync(join(repo, 'bin', 'daily-log-writer.mjs'), 'in the checkout\n');
  r = spawnSync('bash', ['-c', `source "${join(ROOT, 'scripts/install/helpers.sh')}"; retire_shipped_files mesh-bin "$1"`, 'x', join(repo, 'bin')], {
    encoding: 'utf8', env: { ...process.env, DRY_RUN: 'false', REPO_DIR: repo, OPENCLAW_ROOT: root },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(repo, 'bin', 'daily-log-writer.mjs')));
});

test('the retired list names only files the repo no longer ships, and both deploy dirs are pruned', () => {
  const entries = readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8').split('\n')
    .filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/));
  assert.ok(entries.length > 0);
  const source = { 'workspace-bin': 'workspace-bin', 'mesh-bin': 'bin' };
  for (const [group, name] of entries) {
    assert.ok(source[group], `unknown group ${group}`);
    assert.ok(!existsSync(join(ROOT, source[group], name)), `${group} ${name} is still shipped`);
    if (group === 'workspace-bin') assert.ok(!existsSync(join(ROOT, 'bin', name)) || !moduleSrc['workspace.sh'].includes(` ${name}`), `${name} is still copied into the workspace`);
  }
  assert.ok(moduleSrc['workspace.sh'].includes('retire_shipped_files workspace-bin "$WORKSPACE/bin"'));
  assert.ok(moduleSrc['workspace.sh'].includes('retire_shipped_files mesh-bin "$MESH_BIN"'));
  assert.ok(!readFileSync(join(ROOT, 'docs/OBSERVABILITY.md'), 'utf8').includes('daily-log-writer'));
});

test('documented node-watch invocations only use flags node-watch accepts', () => {
  const cli = readFileSync(join(ROOT, 'bin/node-watch.mjs'), 'utf8');
  const optionsBlock = cli.slice(cli.indexOf('options: {'), cli.indexOf('\n    },\n'));
  const accepted = new Set([...optionsBlock.matchAll(/^\s+'?([a-z-]+)'?: \{ type:/gm)].map((m) => m[1]));
  assert.ok(accepted.has('watch') && accepted.has('quiet'), 'the parseArgs options block was found');
  for (const doc of ['install.sh', 'docs/NODE_SPEC.md', 'docs/INSTALL_TEST_PROTOCOL.md']) {
    const text = readFileSync(join(ROOT, doc), 'utf8');
    for (const m of text.matchAll(/node-watch\.mjs((?:[ \t]+--[a-z-]+)+)/g)) {
      for (const flag of m[1].trim().split(/\s+/)) {
        assert.ok(accepted.has(flag.slice(2)), `${doc}: node-watch.mjs has no ${flag} flag`);
      }
    }
  }
});

test('INSTALL_TEST_PROTOCOL T2 greps the stderr file each memory-daemon unit writes', () => {
  const doc = readFileSync(join(ROOT, 'docs/INSTALL_TEST_PROTOCOL.md'), 'utf8');
  const unit = readFileSync(join(ROOT, 'services/systemd/openclaw-memory-daemon.service'), 'utf8');
  const plist = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.memory-daemon.plist'), 'utf8');
  const linuxErr = unit.match(/^StandardError=append:\$\{OPENCLAW_WORKSPACE\}\/\.tmp\/(\S+)$/m)[1];
  const macErr = plist.match(/<key>StandardErrorPath<\/key>\s*<string>\$\{OPENCLAW_WORKSPACE\}\/\.tmp\/([^<]+)<\/string>/)[1];
  const grepLine = doc.split('\n').find((l) => l.startsWith('grep -c ERR_MODULE_NOT_FOUND'));
  // The '/.tmp/' prefix keeps memory-daemon.err from matching inside openclaw-memory-daemon.err.
  for (const f of [linuxErr, macErr]) assert.ok(grepLine.includes(`/.tmp/${f}`), `T2 grep misses ${f}`);
});

test('README env table agrees with the installer defaults', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(moduleSrc['config.sh'], /OPENCLAW_TIMEZONE="\$\{OPENCLAW_TIMEZONE:-America\/Montreal\}"/);
  assert.doesNotMatch(readme, /^\| `OPENCLAW_TIMEZONE` \| Yes \|/m, 'a defaulted key is not required');
  assert.doesNotMatch(readme, /for all available configuration/);
});

// health-watch was hand-installed on one node only, yet node-watch's
// diagnostics probe and the observer's core roster require it everywhere.
test('every manifest unit ships its templates, execs a deployed entrypoint, and renders the node id', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'services/service-manifest.json'), 'utf8'));
  assert.ok(manifest.some((s) => s.name === 'openclaw-health-watch' && s.role === 'both' && s.autostart),
    'health-watch is a standard unit on every node');
  const loop = moduleSrc['workspace.sh'].match(/for _wsbin in ([^;]+); do/);
  assert.ok(loop, 'workspace.sh copy loop parsed');
  const copied = new Set(loop[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean));
  const deployed = (script) => copied.has(script) || existsSync(join(ROOT, 'workspace-bin', script));

  for (const { name, timer } of manifest) {
    const files = [
      `launchd/ai.openclaw.${name.replace(/^openclaw-/, '')}.plist`,
      `systemd/${name}.service`,
      ...(timer ? [`systemd/${name}.timer`] : []),
    ];
    for (const f of files) {
      const path = join(ROOT, 'services', f);
      assert.ok(existsSync(path), `${name}: ${f} missing`);
      const text = readFileSync(path, 'utf8');
      for (const [, script] of text.matchAll(/\$\{OPENCLAW_WORKSPACE\}\/bin\/([\w.-]+\.(?:mjs|js|sh|py))/g)) {
        assert.ok(deployed(script), `${f} execs ${script}, which the installer never deploys`);
      }
      const nodeId = text.match(/<key>OPENCLAW_NODE_ID<\/key>\s*<string>([^<]*)<\/string>/)?.[1]
        ?? text.match(/^Environment=OPENCLAW_NODE_ID=(.*)$/m)?.[1];
      if (nodeId !== undefined) assert.equal(nodeId, '${OPENCLAW_NODE_ID}', `${f} hardcodes its node id`);
    }
  }
});

// OPENCLAW_TIMEZONE is a per-node setting: a unit that sets TZ renders it.
test('unit templates and the daemon installer render TZ from OPENCLAW_TIMEZONE', () => {
  const templates = [
    ...readdirSync(join(ROOT, 'services/systemd')).map((f) => `systemd/${f}`),
    ...readdirSync(join(ROOT, 'services/launchd')).filter((f) => f.startsWith('ai.openclaw.')).map((f) => `launchd/${f}`),
  ];
  let withTz = 0;
  for (const f of templates) {
    const text = readFileSync(join(ROOT, 'services', f), 'utf8');
    const tz = text.match(/^Environment=TZ=(.*)$/m)?.[1]
      ?? text.match(/<key>TZ<\/key>\s*<string>([^<]*)<\/string>/)?.[1];
    if (tz === undefined) continue;
    withTz++;
    assert.equal(tz, '${OPENCLAW_TIMEZONE}', `${f} pins TZ=${tz}`);
  }
  assert.ok(withTz >= 20, `TZ-setting templates found: ${withTz}`);
  for (const f of ['workspace-bin/memory-maintenance.mjs', 'workspace-bin/session-recap', 'bin/discord-read.js',
    'workspace-bin/proactive-scan', 'workspace-bin/memory-daemon.mjs']) {
    const code = readFileSync(join(ROOT, f), 'utf8')
      .split('\n').filter((l) => !/^\s*(?:\/\/|#|\*)/.test(l)).join('\n')
      .replace(/process\.env\.OPENCLAW_TIMEZONE \|\| process\.env\.TZ \|\| (['"])America\/Montreal\1/g, '');
    assert.doesNotMatch(code, /America\\?\/Montreal/, `${f} pins the zone instead of reading OPENCLAW_TIMEZONE`);
  }
});

// daemon.json's timezone governed only the daily file name and the Phase 1
// stamp; the log stamps and the children's TZ kept the unit's zone, and the
// children read OPENCLAW_TIMEZONE first, so a TZ alone did not reach them.
test('the memory daemon applies daemon.json timezone to its log stamps and its children', () => {
  const daemon = readFileSync(join(ROOT, 'workspace-bin/memory-daemon.mjs'), 'utf8');
  assert.match(daemon, /const config = loadConfig\(\);\n  timezone = config\.timezone;/);
  const stamp = daemon.match(/function timestamp\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(stamp, /timeZone: timezone,/);
  const spawnEnv = daemon.match(/function runSubprocess\([\s\S]*?stdio:/)[0];
  assert.match(spawnEnv, /OPENCLAW_TIMEZONE: timezone,/);
  assert.match(spawnEnv, /TZ: timezone,/);
  for (const text of [daemon, readFileSync(join(ROOT, 'config/daemon.json.template'), 'utf8')]) {
    assert.doesNotMatch(text, /obsidianVault/, 'a key nothing reads implies a setting that does nothing');
  }
});

// install_rule compared the local copy with the NEW source on a version bump;
// an unmodified copy always differs from a newer version, so shipped rule
// updates never landed and every bump wrote .new with a false "modified" warning.
test('install_rule updates unmodified rules on a version bump and keeps edited ones', () => {
  const src = moduleSrc['integrations.sh'];
  const start = src.indexOf('run mkdir -p "$RULES_DIR"\n') + 'run mkdir -p "$RULES_DIR"\n'.length;
  const fns = src.slice(start, src.indexOf('\n}\n', src.indexOf('install_rule() {')) + 3);
  const dir = mkdtempSync(join(tmpdir(), 'openclaw-rule-'));
  const s = join(dir, 'src.md');
  const d = join(dir, 'rule.md');
  const install = () => spawnSync('bash', ['-c', [
    'DRY_RUN=false',
    `source ${JSON.stringify(join(ROOT, 'scripts/install/helpers.sh'))}`,
    fns,
    `install_rule ${JSON.stringify(s)} ${JSON.stringify(d)} rule.md`,
  ].join('\n')], { encoding: 'utf8' });
  const ship = (v, body = 'body') => writeFileSync(s, `---\nversion: ${v}\n---\n${body}\n`);

  ship('1.0.0');
  assert.equal(install().status, 0);
  assert.ok(existsSync(`${d}.sha`), 'fresh install records the installed hash');

  ship('1.1.0');
  let r = install();
  assert.match(readFileSync(d, 'utf8'), /version: 1\.1\.0/, r.stdout);
  assert.ok(!existsSync(`${d}.new`));
  assert.doesNotMatch(r.stdout, /modified/);

  writeFileSync(d, readFileSync(d, 'utf8') + 'local edit\n');
  ship('1.2.0');
  r = install();
  assert.match(readFileSync(d, 'utf8'), /version: 1\.1\.0[\s\S]*local edit/);
  assert.match(readFileSync(`${d}.new`, 'utf8'), /version: 1\.2\.0/);
  assert.match(r.stdout, /local copy modified/);

  // A copy installed before records existed is backfilled while pristine.
  writeFileSync(d, readFileSync(s, 'utf8'));
  rmSync(`${d}.sha`);
  rmSync(`${d}.new`);
  install();
  ship('1.3.0');
  install();
  assert.match(readFileSync(d, 'utf8'), /version: 1\.3\.0/);
  assert.ok(!existsSync(`${d}.new`));
});

// Steps 18/20 used to read framework markers from the installer's cwd (or
// $HOME) and copy git hooks into cwd's or $HOME's .git/hooks, so hooks landed
// in unrelated repositories. Both now follow --project=PATH only.
function runIntegrations({ cwd, home, project }) {
  const script = [
    `REPO_DIR=${JSON.stringify(ROOT)}`,
    `OPENCLAW_ROOT=${JSON.stringify(join(home, '.openclaw'))}`,
    'WORKSPACE="$OPENCLAW_ROOT/workspace"',
    'DRY_RUN=false; SKIP_MESH=true',
    `PROJECT_DIR=${JSON.stringify(project ?? '')}`,
    'mkdir -p "$WORKSPACE"',
    `source ${JSON.stringify(join(ROOT, 'scripts/install/helpers.sh'))}`,
    `source ${JSON.stringify(join(ROOT, 'scripts/install/integrations.sh'))}`,
  ].join('\n');
  return spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
}

function fakeRepo(root) {
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"devDependencies":{"hardhat":"1"}}');
  writeFileSync(join(root, 'tsconfig.json'), '{}');
  return root;
}

test('installer touches neither cwd nor $HOME repos without --project', () => {
  const base = mkdtempSync(join(tmpdir(), 'openclaw-proj-'));
  const home = fakeRepo(join(base, 'home'));
  const cwd = fakeRepo(join(base, 'cwd'));
  const r = runIntegrations({ cwd, home });
  assert.equal(r.status, 0, r.stderr);
  for (const repo of [home, cwd]) {
    assert.deepEqual(readdirSync(join(repo, '.git', 'hooks')), [], `${repo} got git hooks`);
  }
  const rules = readdirSync(join(home, '.openclaw', 'rules'));
  assert.ok(rules.includes('security.md'), 'universal rules still install');
  assert.ok(!rules.includes('typescript.md') && !rules.includes('solidity.md'), `framework rules from cwd: ${rules}`);
});

test('--project drives framework rules and git hooks', () => {
  const base = mkdtempSync(join(tmpdir(), 'openclaw-proj-'));
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  const project = fakeRepo(join(base, 'project'));
  const cwd = fakeRepo(join(base, 'cwd'));
  const r = runIntegrations({ cwd, home, project });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(join(project, '.git', 'hooks')).sort(), ['pre-commit', 'pre-push']);
  assert.deepEqual(readdirSync(join(cwd, '.git', 'hooks')), []);
  const rules = readdirSync(join(home, '.openclaw', 'rules'));
  assert.ok(rules.includes('typescript.md') && rules.includes('solidity.md'), `rules: ${rules}`);
  assert.ok(!rules.includes('unity.md'));
});

// `install.sh --update` re-synced Mission Control's source but kept the old
// .next, ran a loose `npm install`, never deleted routes removed from the repo,
// and the unit's PATH could resolve a node other than the one the native deps
// were built for. It now follows workspace-docs/RUNBOOK_MC_DEPLOY.md.
test('install --update redeploys Mission Control: exact sync, npm@10 ci, rebuild under NODE_BIN, build kept on failure', () => {
  const comp = moduleSrc['components.sh'];
  const block = comp.slice(comp.indexOf('MC_DIR="$WORKSPACE/projects/mission-control"'),
    comp.indexOf('# Create .env.local for MC if not exists'));
  assert.ok(block.includes('mc_build'), 'the Mission Control step must be found');

  const root = mkdtempSync(join(tmpdir(), 'openclaw-mc-update-'));
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  const read = (rel) => readFileSync(join(root, rel), 'utf8');
  const mc = 'ws/projects/mission-control';
  put('repo/mission-control/package.json', '{"name":"mc"}\n');
  put('repo/mission-control/src/app/page.tsx', 'new page, v2\n');
  put(`${mc}/src/app/page.tsx`, 'old page\n');
  put(`${mc}/src/app/api/removed/route.ts`, 'deleted from the repo\n');
  put(`${mc}/.env.local`, 'DB_PATH=data/mission-control.db\n');
  put(`${mc}/data/mission-control.db`, 'live rows\n');
  put(`${mc}/node_modules/.package-lock.json`, '{}\n');
  put(`${mc}/.next/BUILD_ID`, 'old build\n');
  put('nodebin/node', '');
  const calls = join(root, 'calls.log');
  for (const name of ['npx', 'npm']) {
    put(`fakebin/${name}`, `#!/bin/sh
echo "${name} $* PATH0=\${PATH%%:*}" >> "${calls}"
if [ "$*" = "run build" ]; then
  mkdir -p .next && echo partial > .next/BUILD_ID
  [ -n "\${MC_TEST_BUILD_FAIL:-}" ] && exit 1
  echo new build > .next/BUILD_ID
fi
exit 0
`);
    spawnSync('chmod', ['+x', join(root, 'fakebin', name)]);
  }
  const script = `
    set -euo pipefail
    DRY_RUN=false SANDBOX=false UPDATE_ONLY=true
    info() { :; }; warn() { echo "WARN $*"; }; run() { "$@"; }
    WORKSPACE="${root}/ws" REPO_DIR="${root}/repo" NODE_BIN="${root}/nodebin/node" NODE_BIN_DIR="${root}/nodebin"
    ${block}
  `;
  const install = (env = {}) => spawnSync('bash', ['-c', script], {
    encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'fakebin')}:${process.env.PATH}`, ...env },
  });

  const first = install();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.equal(read(`${mc}/src/app/page.tsx`), 'new page, v2\n');
  assert.equal(existsSync(join(root, mc, 'src/app/api/removed')), false, 'a route deleted from the repo leaves the live tree');
  assert.equal(read(`${mc}/.env.local`), 'DB_PATH=data/mission-control.db\n');
  assert.equal(read(`${mc}/data/mission-control.db`), 'live rows\n');
  assert.equal(read(`${mc}/.next/BUILD_ID`), 'new build\n', 'the build is redone, not kept');
  assert.equal(existsSync(join(root, mc, '.next.prev')), false);
  const nodeDir = join(root, 'nodebin');
  assert.deepEqual(read('calls.log').trim().split('\n'), [
    `npx -y npm@10 ci PATH0=${nodeDir}`,
    `npm rebuild better-sqlite3 PATH0=${nodeDir}`,
    `npm run build PATH0=${nodeDir}`,
  ]);

  const failed = install({ MC_TEST_BUILD_FAIL: '1' });
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stdout, /WARN Mission Control build FAILED — the previous build is still in place/);
  assert.equal(read(`${mc}/.next/BUILD_ID`), 'new build\n', 'a failed build leaves the previous one in place');
  assert.equal(existsSync(join(root, mc, '.next.prev')), false);

  // The unit runs that same node: NODE_BIN's dir leads its PATH.
  const plist = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.mission-control.plist'), 'utf8');
  assert.match(plist, /<key>PATH<\/key>\s*<string>\$\{NODE_BIN_DIR\}:/);
  const unit = readFileSync(join(ROOT, 'services/systemd/openclaw-mission-control.service'), 'utf8');
  assert.match(unit, /^Environment=PATH=\$\{NODE_BIN_DIR\}:/m);
  assert.match(moduleSrc['env.sh'], /export NODE_BIN_DIR="\$\(dirname "\$NODE_BIN"\)"/);
});

// The PreCompact hook the installer deploys (and wires in config/claude-settings.json)
// was a no-op stub, so no extraction fired on compaction. It now runs the trigger
// CLI from the checkout, both as the repo copy and as the deployed copy.
test('the deployed PreCompact hook fires the extraction trigger from the checkout', async () => {
  const integ = moduleSrc['integrations.sh'];
  const block = integ.slice(integ.indexOf('# Deploy hook scripts'), integ.indexOf('info "Deployed Claude Code hooks"'));
  assert.ok(block.includes('pre-compact'), 'the hook deploy step must be found');
  assert.match(readFileSync(join(ROOT, 'config/claude-settings.json'), 'utf8'), /"command": "bash \.claude\/hooks\/pre-compact\.sh"/);

  const root = mkdtempSync(join(tmpdir(), 'openclaw-precompact-'));
  const claudeDir = join(root, 'workspace', '.claude');
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  mkdirSync(join(root, 'fakebin'));
  writeFileSync(join(root, 'fakebin', 'node'), `#!/bin/sh\necho "$*" >> "${join(root, 'node.log')}"\n`, { mode: 0o755 });
  const deploy = spawnSync('bash', ['-c', `set -euo pipefail; run() { "$@"; }; REPO_DIR="${ROOT}"; CLAUDE_DIR="${claudeDir}"\n${block}`], { encoding: 'utf8' });
  assert.equal(deploy.status, 0, deploy.stderr);

  const env = { ...process.env, PATH: `${join(root, 'fakebin')}:${process.env.PATH}` };
  delete env.OPENCLAW_REPO_DIR;
  const expected = `${join(ROOT, 'bin', 'openclaw-extract-now.mjs')} --triggered-by=claude-code-pre-compact`;
  for (const hook of [join(claudeDir, 'hooks', 'pre-compact.sh'), join(ROOT, '.claude', 'hooks', 'pre-compact.sh')]) {
    writeFileSync(join(root, 'node.log'), '');
    const r = spawnSync('bash', [hook], { encoding: 'utf8', env, cwd: root });
    assert.equal(r.status, 0, r.stderr);
    for (let i = 0; i < 100 && !readFileSync(join(root, 'node.log'), 'utf8'); i++) await new Promise((res) => setTimeout(res, 50));
    assert.equal(readFileSync(join(root, 'node.log'), 'utf8').trim(), expected, hook);
  }
});
