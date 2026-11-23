import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { tmpDir } = createRequire(import.meta.url)('./helpers/tmp-dir.cjs');
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
  '--with-tailscale',
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

// systemd --user and launchd load only from these directories, and uninstall.sh removes
// only from them: an override rendered units nothing loaded or removed.
test('units render into the directories systemd and launchd load from', () => {
  const svc = moduleSrc['services.sh'];
  assert.doesNotMatch(svc, /OPENCLAW_(SYSTEMD|LAUNCHD)_DIR/);
  assert.match(svc, /^SYSTEMD_DEST="\$HOME\/\.config\/systemd\/user"$/m);
  assert.match(svc, /^LAUNCHD_DEST="\$HOME\/Library\/LaunchAgents"$/m);
});

const unitNames = () => moduleSrc['services.sh'].match(/^UNIT_NAMES='([^']*)'$/m)?.[1];
const renderUnitCli = (format, template, env) => spawnSync(process.execPath,
  [join(ROOT, 'lib/render-unit.js'), format, unitNames(), template], { encoding: 'utf8', env });

// Bare envsubst blanked every $VAR, so the NATS units shipped
// `ExecReload=/bin/kill -HUP ` and the leftover check (which looks for ${VAR}) missed it.
test('unit renders fill only the listed placeholders, so $MAINPID survives', () => {
  const names = unitNames();
  assert.ok(names, 'services.sh must define UNIT_NAMES');
  const templates = [
    ...readdirSync(join(ROOT, 'services/systemd')).map((f) => join(ROOT, 'services/systemd', f)),
    ...readdirSync(join(ROOT, 'services/launchd')).filter((f) => /^ai\.openclaw\..*\.plist$/.test(f)).map((f) => join(ROOT, 'services/launchd', f)),
  ];
  for (const f of templates) {
    for (const [, v] of readFileSync(f, 'utf8').matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      assert.ok(names.split(' ').includes(v), `\${${v}} in ${f} is missing from UNIT_NAMES`);
    }
  }
  const used = new Set();
  for (const f of [...templates, join(ROOT, 'services/launcher/openclaw-stack.desktop')]) {
    for (const [, v] of readFileSync(f, 'utf8').matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) used.add(v);
  }
  for (const v of names.split(' ')) assert.ok(used.has(v), `UNIT_NAMES lists ${v}, which no template uses`);
  const r = renderUnitCli('systemd', join(ROOT, 'services/systemd/openclaw-nats.service'), { HOME: '/h', NATS_SERVER_BIN: '/x/nats-server' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('ExecReload=/bin/kill -HUP $MAINPID'), r.stdout);
  assert.ok(r.stdout.includes('ExecStart="/x/nats-server" --config "/h/.openclaw/config/nats.conf"'), r.stdout);
});

// envsubst put values into <string> raw, so '&' or '<' made the plist unparseable; the
// sed fallback (stock macOS has no envsubst) turned '&' into the placeholder text and
// aborted the install after the unit had already been unloaded and reloaded.
test('unit renders survive & and < in values on every launchd template', (t) => {
  const svc = moduleSrc['services.sh'];
  assert.doesNotMatch(svc, /envsubst "\$UNIT_VARS"/);
  assert.doesNotMatch(svc, /s\|\\\$\{NPM_BIN\}\|/);
  assert.ok(svc.indexOf('plutil -lint') > 0 && svc.indexOf('plutil -lint') < svc.indexOf('launchctl unload "$DEST"'),
    'a plist is linted before launchctl unloads the running unit');
  if (spawnSync('python3', ['-c', '']).status !== 0) {
    t.diagnostic('python3 not installed; plist parse skipped');
    return;
  }
  const repo = '/Users/a/R&D/openclaw-node';
  const llm = 'http://h:11434/?a=1&b=<2>';
  const env = Object.fromEntries(unitNames().split(' ').map((n) => [n, `/v/${n.toLowerCase()}`]));
  Object.assign(env, { OPENCLAW_REPO_DIR: repo, LLM_BASE_URL: llm, HOME: '/h', NODE_BIN: '/n/node' });
  const dir = join(ROOT, 'services/launchd');
  for (const f of readdirSync(dir).filter((x) => /^ai\.openclaw\..*\.plist$/.test(x))) {
    const r = renderUnitCli('plist', join(dir, f), env);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    const parsed = spawnSync('python3', ['-I', '-c', 'import json, plistlib, sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'],
      { input: r.stdout, encoding: 'utf8' });
    assert.equal(parsed.status, 0, `${f} is not a valid plist: ${parsed.stderr}`);
    const plist = JSON.parse(parsed.stdout);
    if (plist.EnvironmentVariables && 'LLM_BASE_URL' in plist.EnvironmentVariables) {
      assert.equal(plist.EnvironmentVariables.LLM_BASE_URL, llm, f);
    }
    for (const a of plist.ProgramArguments || []) {
      if (a.includes('openclaw-node')) assert.ok(a.startsWith(`${repo}/`), `${f}: ${a}`);
    }
  }
});

// systemd splits an unquoted ExecStart/Environment value on whitespace: a checkout under
// "My Projects" ran node on ".../My" and lost NODE_PATH, and a key list written as
// "k1, k2" dropped every key after the space from the deploy listener's allowlist.
test('systemd units keep a spaced checkout path and a spaced key list whole', (t) => {
  const tmp = tmpDir('oc-unit-quoting-');
  const repo = join(tmp, 'My Projects', 'oc');
  mkdirSync(repo, { recursive: true });
  const keys = 'a+/=, b/+=';
  const env = Object.fromEntries(unitNames().split(' ').map((n) => [n, `/v/${n.toLowerCase()}`]));
  Object.assign(env, { HOME: tmp, NODE_BIN: process.execPath, OPENCLAW_REPO_DIR: repo, OPENCLAW_DEPLOY_TRUSTED_KEYS: keys, LLM_BASE_URL: 'http://h/x%20y' });
  const unitDir = join(tmp, 'root', 'etc', 'systemd', 'system');
  mkdirSync(unitDir, { recursive: true });
  const rendered = {};
  for (const f of readdirSync(join(ROOT, 'services/systemd'))) {
    const r = renderUnitCli('systemd', join(ROOT, 'services/systemd', f), env);
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    writeFileSync(join(unitDir, f), r.stdout);
    rendered[f] = r.stdout;
  }
  const words = (s) => [...s.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  const envOf = (text) => Object.fromEntries([...text.matchAll(/^Environment=(.*)$/gm)]
    .flatMap(([, line]) => words(line)).map((w) => [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)]));
  const listener = envOf(rendered['openclaw-mesh-deploy-listener.service']);
  assert.equal(listener.OPENCLAW_DEPLOY_TRUSTED_KEYS, keys);
  assert.equal(listener.OPENCLAW_REPO_DIR, repo);
  const agent = rendered['openclaw-mesh-agent.service'];
  assert.equal(envOf(agent).NODE_PATH, `${repo}/node_modules:${repo}/lib`);
  assert.equal(envOf(agent).LLM_BASE_URL, 'http://h/x%%20y', 'a % in a value is a systemd specifier unless doubled');
  assert.deepEqual(words(agent.match(/^ExecStart=(.*)$/m)[1]), [process.execPath, `${repo}/bin/mesh-agent.js`]);
  assert.deepEqual(words(rendered['openclaw-log-rotate.service'].match(/^ExecStart=(.*)$/m)[1]), ['/bin/bash', `${repo}/bin/log-rotate`]);
  const refused = renderUnitCli('systemd', join(ROOT, 'services/systemd/openclaw-mesh-agent.service'), { ...env, OPENCLAW_REPO_DIR: '/a"b' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /OPENCLAW_REPO_DIR contains a character a systemd unit cannot carry/);
  const desktop = renderUnitCli('desktop', join(ROOT, 'services/launcher/openclaw-stack.desktop'), env);
  assert.equal(desktop.status, 0, desktop.stderr);
  assert.deepEqual(words(desktop.stdout.match(/^Exec=(.*)$/m)[1]), [process.execPath, `${repo}/bin/openclaw-stack.mjs`, 'up']);
  assert.equal(renderUnitCli('desktop', join(ROOT, 'services/launcher/openclaw-stack.desktop'), { ...env, OPENCLAW_REPO_DIR: '/a$b' }).status, 1);

  const envFile = join(tmp, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_DEPLOY_TRUSTED_KEYS=k1, k2\n');
  const merge = moduleSrc['config.sh'].match(/^merge_trusted_key\(\) \{\n[\s\S]*?\n\}\n/m)[0];
  const m = spawnSync('bash', ['-c', `set -euo pipefail\nDRY_RUN=false\nsource "${join(ROOT, 'scripts/install/helpers.sh')}"\n${merge}merge_trusted_key OPENCLAW_DEPLOY_TRUSTED_KEYS k2`],
    { encoding: 'utf8', env: { PATH: process.env.PATH, ENV_FILE: envFile } });
  assert.equal(m.status, 0, m.stderr);
  assert.equal(readFileSync(envFile, 'utf8'), 'OPENCLAW_DEPLOY_TRUSTED_KEYS=k1,k2\n');

  if (spawnSync('sh', ['-c', 'command -v systemd-analyze']).status !== 0) {
    t.diagnostic('systemd-analyze not installed; unit verify skipped');
    return;
  }
  for (const f of Object.keys(rendered)) {
    const v = spawnSync('systemd-analyze', ['verify', `--root=${join(tmp, 'root')}`, f], { cwd: unitDir, encoding: 'utf8' });
    assert.doesNotMatch(v.stderr, /Invalid environment assignment|My is not executable|Failed to resolve|Ignoring/, `${f}: ${v.stderr}`);
  }
});

// set_env_key put the value into a sed replacement: '&' wrote the old line into the new
// value, '|' made sed fail, and llm-setup/config.sh carried their own copies of it.
test('set_env_key writes values literally and keeps the env file private', () => {
  const dir = tmpDir('oc-set-env-key-');
  const file = join(dir, 'openclaw.env');
  writeFileSync(file, 'A=1\nLLM_BASE_URL=old\nZ=2\n', { mode: 0o600 });
  const inode = statSync(file).ino;
  const setKey = (value, dryRun = 'false') => spawnSync('bash', ['-c', `set -euo pipefail\nDRY_RUN=${dryRun}\nsource "${join(ROOT, 'scripts/install/helpers.sh')}"\nset_env_key LLM_BASE_URL "$V" "$F"`],
    { encoding: 'utf8', env: { PATH: process.env.PATH, V: value, F: file } });
  for (const value of ['http://h:11434/?a=1&b=2', 'a|b', 'c\\d', '']) {
    const r = setKey(value);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(file, 'utf8'), `A=1\nLLM_BASE_URL=${value}\nZ=2\n`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(file).ino, inode);
  }
  const r = setKey('dry', 'true');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\]/);
  assert.equal(readFileSync(file, 'utf8'), 'A=1\nLLM_BASE_URL=\nZ=2\n');
  // config.sh imports the env file last-line-wins, so a duplicate left stale reaches the units.
  writeFileSync(file, 'LLM_BASE_URL=old\nA=1\nLLM_BASE_URL=old\nLLM_BASE_URLX=keep\n');
  assert.equal(setKey('http://n/?a=1&b|c').status, 0);
  assert.equal(readFileSync(file, 'utf8'), 'LLM_BASE_URL=http://n/?a=1&b|c\nA=1\nLLM_BASE_URL=http://n/?a=1&b|c\nLLM_BASE_URLX=keep\n');
  assert.deepEqual(readdirSync(dir), ['openclaw.env']);
  for (const [f, src] of [['llm-setup.sh', readFileSync(join(ROOT, 'scripts/install/llm-setup.sh'), 'utf8')], ['config.sh', moduleSrc['config.sh']]]) {
    assert.doesNotMatch(src, /sed -i[^\n]*\^(LLM_|OPENCLAW_|\$\{?var|\$key)/, `${f} rewrites env keys with sed`);
  }
});

test('render_unit keeps the installed unit when the render or the plist lint fails', () => {
  const fn = moduleSrc['services.sh'].match(/^render_unit\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
  assert.ok(fn, 'services.sh defines render_unit');
  const dir = tmpDir('oc-render-unit-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(dir, 'good.service'), 'ExecStart=${NODE_BIN} x\n');
  writeFileSync(join(dir, 'bad.service'), 'ExecStart=${NODE_BIN} ${NOT_A_VAR}\n');
  writeFileSync(join(dir, 'a.plist'), '<string>${HOME}</string>\n');
  const render = (calls, plutilExit = 0) => {
    writeFileSync(join(bin, 'plutil'), `#!/bin/sh\nexit ${plutilExit}\n`, { mode: 0o755 });
    return spawnSync('bash', ['-c', `set -euo pipefail\nerror() { echo "$*" >&2; }\nRENDER_ERRORS=0\n${fn}${calls}\necho "errors=$RENDER_ERRORS"`], {
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: '/h', NODE_BIN: process.execPath, REPO_DIR: ROOT, UNIT_NAMES: unitNames(), D: dir },
    });
  };
  for (const f of ['good', 'bad', 'a']) writeFileSync(join(dir, `${f}.out`), 'old unit\n');

  let r = render('render_unit systemd "$D/good.service" "$D/good.out"\nrender_unit systemd "$D/bad.service" "$D/bad.out" || echo skipped');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^skipped\nerrors=1$/m);
  assert.equal(readFileSync(join(dir, 'good.out'), 'utf8'), `ExecStart=${process.execPath} x\n`);
  assert.equal(readFileSync(join(dir, 'bad.out'), 'utf8'), 'old unit\n');

  r = render('render_unit plist "$D/a.plist" "$D/a.out" || echo skipped', 1);
  assert.match(r.stdout, /^skipped\nerrors=1$/m, r.stderr);
  assert.equal(readFileSync(join(dir, 'a.out'), 'utf8'), 'old unit\n');
  r = render('render_unit plist "$D/a.plist" "$D/a.out"', 0);
  assert.match(r.stdout, /^errors=0$/m, r.stderr);
  assert.equal(readFileSync(join(dir, 'a.out'), 'utf8'), '<string>/h</string>\n');
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes('.render.')), []);
});

// The Linux gateway ran in ~/openclaw, which no documented install creates, so systemd
// failed its start with 200/CHDIR before node ran. The plist sets no working directory.
test('no unit runs in the ~/openclaw copy', () => {
  for (const dir of ['services/systemd', 'services/launchd']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      assert.doesNotMatch(src, /^WorkingDirectory=-?\$\{HOME\}\/openclaw\b/m, `${dir}/${f}`);
      assert.doesNotMatch(src, /<key>WorkingDirectory<\/key>\s*<string>\$\{HOME\}\/openclaw\b/, `${dir}/${f}`);
    }
  }
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
  assert.ok(unitNames().split(' ').includes('OPENCLAW_GATEWAY_JS'));

  const line = moduleSrc['env.sh'].split('\n').find((l) => l.startsWith('export OPENCLAW_GATEWAY_JS='));
  assert.ok(line, 'env.sh exports OPENCLAW_GATEWAY_JS');
  const dir = tmpDir('oc-gateway-js-');
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

// The systemd health-publisher unit omitted OPENCLAW_REPO_DIR, so Linux nodes reported the
// HEAD of ~/openclaw as their deployVersion; Mission Control's local fallback hardcoded it.
test('every unit whose entrypoint reads OPENCLAW_REPO_DIR sets it, on both OSes', () => {
  const units = [
    ...readdirSync(join(ROOT, 'services/launchd')).map((f) => `services/launchd/${f}`),
    ...readdirSync(join(ROOT, 'services/systemd')).map((f) => `services/systemd/${f}`),
  ];
  const setsRepoDir = (src) => /^Environment="OPENCLAW_REPO_DIR=\$\{OPENCLAW_REPO_DIR\}"$/m.test(src)
    || /<key>OPENCLAW_REPO_DIR<\/key>\s*<string>\$\{OPENCLAW_REPO_DIR\}<\/string>/.test(src);
  let readers = 0;
  for (const rel of units) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const name = src.match(/\/bin\/([\w.-]+\.m?js)\b/)?.[1];
    if (!name) continue;
    const entry = [join(ROOT, 'bin', name), join(ROOT, 'workspace-bin', name)].find((f) => existsSync(f));
    if (!entry || !readFileSync(entry, 'utf8').includes('process.env.OPENCLAW_REPO_DIR')) continue;
    readers++;
    assert.ok(setsRepoDir(src), `${rel} runs ${name}, which reads OPENCLAW_REPO_DIR`);
  }
  assert.ok(readers >= 4, `units whose entrypoint reads OPENCLAW_REPO_DIR: ${readers}`);
  for (const rel of ['services/systemd/openclaw-mission-control.service', 'services/launchd/ai.openclaw.mission-control.plist']) {
    assert.ok(setsRepoDir(readFileSync(join(ROOT, rel), 'utf8')), `${rel} must set OPENCLAW_REPO_DIR for its deployVersion fallback`);
  }
});

// The memory-daemon and Mission Control systemd units kept NODE_PATH on the ~/openclaw copy,
// which nothing they run resolves through and their launchd twins never set. The gateway
// unit's NODE_PATH is an open operator decision (agent-run scripts may rely on it).
test('no unit but the gateway points NODE_PATH at the ~/openclaw copy', () => {
  const units = [
    ...readdirSync(join(ROOT, 'services/launchd')).map((f) => `services/launchd/${f}`),
    ...readdirSync(join(ROOT, 'services/systemd')).map((f) => `services/systemd/${f}`),
  ].filter((rel) => rel !== 'services/systemd/openclaw-gateway.service');
  for (const rel of units) {
    assert.doesNotMatch(readFileSync(join(ROOT, rel), 'utf8'), /NODE_PATH[^\n]*\$\{HOME\}\/openclaw\//, rel);
  }
});

// env.sh replaced only '/' and '.', so a home or checkout path with '_' or a space
// registered transcript sources Claude Code never creates.
test('claude_project_path encodes the way Claude Code and agent-activity do', () => {
  const { toClaudeProjectPath } = createRequire(import.meta.url)('../lib/agent-activity.js');
  const fn = moduleSrc['env.sh'].match(/^claude_project_path\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
  assert.ok(fn, 'env.sh defines claude_project_path');
  const encode = (p) => spawnSync('bash', ['-c', `set -euo pipefail\n${fn}claude_project_path "$1"`, 'x', p], { encoding: 'utf8' });
  const missing = '/home/john_doe/My Projects/x.y';
  let r = encode(missing);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${toClaudeProjectPath(missing)}\n`);
  assert.equal(r.stdout, '-home-john-doe-My-Projects-x-y\n');
  const dir = tmpDir('oc-claude-path-');
  mkdirSync(join(dir, 'real_dir'));
  symlinkSync(join(dir, 'real_dir'), join(dir, 'link'));
  r = encode(join(dir, 'link'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${toClaudeProjectPath(realpathSync(join(dir, 'link')))}\n`);
});

test('preserved behaviors sit in their modules', () => {
  assert.ok(moduleSrc['env.sh'].includes('claude_project_path() {'));
  assert.ok(moduleSrc['env.sh'].includes("sed 's|[^A-Za-z0-9]|-|g'"));
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

// integrations.sh probed for a `mesh` binary nothing ships, then copied the mesh skill the
// unconditional install below copies again; components.sh had a dry-run branch inside a
// block that already requires ! $DRY_RUN.
test('the install modules carry no dead mesh-CLI probe or unreachable dry-run branch', () => {
  const integ = moduleSrc['integrations.sh'];
  assert.doesNotMatch(integ, /openclaw\/bin\/mesh"/);
  assert.equal(integ.split('\n').filter((l) => /^\s*run cp .*skills\/mesh\/SKILL\.md/.test(l)).length, 1);
  assert.doesNotMatch(moduleSrc['components.sh'], /would start ollama/);
});

test('sync-to-harness is gone from the repo and an --update moves the installed copy out of bin/', () => {
  assert.equal(existsSync(join(ROOT, 'workspace-bin/sync-to-harness')), false);
  assert.match(readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8'), /^workspace-bin sync-to-harness$/m);
  assert.ok(moduleSrc['workspace.sh'].includes('retire_shipped_files workspace-bin "$WORKSPACE/bin"'));
  const root = tmpDir('retired-ws-');
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

// The lib rsyncs never delete, so node-watch's `diff -rq -x node_modules` of repo lib
// against the deployed copy stayed BROKEN on every node updated past a lib deletion.
const DELETED_LIB = ['pair-transport-teams.js', 'mcp-knowledge/bench.mjs', 'mcp-knowledge/package-lock.json', 'wakefulness.mjs'];

test('an --update archives the lib files the repo deleted from both deployed lib copies', (t) => {
  if (spawnSync('rsync', ['--version']).status !== 0) {
    t.skip('rsync not installed');
    return;
  }
  const retired = readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8');
  const src = moduleSrc['workspace.sh'];
  for (const [group, call, rsync] of [
    ['workspace-lib', 'retire_shipped_files workspace-lib "$WORKSPACE/lib"', '"$REPO_DIR/lib/" "$WORKSPACE/lib/"'],
    ['mesh-lib', 'retire_shipped_files mesh-lib "$MESH_LIB"', '"$REPO_DIR/lib/" "$MESH_LIB/"'],
  ]) {
    for (const f of DELETED_LIB) {
      assert.equal(existsSync(join(ROOT, 'lib', f)), false, `lib/${f} still ships`);
      assert.match(retired, new RegExp(`^${group} ${f.replace(/\./g, '\\.')}$`, 'm'));
    }
    assert.ok(src.indexOf(call) > src.indexOf(rsync), `${call} runs after the lib rsync`);

    const root = tmpDir(`retired-${group}-`);
    const lib = join(root, 'deployed', 'lib');
    mkdirSync(lib, { recursive: true });
    assert.equal(spawnSync('rsync', ['-a', '--exclude=node_modules', `${ROOT}/lib/`, `${lib}/`]).status, 0);
    for (const f of DELETED_LIB) {
      mkdirSync(dirname(join(lib, f)), { recursive: true });
      writeFileSync(join(lib, f), 'stale\n');
    }
    const r = spawnSync('bash', ['-euc', `source "${join(ROOT, 'scripts/install/helpers.sh')}"; retire_shipped_files ${group} "$1"`, 'x', lib], {
      encoding: 'utf8', env: { ...process.env, DRY_RUN: 'false', REPO_DIR: ROOT, OPENCLAW_ROOT: root },
    });
    assert.equal(r.status, 0, r.stderr);
    const [dated] = readdirSync(join(root, 'retired'));
    for (const f of DELETED_LIB) assert.equal(readFileSync(join(root, 'retired', dated, group, f), 'utf8'), 'stale\n', f);
    const diff = spawnSync('diff', ['-rq', '-x', 'node_modules', join(ROOT, 'lib'), lib], { encoding: 'utf8' });
    assert.equal(diff.status, 0, diff.stdout);
  }
});

test('retire_shipped_files moves dir/file names but never one that leaves the dir, is hidden, nested twice or a backup', () => {
  const root = tmpDir('retired-refused-');
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'scripts/install'), { recursive: true });
  const refused = ['../outside.js', '/abs.js', '.hidden/x.js', 'sub/.x.js', 'sub/a/b.js', 'sub/x.bak.js', 'sub/../outside.js'];
  writeFileSync(join(repo, 'scripts/install/retired-files.txt'), ['g sub/moved.js', ...refused.map((n) => `g ${n}`)].join('\n') + '\n');
  const dir = join(root, 'deployed', 'lib');
  for (const rel of ['sub/moved.js', 'sub/.x.js', 'sub/a/b.js', 'sub/x.bak.js', '.hidden/x.js']) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), 'x');
  }
  writeFileSync(join(root, 'deployed', 'outside.js'), 'x');
  const r = spawnSync('bash', ['-euc', `source "${join(ROOT, 'scripts/install/helpers.sh')}"; retire_shipped_files g "$1"`, 'x', dir], {
    encoding: 'utf8', env: { ...process.env, DRY_RUN: 'false', REPO_DIR: repo, OPENCLAW_ROOT: root },
  });
  assert.equal(r.status, 0, r.stderr);
  const [dated] = readdirSync(join(root, 'retired'));
  assert.equal(existsSync(join(root, 'retired', dated, 'g', 'sub/moved.js')), true);
  assert.equal(existsSync(join(dir, 'sub/moved.js')), false);
  for (const rel of ['sub/.x.js', 'sub/a/b.js', 'sub/x.bak.js', '.hidden/x.js']) assert.equal(existsSync(join(dir, rel)), true, rel);
  assert.equal(existsSync(join(root, 'deployed', 'outside.js')), true);
});

test('the directory step leaves ~/.openclaw private to its owner, on a fresh install and on --update', () => {
  const src = moduleSrc['workspace.sh'];
  const block = src.slice(0, src.indexOf('# Step 3'));
  const tmp = tmpDir('oc-root-mode-');
  const root = join(tmp, '.openclaw');
  const step2 = () => spawnSync('bash', ['-c', `set -e; run() { "$@"; }; step() { :; }; info() { :; }\n${block}`], {
    encoding: 'utf8', env: { ...process.env, OPENCLAW_ROOT: root, WORKSPACE: join(root, 'workspace') },
  });
  let r = step2();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.ok(existsSync(join(root, 'workspace', 'memory')));
  spawnSync('chmod', ['755', root]);
  r = step2();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(root).mode & 0o777, 0o700);
  rmSync(tmp, { recursive: true, force: true });
});

test('every quarantined or deleted skill is archived out of an installed workspace on --update', () => {
  const readme = readFileSync(join(ROOT, 'skills/_quarantine/README.md'), 'utf8');
  const quarantined = readdirSync(join(ROOT, 'skills/_quarantine'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(quarantined.includes('capability-evolver'));
  for (const s of quarantined) {
    assert.equal(existsSync(join(ROOT, 'skills', s)), false, `${s} still ships`);
    assert.equal(existsSync(join(ROOT, 'skills/_quarantine', s, 'SKILL.md')), true, `${s} has no SKILL.md in _quarantine`);
    assert.match(readme, new RegExp(`^\\| \`${s}\` \\|`, 'm'), `${s} has no README row`);
  }
  // Deleted outright rather than quarantined; named here because CI checkouts are shallow.
  const deleted = ['clawdbot-filesystem', 'deep-research', 'markdown-formatter', 'memory-hygiene', 'memory-setup',
    'save-money', 'search', 'self-improving-agent-1-0-2'];
  for (const s of deleted) assert.equal(existsSync(join(ROOT, 'skills', s)), false, `${s} still ships`);
  const listed = readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8').split('\n')
    .map((l) => l.trim().split(/\s+/)).filter(([g]) => g === 'skills').map(([, n]) => n);
  const expected = [...quarantined, ...deleted].sort();
  for (const s of expected) assert.ok(listed.includes(s), `skills ${s} is not in retired-files.txt`);

  const src = moduleSrc['workspace.sh'];
  assert.ok(src.includes('retire_shipped_files skills "$WORKSPACE/skills"'));
  assert.ok(!src.includes('RETIRED_SKILLS'), 'skills are archived by retire_shipped_files, never rm -rf');
  const root = tmpDir('retired-skills-');
  const skills = join(root, 'workspace', 'skills');
  for (const s of [...expected, 'kept']) {
    mkdirSync(join(skills, s), { recursive: true });
    writeFileSync(join(skills, s, 'SKILL.md'), '# x\n');
  }
  mkdirSync(join(skills, 'capability-evolver/assets/gep'), { recursive: true });
  writeFileSync(join(skills, 'capability-evolver/assets/gep/events.jsonl'), '{"learned":1}\n');
  const r = spawnSync('bash', ['-euc', `source "${join(ROOT, 'scripts/install/helpers.sh')}"; retire_shipped_files skills "$1"`, 'x', skills], {
    encoding: 'utf8', env: { ...process.env, DRY_RUN: 'false', REPO_DIR: ROOT, OPENCLAW_ROOT: root },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(skills), ['kept']);
  const [dated] = readdirSync(join(root, 'retired'));
  const archive = join(root, 'retired', dated, 'skills');
  assert.deepEqual(readdirSync(archive).sort(), expected);
  assert.equal(readFileSync(join(archive, 'capability-evolver/assets/gep/events.jsonl'), 'utf8'), '{"learned":1}\n');
  rmSync(root, { recursive: true, force: true });
});

// The skills rsync never deletes, so files removed from inside a shipped skill stayed
// installed: moltbook-interact's INSTALL.md installed around the scanner gate, and a stale
// package.json with no dependencies re-ran npm in its skill on every --update.
test('an --update removes the files the repo deleted from inside shipped skills, before the npm loop', (t) => {
  if (spawnSync('rsync', ['--version']).status !== 0) {
    t.skip('rsync not on PATH');
    return;
  }
  const deleted = [
    'moltbook-interact/INSTALL.md', 'clawddocs/package.json', 'clawddocs/package-lock.json',
    'clawddocs/snippets/common-configs.md', 'crypto-price/ARCHITECTURE.md',
    'fast-browser-use/package.json', 'fast-browser-use/package-lock.json', 'fast-browser-use/CODEBUDDY.md',
    'fast-browser-use/test_auth.json', 'fast-browser-use/test_state.json', 'openclaw-skill-scanner/report-template.md',
  ];
  for (const rel of deleted) assert.equal(existsSync(join(ROOT, 'skills', rel)), false, `${rel} still ships`);
  const src = moduleSrc['workspace.sh'];
  const start = src.indexOf('run rsync -av --exclude=\'/dist/\'');
  const end = src.indexOf('\ndone\nfi\n', start);
  assert.ok(start >= 0 && end > start, 'skills step parsed');
  const block = src.slice(start, end + '\ndone\nfi\n'.length);

  const dir = tmpDir('oc-skill-files-');
  const skills = join(dir, 'workspace', 'skills');
  for (const rel of deleted) {
    mkdirSync(dirname(join(skills, rel)), { recursive: true });
    writeFileSync(join(skills, rel), '{}\n');
  }
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho "npm $(basename "$PWD")" >> "${log}"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'pip3'), `#!/bin/sh\necho "pip3 $*" >> "${log}"\n`, { mode: 0o755 });
  for (const pass of [1, 2]) {
    const r = spawnSync('bash', ['-ec', `run() { "$@"; }; info() { :; }; warn() { :; }; retire_shipped_files() { :; }\n${block}`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SANDBOX: 'false', REPO_DIR: ROOT, WORKSPACE: join(dir, 'workspace') },
    });
    assert.equal(r.status, 0, `pass ${pass}: ${r.stderr}`);
  }
  for (const rel of deleted) assert.equal(existsSync(join(skills, rel)), false, rel);
  assert.equal(existsSync(join(skills, 'clawddocs/snippets')), false);
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /^pip3 .*\/crypto-price\/+requirements\.txt$/m, 'the dependency loop ran');
  assert.doesNotMatch(calls, /^npm (clawddocs|fast-browser-use)$/m, calls);
});

test('installer links scoped packages into both deployed parent trees', () => {
  const workspace = moduleSrc['workspace.sh'];
  assert.ok(readFileSync(join(ROOT, 'scripts/install/deps.sh'), 'utf8').includes('for scoped_dir in "$pkgdir"*/'));
  assert.ok(workspace.includes('link_dependency_tree "$MESH_NM" "$WS_NM"'));
  assert.ok(workspace.includes('link_dependency_tree "$MESH_NM" "$MESH_HOME_NM"'));
  // The repo tree is the one dependency set: no second, partial install at the mesh home.
  assert.ok(workspace.includes('MESH_NM="$REPO_DIR/node_modules"'));
  assert.doesNotMatch(workspace, /npm init -y|npm install --no-save better-sqlite3/);
  assert.ok(moduleSrc['components.sh'].includes('$WORKSPACE/node_modules/@huggingface/transformers'));
  assert.ok(!moduleSrc['components.sh'].includes('$WORKSPACE/lib/mcp-knowledge/node_modules'));
});

test('the promotion policy ships beside the workspace lib/ that consolidation loads it from', () => {
  assert.ok(moduleSrc['workspace.sh'].includes('run cp "$REPO_DIR/config/promotion-policy.yaml" "$WORKSPACE/config/promotion-policy.yaml"'));
  assert.ok(moduleSrc['workspace.sh'].includes('run rsync -av --exclude=\'node_modules\' \\\n  "$REPO_DIR/lib/" "$WORKSPACE/lib/"'));
});

test('the installer makes ~/.openclaw/souls a git repo on main that Mission Control can commit evolutions to', () => {
  const block = moduleSrc['workspace.sh'].match(/if \[ ! -d "\$OPENCLAW_ROOT\/souls\/\.git" \]; then\n[\s\S]*?\nfi\n/)[0];
  const root = tmpDir('souls-git-init-');
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
});

test('scheduler heartbeat helper is installer-owned and both units invoke it', () => {
  assert.ok(moduleSrc['workspace.sh'].includes('scheduler-heartbeat.mjs'));
  assert.ok(heartbeatLaunchd.includes('${NODE_BIN}'));
  assert.ok(heartbeatLaunchd.includes('${OPENCLAW_WORKSPACE}/bin/scheduler-heartbeat.mjs'));
  assert.ok(heartbeatSystemd.includes('"${NODE_BIN}" "${OPENCLAW_WORKSPACE}/bin/scheduler-heartbeat.mjs"'));
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
  assert.match(service, /^ExecStart=\/bin\/sh "\$\{OPENCLAW_WORKSPACE\}\/bin\/archive-transcripts\.sh"$/m);
  assert.match(readFileSync(join(ROOT, 'services/systemd/openclaw-transcript-archive.timer'), 'utf8'), /^OnUnitActiveSec=3600$/m);
  assert.ok(existsSync(join(ROOT, 'workspace-bin/archive-transcripts.sh')), 'the installer copies workspace-bin/ to $WORKSPACE/bin/');
  // launchd will not start a job whose log directory is missing, and the plist
  // logs into the archive dir before the script can create it.
  const logDir = plist.match(/<key>StandardErrorPath<\/key><string>\$\{HOME\}\/\.openclaw\/([^<]+)\/[^/<]+<\/string>/)?.[1];
  assert.equal(logDir, 'transcript-archive');
  assert.equal((moduleSrc['services.sh'].match(/mkdir -p [^\n]*"\$OPENCLAW_ROOT\/transcript-archive"/g) || []).length, 1);
});

// resolveNodeId reads only the process env, so a plist without OPENCLAW_NODE_ID traced,
// logged and registered under the hostname while its systemd twin used the persisted id.
test('macOS and Linux templates agree on the node-identity env', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'services/service-manifest.json'), 'utf8'));
  let compared = 0;
  for (const { name } of manifest) {
    const plistPath = join(ROOT, `services/launchd/ai.openclaw.${name.replace(/^openclaw-/, '')}.plist`);
    const unitPath = join(ROOT, `services/systemd/${name}.service`);
    if (!existsSync(plistPath) || !existsSync(unitPath)) continue;
    compared++;
    assert.equal(readFileSync(plistPath, 'utf8').includes('<key>OPENCLAW_NODE_ID</key>'),
      /^Environment="?OPENCLAW_NODE_ID=/m.test(readFileSync(unitPath, 'utf8')), `${name}: OPENCLAW_NODE_ID on one platform only`);
  }
  assert.ok(compared > 10, `compared ${compared} services`);
  for (const svc of ['mesh-task-daemon', 'mesh-tool-discord', 'mesh-health-publisher']) {
    assert.match(readFileSync(join(ROOT, `services/launchd/ai.openclaw.${svc}.plist`), 'utf8'),
      /<key>OPENCLAW_WORKSPACE<\/key>\s*<string>\$\{OPENCLAW_WORKSPACE\}<\/string>/, svc);
  }
  assert.doesNotMatch(readFileSync(join(ROOT, 'bin/mesh-task-daemon.js'), 'utf8'), /const NODE_ID = /);
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
  const home = tmpDir('openclaw-dry-');
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
  const home = tmpDir('openclaw-dry-env-');
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
  assert.ok(guard < svc.indexOf('render_unit desktop "$REPO_DIR/services/launcher/openclaw-stack.desktop"'), 'guard must precede the render');
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
  const root = tmpDir('openclaw-role-');
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
  const dir = tmpDir('oc-genconfig-');
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

// A '|' in a value no template needs still aborted the sed render under set -e.
test("generate_config's sed fallback substitutes only placeholders its templates use", () => {
  const cfg = moduleSrc['config.sh'];
  const keys = [...cfg.matchAll(/-e "s\|\\\$\{([A-Z_]+)\}\|/g)].map((m) => m[1]);
  const inputs = [...cfg.matchAll(/generate_config "\$REPO_DIR\/([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 5 && inputs.length > 5, `parsed ${keys.length} keys, ${inputs.length} inputs`);
  const used = new Set(inputs.flatMap((f) => [...readFileSync(join(ROOT, f), 'utf8').matchAll(/\$\{([A-Z_]+)\}/g)].map((m) => m[1])));
  assert.deepEqual(keys.filter((k) => !used.has(k)), []);
  assert.deepEqual([...used].filter((k) => !keys.includes(k)), []);
});

// A cluster node's --update ran without --cluster-peers and rendered the
// single-node nats.conf (as .new), since the peers and bind were never saved.
// The joining run wrote the bound OPENCLAW_NATS to the env file only, so the units
// it rendered next still pointed at 127.0.0.1, where the cluster server no longer listens.
test('config.sh saves the cluster peers and bind, and a flagless --update re-renders the cluster nats.conf', () => {
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf("# A cluster node's peers and bind address");
  const end = cfg.indexOf('generate_config "$REPO_DIR/config/obsidian-sync.json.template"');
  assert.ok(start > 0 && end > start, 'NATS render block must exist in config.sh');
  const block = cfg.slice(start, end);
  const root = tmpDir('oc-cluster-');
  mkdirSync(join(root, 'config'));
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_NATS_TOKEN=tok\nOPENCLAW_NATS=nats://127.0.0.1:4222\n');
  const conf = join(root, 'config', 'nats.conf');
  const exported = ['OPENCLAW_NATS', 'OPENCLAW_KV_REPLICAS', 'OPENCLAW_NATS_CLUSTER_PEERS', 'OPENCLAW_NATS_CLUSTER_BIND'];
  const run = (flags) => spawnSync('bash', ['-c', `set -euo pipefail
source "${join(ROOT, 'scripts/install/helpers.sh')}"
step() { :; }; info() { echo "INFO $*"; }; warn() { echo "WARN $*"; }; error() { echo "ERR $*" >&2; }
run() { "$@"; }; generate_config() { echo "GEN $(basename "$2")"; }
while IFS='=' read -r k v; do export "$k=$v"; done < "$ENV_FILE"
${block}
${exported.map((k) => `bash -c 'echo "EXPORTED_${k}=\${${k}:-}"'`).join('\n')}`], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH, HOME: root, OPENCLAW_ROOT: root, ENV_FILE: envFile, REPO_DIR: ROOT,
      DRY_RUN: 'false', OPENCLAW_NODE_ID: 'n1', CLUSTER_PEERS: '', CLUSTER_BIND: '', ...flags,
    },
  });

  let r = run({ DRY_RUN: 'true', CLUSTER_PEERS: '100.64.0.2,100.64.0.3', CLUSTER_BIND: '100.64.0.1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^EXPORTED_OPENCLAW_NATS=nats:\/\/100\.64\.0\.1:4222$/m, 'a dry run previews the bound address');
  assert.ok(!existsSync(conf), 'a dry run renders nothing');

  r = run({ CLUSTER_PEERS: '100.64.0.2,100.64.0.3', CLUSTER_BIND: '100.64.0.1' });
  assert.equal(r.status, 0, r.stderr);
  const env = readFileSync(envFile, 'utf8');
  assert.match(env, /^OPENCLAW_NATS_CLUSTER_PEERS=100\.64\.0\.2,100\.64\.0\.3$/m);
  assert.match(env, /^OPENCLAW_NATS_CLUSTER_BIND=100\.64\.0\.1$/m);
  for (const k of exported) {
    const saved = env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
    assert.ok(saved, `${k} is saved`);
    assert.ok(r.stdout.split('\n').includes(`EXPORTED_${k}=${saved}`), `the joining run renders the units with the saved ${k}=${saved}`);
  }
  assert.match(env, /^OPENCLAW_NATS=nats:\/\/100\.64\.0\.1:4222$/m);
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
});

test('config.sh env-file parse keeps quotes, spacing and backslashes like renderConfigTemplate', () => {
  const cfg = moduleSrc['config.sh'];
  const start = cfg.indexOf('# Source env file for config generation');
  const end = cfg.indexOf('# Persist the node id');
  assert.ok(start > 0 && end > start, 'env-file loop must exist in config.sh');
  const root = tmpDir('openclaw-envparse-');
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

  const root = tmpDir('openclaw-trust-');
  const identity = getOrCreateIdentity(root);
  const envFile = join(root, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_DEPLOY_TRUSTED_KEYS=operatorKeyAAA\n');

  const script = `
    set -euo pipefail
    DRY_RUN=false
    source "${join(ROOT, 'scripts/install/helpers.sh')}"
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

test('both dependency installers provide and gate rsync, which install.sh runs from Step 3 on', () => {
  for (const file of ['scripts/install/prereqs.sh', 'bootstrap.sh']) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    assert.match(src, /apt-get install -y \\\n\s+[^\n]*\brsync\b/, `${file} apt baseline`);
    assert.match(src, /^_?chk "rsync"\s+'command -v rsync'$/m, `${file} gate`);
  }
});

// The same virgin-Mac run: install.sh never compiled packages/event-schemas
// (dist/ is gitignored, the tarball ships .ts only, --omit=dev brings no tsc),
// so the memory daemon exited at startup. env.sh must build it and refuse to
// hand over a tree without dist/index.js.
test('env.sh builds the event-schemas dist the memory daemon needs at startup', () => {
  const env = moduleSrc['env.sh'];
  const deps = readFileSync(join(ROOT, 'scripts/install/deps.sh'), 'utf8');
  assert.match(env, /^source "\$REPO_DIR\/scripts\/install\/deps\.sh"$/m);
  assert.match(deps, /packages\/event-schemas\/dist\/index\.js/);
  assert.match(deps, /npx --yes --package typescript@5 tsc -p packages\/event-schemas\/tsconfig\.json/);
  assert.match(deps, /event-schemas build produced no dist\/index\.js[^\n]*\n\s*return 1/);
  assert.match(env, /^build_event_schemas "\$REPO_DIR" \|\| exit 1$/m);
  // The daemon's loader is the reason this matters: it fails loud on a missing dist.
  assert.match(readFileSync(join(ROOT, 'lib/event-schemas.mjs'), 'utf8'), /event-schemas dist missing/);
});

// Both steps ran only when their sentinel (node_modules/nats, dist/index.js) was
// missing, so `git pull && install.sh --update` never applied a dependency bump
// or a schema change on a persistent checkout.
test('install --update reinstalls changed dependencies and rebuilds a stale event-schemas dist', () => {
  const env = moduleSrc['env.sh'];
  const block = env.slice(env.indexOf('# ── Repo runtime dependencies'), env.indexOf('# ── Resolve the agent provider'));
  assert.ok(block.includes('install_repo_deps "$REPO_DIR"'), 'the dependency block must be found');
  const root = tmpDir('openclaw-deps-');
  const repo = join(root, 'repo');
  const put = (rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
  put('package.json', '{"name":"r","dependencies":{"nats":"^2"}}\n');
  put('package-lock.json', '{"lockfileVersion":3,"v":1}\n');
  put('packages/event-schemas/tsconfig.json', '{}\n');
  put('packages/event-schemas/src/events.ts', 'export const a = 1;\n');
  const calls = join(root, 'calls.log');
  mkdirSync(join(root, 'fakebin'));
  writeFileSync(join(root, 'fakebin', 'npm'), `#!/bin/sh
echo "npm $*" >> "${calls}"
rm -rf node_modules && mkdir -p node_modules/nats
`, { mode: 0o755 });
  // Like tsc on unchanged sources: an existing output is left as it is.
  writeFileSync(join(root, 'fakebin', 'npx'), `#!/bin/sh
echo "npx $*" >> "${calls}"
mkdir -p packages/event-schemas/dist
[ -f packages/event-schemas/dist/index.js ] || echo built > packages/event-schemas/dist/index.js
`, { mode: 0o755 });
  const run = () => {
    writeFileSync(calls, '');
    const r = spawnSync('bash', ['-c', `set -euo pipefail
DRY_RUN=false; info() { :; }; error() { echo "ERR $*"; }; run() { "$@"; }
REPO_DIR=${JSON.stringify(repo)}
${block.replace('$REPO_DIR/scripts/install/deps.sh', join(ROOT, 'scripts/install/deps.sh'))}`], { encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'fakebin')}:${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
  };
  const tsc = 'npx --yes --package typescript@5 tsc -p packages/event-schemas/tsconfig.json';
  const dist = join(repo, 'packages/event-schemas/dist/index.js');
  const age = (rel, secondsAgo) => { const t = Date.now() / 1000 - secondsAgo; utimesSync(join(repo, rel), t, t); };

  assert.deepEqual(run(), ['npm ci --omit=dev', tsc]);
  assert.ok(existsSync(join(repo, 'node_modules/.openclaw-deps.sha')), 'the install records what it installed from');
  assert.deepEqual(run(), [], 'nothing changed, nothing reinstalled');

  put('package-lock.json', '{"lockfileVersion":3,"v":2}\n');
  assert.deepEqual(run(), ['npm ci --omit=dev'], 'a lockfile change reinstalls');
  put('package.json', '{"name":"r","dependencies":{"nats":"^3"}}\n');
  assert.deepEqual(run(), ['npm ci --omit=dev'], 'a package.json change reinstalls');

  age('packages/event-schemas/dist/index.js', 100);
  age('packages/event-schemas/src/events.ts', 10);
  assert.deepEqual(run(), [tsc], 'a source newer than the dist rebuilds it');
  assert.deepEqual(run(), [], 'the rebuilt dist counts as fresh even when tsc left it untouched');

  rmSync(join(repo, 'package-lock.json'));
  assert.deepEqual(run(), ['npm install --omit=dev'], 'no lockfile (the npm tarball): npm install');

  rmSync(join(repo, 'packages/event-schemas/src'), { recursive: true });
  age('packages/event-schemas/dist/index.js', 100);
  assert.deepEqual(run(), [], 'without src/ the shipped dist is kept');
  rmSync(dist);
  assert.deepEqual(run(), [tsc], 'a missing dist is still built');
});

// What a fleet deploy runs on each node when package.json, package-lock.json or
// packages/ change: the same step, plus the workspace copies workspace.sh makes.
test('deps.sh run standalone refreshes node_modules, the dist, workspace packages/ and the dependency links', () => {
  const root = tmpDir('openclaw-deps-run-');
  const repo = join(root, 'repo');
  const ws = join(root, 'ws');
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  put('repo/package.json', '{"name":"r"}\n');
  put('repo/package-lock.json', '{"v":1}\n');
  put('repo/packages/event-schemas/tsconfig.json', '{}\n');
  put('repo/packages/event-schemas/src/events.ts', 'export const a = 1;\n');
  mkdirSync(ws);
  const calls = join(root, 'calls.log');
  put('fakebin/npm', `#!/bin/sh
echo "npm $*" >> "${calls}"
rm -rf node_modules && mkdir -p node_modules/nats node_modules/@scope/pkg
[ -n "\${DEPS_TEST_NEW_PKG:-}" ] && mkdir -p "node_modules/$DEPS_TEST_NEW_PKG"
exit 0
`);
  put('fakebin/npx', `#!/bin/sh
echo "npx $*" >> "${calls}"
mkdir -p packages/event-schemas/dist && echo built > packages/event-schemas/dist/index.js
`);
  spawnSync('chmod', ['+x', join(root, 'fakebin/npm'), join(root, 'fakebin/npx')]);
  const run = (env = {}) => {
    writeFileSync(calls, '');
    const r = spawnSync('bash', [join(ROOT, 'scripts/install/deps.sh'), repo, ws], {
      encoding: 'utf8',
      env: { ...process.env, HOME: root, OPENCLAW_MESH_HOME: join(root, 'mesh'), PATH: `${join(root, 'fakebin')}:${process.env.PATH}`, ...env },
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    return readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
  };

  assert.deepEqual(run(), ['npm ci --omit=dev', 'npx --yes --package typescript@5 tsc -p packages/event-schemas/tsconfig.json']);
  assert.equal(readFileSync(join(ws, 'packages/event-schemas/dist/index.js'), 'utf8'), 'built\n', 'the workspace gets the built dist');
  for (const nm of [join(ws, 'node_modules'), join(root, 'mesh/node_modules')]) {
    assert.equal(realpathSync(join(nm, 'nats')), realpathSync(join(repo, 'node_modules/nats')));
    assert.equal(realpathSync(join(nm, '@scope/pkg')), realpathSync(join(repo, 'node_modules/@scope/pkg')));
  }
  assert.deepEqual(run(), [], 'nothing changed: no npm, no tsc');

  put('repo/package-lock.json', '{"v":2}\n');
  assert.deepEqual(run({ DEPS_TEST_NEW_PKG: 'added-dep' }), ['npm ci --omit=dev']);
  assert.equal(realpathSync(join(ws, 'node_modules/added-dep')), realpathSync(join(repo, 'node_modules/added-dep')),
    'a dependency the lockfile gained is linked where the workspace daemons resolve it');

  const bad = spawnSync('bash', [join(ROOT, 'scripts/install/deps.sh'), repo], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: bash .*deps\.sh REPO_DIR WORKSPACE/);
});

// Provider-agnostic install (2026-09-08). The runtime drives nine providers
// (lib/llm-providers.js); the installer used to detect three and silently
// `npm install -g` one vendor's CLI when none was found, and the env example
// shipped that vendor as the default. Lock the agnostic behaviour.
test('install --update keeps an existing notify.json and writes the default only when it is missing', () => {
  const src = moduleSrc['services.sh'];
  const start = src.indexOf('NOTIFY_CONFIG="$OPENCLAW_ROOT/config/notify.json"');
  assert.ok(start >= 0);
  const block = src.slice(start, src.indexOf('\nif $SANDBOX; then', start));
  const root = tmpDir('oc-notify-');
  mkdirSync(join(root, 'config'));
  const notify = join(root, 'config', 'notify.json');
  const muted = '{"enabled": false, "sources": {"x": false}}\n';
  writeFileSync(notify, muted);
  const runBlock = () => spawnSync('bash', ['-c', `source "${join(ROOT, 'scripts/install/helpers.sh')}"\n${block}`], {
    encoding: 'utf8', env: { ...process.env, OPENCLAW_ROOT: root, DRY_RUN: 'false', UPDATE_ONLY: 'true' },
  });
  let r = runBlock();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(notify, 'utf8'), muted);
  rmSync(notify);
  r = runBlock();
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(notify, 'utf8'), /"icons"/);
  rmSync(root, { recursive: true, force: true });
});

test('skill pip deps retry past PEP 668 like PyYAML does, and report success only when one install worked', () => {
  const src = moduleSrc['workspace.sh'];
  const start = src.indexOf('for skill_dir in "$WORKSPACE/skills"/*/; do');
  assert.ok(start >= 0);
  const loop = src.slice(start, src.indexOf('\ndone\n', start) + '\ndone\n'.length);
  const tmp = tmpDir('oc-skill-pip-');
  mkdirSync(join(tmp, 'ws/skills/a'), { recursive: true });
  writeFileSync(join(tmp, 'ws/skills/a/requirements.txt'), 'requests>=2\n');
  mkdirSync(join(tmp, 'bin'));
  const runLoop = (pip) => {
    writeFileSync(join(tmp, 'bin/pip3'), `#!/bin/sh\necho "$*" >> "${tmp}/pip.log"\n${pip}\n`, { mode: 0o755 });
    rmSync(join(tmp, 'pip.log'), { force: true });
    const r = spawnSync('bash', ['-c', `run() { "$@"; }; info() { echo "INFO $*"; }; warn() { echo "WARN $*"; }\nWORKSPACE="$1"\n${loop}`, 'x', join(tmp, 'ws')], {
      encoding: 'utf8', env: { ...process.env, PATH: `${join(tmp, 'bin')}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, r.stderr);
    return { out: r.stdout, log: readFileSync(join(tmp, 'pip.log'), 'utf8').trim().split('\n') };
  };
  let { out, log } = runLoop('case "$*" in *--break-system-packages*) exit 0 ;; esac; exit 1');
  assert.equal(log.length, 2);
  assert.match(log[1], /--user --break-system-packages -r .*\/skills\/a\/+requirements\.txt/);
  assert.match(out, /INFO {3}pip: a/);
  assert.doesNotMatch(out, /pip failed/);
  ({ out } = runLoop('exit 1'));
  assert.match(out, /WARN {3}pip failed: a/);
  assert.doesNotMatch(out, /INFO {3}pip: a/);
  rmSync(tmp, { recursive: true, force: true });
});

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
  const repo = tmpDir('oc-souls-repo-');
  const root = tmpDir('oc-souls-root-');
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
  const repo = tmpDir('oc-retire-repo-');
  const root = tmpDir('oc-retire-root-');
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
  for (const name of ['fed-benchmark-driver.mjs', 'grappe-benchmark.mjs']) {
    assert.ok(entries.some(([g, n]) => g === 'mesh-bin' && n === name), `mesh-bin ${name} is not retired`);
  }
  const source = { 'workspace-bin': 'workspace-bin', 'mesh-bin': 'bin', skills: 'skills', 'workspace-lib': 'lib', 'mesh-lib': 'lib' };
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

test('RUNBOOK_MEMORY_DIAG tails each unit\'s stderr file and greps the daemon\'s own log', () => {
  const doc = readFileSync(join(ROOT, 'workspace-docs/RUNBOOK_MEMORY_DIAG.md'), 'utf8');
  const unit = readFileSync(join(ROOT, 'services/systemd/openclaw-memory-daemon.service'), 'utf8');
  const plist = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.memory-daemon.plist'), 'utf8');
  const daemon = readFileSync(join(ROOT, 'workspace-bin/memory-daemon.mjs'), 'utf8');
  const linuxErr = unit.match(/^StandardError=append:\$\{OPENCLAW_WORKSPACE\}\/\.tmp\/(\S+)$/m)[1];
  const macErr = plist.match(/<key>StandardErrorPath<\/key>\s*<string>\$\{OPENCLAW_WORKSPACE\}\/\.tmp\/([^<]+)<\/string>/)[1];
  const lines = doc.split('\n');
  const tailLine = lines.find((l) => l.startsWith('tail -5'));
  for (const f of [linuxErr, macErr]) assert.ok(tailLine.includes(`/.tmp/${f}`), `runbook tail misses ${f}`);
  // The flush lines come from the daemon's log(), which writes the same file on every platform.
  assert.match(daemon, /const LOG_FILE = path\.join\(STATE_DIR, 'memory-daemon\.log'\);/);
  assert.ok(lines.find((l) => l.startsWith('grep -E "flush')).includes('/.tmp/memory-daemon.log'));
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
        ?? text.match(/^Environment="OPENCLAW_NODE_ID=(.*)"$/m)?.[1];
      if (nodeId !== undefined) assert.equal(nodeId, '${OPENCLAW_NODE_ID}', `${f} hardcodes its node id`);
    }
  }
});

test('mesh-deploy ships and restarts the same workspace bin set install.sh copies', () => {
  const deploySrc = readFileSync(join(ROOT, 'bin/mesh-deploy.js'), 'utf8');
  const component = (id) => {
    const start = deploySrc.indexOf(`id: '${id}'`);
    assert.ok(start > 0, `${id} component found`);
    return deploySrc.slice(start, deploySrc.indexOf("id: '", start + 1));
  };
  const wsBin = component('workspace-bin');
  const list = wsBin.match(/\.\.\.\[([^\]]+)\]\.map\(f => `bin\/\$\{f\}`\)/);
  assert.ok(list, 'workspace-bin bin list parsed');
  const shipped = new Set([...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const loop = moduleSrc['workspace.sh'].match(/for _wsbin in ([^;]+); do/);
  const copied = new Set(loop[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean));
  assert.deepEqual([...shipped].sort(), [...copied].sort());

  const services = (text, key) => [...(text.match(new RegExp(`${key}: \\[([^\\]]*)\\]`))?.[1] ?? '')
    .matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'services/service-manifest.json'), 'utf8'));
  for (const { name, timer } of manifest) {
    if (timer) continue;
    const unit = readFileSync(join(ROOT, 'services/systemd', `${name}.service`), 'utf8');
    const script = unit.match(/^ExecStart=.*\$\{OPENCLAW_WORKSPACE\}\/bin\/([\w.-]+)/m)?.[1];
    if (!script || !copied.has(script)) continue;
    const label = `ai.openclaw.${name.replace(/^openclaw-/, '')}`;
    for (const id of ['workspace-bin', 'shared-lib']) {
      assert.ok(services(component(id), 'servicesLinux').includes(name), `${id} never restarts ${name}`);
      assert.ok(services(component(id), 'servicesMac').includes(label), `${id} never restarts ${label}`);
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
    const tz = text.match(/^Environment="TZ=(.*)"$/m)?.[1]
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

// The node id comes from lib/node-id and the workspace from the unit, so daemon.json's
// nodeId was never read and its workspace moved only the MEMORY.md budget.
test('daemon.json carries no node id or workspace key, and the daemon reads neither', () => {
  const template = JSON.parse(readFileSync(join(ROOT, 'config/daemon.json.template'), 'utf8'));
  assert.equal(template.nodeId, undefined);
  assert.equal(template.workspace, undefined);
  const daemon = readFileSync(join(ROOT, 'workspace-bin/memory-daemon.mjs'), 'utf8');
  assert.doesNotMatch(daemon, /nodeId:\s*'daedalus'|config\.workspace|TEST_MODE|\[--test\]/);
  assert.match(daemon, /createBudget\(WORKSPACE, \{/);
});

// install_rule compared the local copy with the NEW source on a version bump;
// an unmodified copy always differs from a newer version, so shipped rule
// updates never landed and every bump wrote .new with a false "modified" warning.
test('install_rule updates unmodified rules on a version bump and keeps edited ones', () => {
  const src = moduleSrc['integrations.sh'];
  const start = src.indexOf('run mkdir -p "$RULES_DIR"\n') + 'run mkdir -p "$RULES_DIR"\n'.length;
  const fns = src.slice(start, src.indexOf('\n}\n', src.indexOf('install_rule() {')) + 3);
  const dir = tmpDir('openclaw-rule-');
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
  const base = tmpDir('openclaw-proj-');
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
  const base = tmpDir('openclaw-proj-');
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

// The deployed paths went into the hooks through a sed replacement, where '&', '|' and
// '\' are special; a shell-quoted literal keeps the hooks' own bash syntax whole too.
test('the hook paths the installer writes survive & | \\ " $ and spaces, and the hooks still run', async () => {
  const base = tmpDir('openclaw-hook-literal-');
  const odd = 'a&b|c\\d "e" $HOME f';
  const repo = join(base, `repo ${odd}`);
  symlinkSync(ROOT, repo);
  const home = join(base, `home ${odd}`);
  mkdirSync(home, { recursive: true });
  const project = join(base, 'project');
  mkdirSync(project);
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: project, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  const script = [
    'REPO_DIR="$1"', 'OPENCLAW_ROOT="$2/.openclaw"', 'WORKSPACE="$OPENCLAW_ROOT/workspace"',
    'DRY_RUN=false; SKIP_MESH=true', 'PROJECT_DIR="$3"', 'mkdir -p "$WORKSPACE"',
    `source ${JSON.stringify(join(ROOT, 'scripts/install/helpers.sh'))}`,
    `source ${JSON.stringify(join(ROOT, 'scripts/install/integrations.sh'))}`,
  ].join('\n');
  const r = spawnSync('bash', ['-c', script, 'x', repo, home, project], { cwd: base, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stderr);

  const claudeHooks = join(home, '.openclaw', 'workspace', '.claude', 'hooks');
  const fakebin = join(base, 'fakebin');
  mkdirSync(fakebin);
  writeFileSync(join(fakebin, 'node'), `#!/bin/sh\necho "$*" >> "${join(base, 'node.log')}"\n`, { mode: 0o755 });
  writeFileSync(join(fakebin, 'gitleaks'), '#!/bin/sh\necho "WRN leaks found: 1" >&2\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${fakebin}:${process.env.PATH}` };
  delete env.OPENCLAW_REPO_DIR;
  writeFileSync(join(base, 'node.log'), '');
  const pre = spawnSync('bash', [join(claudeHooks, 'pre-compact.sh')], { encoding: 'utf8', env, cwd: base });
  assert.equal(pre.status, 0, pre.stderr);
  for (let i = 0; i < 100 && !readFileSync(join(base, 'node.log'), 'utf8'); i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(readFileSync(join(base, 'node.log'), 'utf8').trim(), `${repo}/bin/openclaw-extract-now.mjs --triggered-by=claude-code-pre-compact`);

  writeFileSync(join(project, 'a.txt'), 'hello\n');
  git('add', 'a.txt');
  const commit = spawnSync('bash', [join(project, '.git', 'hooks', 'pre-commit')], { cwd: project, encoding: 'utf8', env });
  assert.equal(commit.status, 2, commit.stdout + commit.stderr);
  assert.match(commit.stdout, /gitleaks detected secrets/);
});

// The git hooks copied into a --project repo delegated to ${ROOT}/.claude/hooks, which
// only this checkout has, so in the project they validated nothing and exited 0.
test('--project git hooks run the deployed validators', () => {
  for (const hook of ['pre-commit', 'pre-push']) {
    assert.match(readFileSync(join(ROOT, 'config/git-hooks', hook), 'utf8'), /^DEPLOYED_HOOK_DIR=""$/m,
      `this checkout's own ${hook} keeps using its in-repo validators`);
  }
  const base = tmpDir('openclaw-proj-hooks-');
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  const project = join(base, 'project');
  mkdirSync(project);
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: project, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  const r = runIntegrations({ cwd: base, home, project });
  assert.equal(r.status, 0, r.stderr);
  const deployed = join(home, '.openclaw', 'workspace', '.claude', 'hooks');
  assert.match(readFileSync(join(project, '.git', 'hooks', 'pre-commit'), 'utf8'),
    new RegExp(`^DEPLOYED_HOOK_DIR=${deployed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));

  const fakebin = join(base, 'fakebin');
  mkdirSync(fakebin);
  writeFileSync(join(fakebin, 'gitleaks'), '#!/bin/sh\necho "WRN leaks found: 1" >&2\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${fakebin}:${process.env.PATH}` };
  writeFileSync(join(project, 'a.txt'), 'hello\n');
  git('add', 'a.txt');
  const commit = spawnSync('bash', [join(project, '.git', 'hooks', 'pre-commit')], { cwd: project, encoding: 'utf8', env });
  assert.equal(commit.status, 2, commit.stdout + commit.stderr);
  assert.match(commit.stdout, /gitleaks detected secrets/);

  git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'a');
  const push = spawnSync('bash', [join(project, '.git', 'hooks', 'pre-push'), 'origin', 'url'], { cwd: project, encoding: 'utf8', input: '' });
  assert.equal(push.status, 0, push.stdout + push.stderr);
  assert.match(push.stdout, /protected branch 'main'/);
  rmSync(base, { recursive: true, force: true });
});

// On macOS workspace.sh holds the timer-source copy lock on fd 9 for the whole run. The
// detached `ollama serve` fallback inherited fd 9, kept the lock after install.sh exited,
// and every later install (and install-timer-hold.py) refused to run.
test('the detached ollama fallback does not inherit the timer-source copy lock', (t) => {
  if (spawnSync('sh', ['-c', 'command -v flock'], { encoding: 'utf8' }).status !== 0) {
    t.skip('flock not installed');
    return;
  }
  const comp = moduleSrc['components.sh'];
  const start = comp.indexOf('brew services start ollama >/dev/null 2>&1 || {');
  const end = comp.indexOf('\n        }\n', start);
  assert.ok(start > 0 && end > start, 'the macOS ollama fallback must be found');
  const block = comp.slice(start, end + '\n        }\n'.length);

  const root = tmpDir('openclaw-ollama-lock-');
  mkdirSync(join(root, 'logs'));
  mkdirSync(join(root, 'fakebin'));
  const marker = `${30 + Math.floor(Math.random() * 1000)}.731`;
  writeFileSync(join(root, 'fakebin', 'brew'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(root, 'fakebin', 'ollama'), `#!/bin/sh\nexec sleep ${marker}\n`, { mode: 0o755 });
  t.after(() => {
    spawnSync('pkill', ['-f', `sleep ${marker}`]);
    rmSync(root, { recursive: true, force: true });
  });
  const lock = join(root, 'timer-source-copy.lock');
  const env = { ...process.env, PATH: `${join(root, 'fakebin')}:${process.env.PATH}`, OPENCLAW_ROOT: root, LOCK: lock };
  delete env.OPENCLAW_NATS_LEGACY_LOCK_HELD;
  const r = spawnSync('bash', ['-c', `set -euo pipefail
exec 9>>"$LOCK"; flock -n 9 || exit 3
${block}`], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  let started = false;
  for (let i = 0; i < 40 && !started; i++) {
    started = spawnSync('pgrep', ['-f', `sleep ${marker}`]).status === 0;
    if (!started) spawnSync('sleep', ['0.05']);
  }
  assert.ok(started, 'the fallback must have started ollama');
  const relock = spawnSync('flock', ['-n', lock, 'true']);
  assert.equal(relock.status, 0, 'the copy lock must be free once the installer exits');
});

// `install.sh --update` re-synced Mission Control's source but kept the old
// .next, ran a loose `npm install`, never deleted routes removed from the repo,
// and the unit's PATH could resolve a node other than the one the native deps
// were built for. It now follows workspace-docs/RUNBOOK_MC_DEPLOY.md.
test('install --update redeploys Mission Control: exact sync, npm@10 ci, rebuild under NODE_BIN, build kept on failure', () => {
  const comp = moduleSrc['components.sh'];
  const block = comp.slice(comp.indexOf('MC_DIR="$WORKSPACE/projects/mission-control"'),
    comp.indexOf('# Create .env.local for MC if not exists'));
  assert.ok(block.includes('mc_install_and_build "$MC_DIR" "$NODE_BIN_DIR"'), 'the Mission Control step must be found');

  const root = tmpDir('openclaw-mc-update-');
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
  for (const f of ['mc-build.sh', 'deps.sh', 'helpers.sh']) put(`repo/scripts/install/${f}`, readFileSync(join(ROOT, 'scripts/install', f), 'utf8'));
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

  writeFileSync(calls, '');
  const failed = install({ MC_TEST_BUILD_FAIL: '1' });
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stdout, /WARN Mission Control build FAILED — the previous build is still in place/);
  assert.equal(read(`${mc}/.next/BUILD_ID`), 'new build\n', 'a failed build leaves the previous one in place');
  assert.equal(existsSync(join(root, mc, '.next.prev')), false);
  assert.deepEqual(read('calls.log').trim().split('\n'), [`npm run build PATH0=${nodeDir}`],
    'an unchanged lockfile and node: no reinstall');

  // The fleet deploy's 'mc' component runs the same script on its own, and a
  // failed build fails it (the deploy listener then rolls back).
  writeFileSync(calls, '');
  put('ws/projects/mission-control/package-lock.json', '{"lockfileVersion":3}\n');
  const standalone = (env = {}) => spawnSync('bash', [join(root, 'repo/scripts/install/mc-build.sh'), join(root, mc), nodeDir], {
    encoding: 'utf8', env: { ...process.env, PATH: `${join(root, 'fakebin')}:${process.env.PATH}`, ...env },
  });
  const deployed = standalone();
  assert.equal(deployed.status, 0, deployed.stderr + deployed.stdout);
  assert.deepEqual(read('calls.log').trim().split('\n'), [
    `npx -y npm@10 ci PATH0=${nodeDir}`,
    `npm rebuild better-sqlite3 PATH0=${nodeDir}`,
    `npm run build PATH0=${nodeDir}`,
  ], 'a lockfile change reinstalls and rebuilds the native module under NODE_BIN_DIR');
  const broken = standalone({ MC_TEST_BUILD_FAIL: '1' });
  assert.equal(broken.status, 1, broken.stdout);
  assert.match(broken.stdout, /Mission Control build FAILED — the previous build is still in place/);
  assert.equal(read(`${mc}/.next/BUILD_ID`), 'new build\n');

  // The unit runs that same node: NODE_BIN's dir leads its PATH.
  const plist = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.mission-control.plist'), 'utf8');
  assert.match(plist, /<key>PATH<\/key>\s*<string>\$\{NODE_BIN_DIR\}:/);
  const unit = readFileSync(join(ROOT, 'services/systemd/openclaw-mission-control.service'), 'utf8');
  assert.match(unit, /^Environment="PATH=\$\{NODE_BIN_DIR\}:/m);
  assert.match(moduleSrc['env.sh'], /export NODE_BIN_DIR="\$\(dirname "\$NODE_BIN"\)"/);
});

// session-stop.sh was wired to Stop, which Claude Code fires after every assistant turn,
// so each turn appended a false "Session ended" block to the day's memory log.
test('session-stop.sh runs on SessionEnd, and an --update merge drops its old Stop entry', (t) => {
  const SESSION_STOP = 'bash .claude/hooks/session-stop.sh';
  const settings = JSON.parse(readFileSync(join(ROOT, 'config/claude-settings.json'), 'utf8'));
  assert.equal(settings.hooks.Stop, undefined);
  assert.ok(settings.hooks.SessionEnd.some((e) => e.hooks.some((h) => h.command === SESSION_STOP)));

  if (spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status !== 0) {
    t.skip('jq not installed');
    return;
  }
  const integ = moduleSrc['integrations.sh'];
  const start = integ.indexOf('MERGED=$(jq -s');
  const endMark = `' "$SETTINGS_DST" "$SETTINGS_SRC")`;
  const end = integ.indexOf(endMark, start);
  assert.ok(start > 0 && end > start, 'the settings merge must be found');
  const block = integ.slice(start, end + endMark.length);
  const root = tmpDir('openclaw-settings-merge-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const merge = (existing) => {
    const dst = join(root, 'settings.json');
    writeFileSync(dst, JSON.stringify(existing));
    const r = spawnSync('bash', ['-c', `set -euo pipefail\n${block}\necho "$MERGED"`], {
      encoding: 'utf8', env: { ...process.env, SETTINGS_SRC: join(ROOT, 'config/claude-settings.json'), SETTINGS_DST: dst },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const entry = (...commands) => ({ matcher: '', hooks: commands.map((command) => ({ type: 'command', command })) });
  const permissions = { allow: ['Bash(make *)'] };

  const mixed = merge({ permissions, hooks: { Stop: [entry(SESSION_STOP, 'my-own.sh')] } });
  assert.deepEqual(mixed.permissions, permissions);
  assert.deepEqual(mixed.hooks.Stop, [entry('my-own.sh')]);
  assert.ok(mixed.hooks.SessionEnd.some((e) => e.hooks.some((h) => h.command === SESSION_STOP)));

  const only = merge({ permissions, hooks: { Stop: [entry(SESSION_STOP)] } });
  assert.equal(only.hooks.Stop, undefined);
  assert.ok(only.hooks.SessionEnd.some((e) => e.hooks.some((h) => h.command === SESSION_STOP)));
});

// The PreCompact hook the installer deploys (and wires in config/claude-settings.json)
// was a no-op stub, so no extraction fired on compaction. It now runs the trigger
// CLI from the checkout, both as the repo copy and as the deployed copy.
test('the deployed PreCompact hook fires the extraction trigger from the checkout', async () => {
  const integ = moduleSrc['integrations.sh'];
  const block = integ.slice(integ.indexOf('# Deploy hook scripts'), integ.indexOf('info "Deployed Claude Code hooks"'));
  assert.ok(block.includes('pre-compact'), 'the hook deploy step must be found');
  assert.match(readFileSync(join(ROOT, 'config/claude-settings.json'), 'utf8'), /"command": "bash \.claude\/hooks\/pre-compact\.sh"/);

  const root = tmpDir('openclaw-precompact-');
  const claudeDir = join(root, 'workspace', '.claude');
  mkdirSync(join(claudeDir, 'hooks'), { recursive: true });
  mkdirSync(join(root, 'fakebin'));
  writeFileSync(join(root, 'fakebin', 'node'), `#!/bin/sh\necho "$*" >> "${join(root, 'node.log')}"\n`, { mode: 0o755 });
  const deploy = spawnSync('bash', ['-c', `set -euo pipefail; source "${join(ROOT, 'scripts/install/helpers.sh')}"; DRY_RUN=false; REPO_DIR="${ROOT}"; CLAUDE_DIR="${claudeDir}"\n${block}`], { encoding: 'utf8' });
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
