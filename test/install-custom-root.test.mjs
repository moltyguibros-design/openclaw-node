// OPENCLAW_ROOT set to anything but ~/.openclaw only moved where the installers WROTE
// (openclaw.env, identity, configs, units): every NATS client, the memory daemon, the mesh
// agent and the gateway plugin still read ~/.openclaw, so the node came up half-configured.
// Every installer entry point now refuses such a root before it writes or installs anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { tmpDir } = createRequire(import.meta.url)('./helpers/tmp-dir.cjs');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every tool that installs packages, fetches code or touches services: a call is a side effect.
const SIDE_EFFECT_TOOLS = [
  'sudo', 'apt-get', 'apt', 'yum', 'dnf', 'brew', 'systemctl', 'launchctl', 'loginctl', 'crontab',
  'npm', 'npx', 'curl', 'wget', 'git', 'ollama', 'tailscale', 'rsync', 'pip3', 'nats-server', 'plutil',
  'xcode-select',
];

function sandbox({ rootExists = false } = {}) {
  const dir = tmpDir('oc-custom-root-');
  const home = join(dir, 'home');
  mkdirSync(home);
  const elsewhere = join(dir, 'elsewhere');
  if (rootExists) {
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'openclaw.env'), 'KEPT=1\n');
  }
  const stub = join(dir, 'stub');
  mkdirSync(stub);
  const calls = join(dir, 'calls.log');
  for (const name of SIDE_EFFECT_TOOLS) {
    writeFileSync(join(stub, name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(calls)}\nexit 1\n`);
    chmodSync(join(stub, name), 0o755);
  }
  const env = (extra = {}) => ({
    PATH: `${stub}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: home,
    OPENCLAW_ROOT: elsewhere,
    ...extra,
  });
  const run = (cmd, args, extra = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, env: env(extra), input: '' });
  return { dir, home, elsewhere, calls, env, run };
}

function assertRefusedUntouched(sb, r, label, { rootExists = false } = {}) {
  const out = `${label}: exit ${r.status}\n--- stdout ---\n${(r.stdout || '').slice(-1500)}\n--- stderr ---\n${(r.stderr || '').slice(-1500)}`;
  assert.notEqual(r.status, 0, out);
  assert.ok(r.stderr.includes(`OPENCLAW_ROOT=${sb.elsewhere}: a custom install root is not supported.`), out);
  assert.match(r.stderr, /would still read ~\/\.openclaw/, out);
  assert.match(r.stderr, /Nothing was written\. Run "unset OPENCLAW_ROOT", then run this again\./, out);
  assert.match(r.stderr, /bin\/spawn-node\.mjs --id <name> creates ~\/\.openclaw-<name>/, out);
  assert.deepEqual(readdirSync(sb.home), [], `${label}: nothing may be created under HOME\n${out}`);
  if (rootExists) {
    assert.deepEqual(readdirSync(sb.elsewhere), ['openclaw.env'], `${label}: the custom root is left as it was\n${out}`);
    assert.equal(readFileSync(join(sb.elsewhere, 'openclaw.env'), 'utf8'), 'KEPT=1\n', label);
  } else {
    assert.equal(existsSync(sb.elsewhere), false, `${label}: the custom root must not be created\n${out}`);
  }
  assert.equal(existsSync(sb.calls), false, `${label}: no package, fetch or service tool may run\n${existsSync(sb.calls) ? readFileSync(sb.calls, 'utf8') : ''}`);
}

const refusalBlock = (stderr) => {
  const lines = stderr.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const start = lines.findIndex((l) => l.startsWith('OPENCLAW_ROOT='));
  return start < 0 ? '' : lines.slice(start, start + 4).join('\n');
};

const INSTALL_SH = join(ROOT, 'install.sh');

for (const args of [['--dry-run', '--sandbox', '--role=worker'], ['--role=worker'], ['--update'], ['--update', '--dry-run']]) {
  test(`install.sh ${args.join(' ')} refuses a custom OPENCLAW_ROOT before writing anything`, () => {
    const sb = sandbox();
    assertRefusedUntouched(sb, sb.run('bash', [INSTALL_SH, ...args]), `install.sh ${args.join(' ')}`);
  });
}

test('install.sh --update refuses an existing custom-root install and leaves it as it was', () => {
  const sb = sandbox({ rootExists: true });
  assertRefusedUntouched(sb, sb.run('bash', [INSTALL_SH, '--update']), 'install.sh --update', { rootExists: true });
});

// --help prints and exits before anything is written, right after the root check.
test('install.sh gets past the root check for the default, an explicit ~/.openclaw, trailing slashes and a symlink to it', () => {
  const sb = sandbox();
  const cases = [
    ['unset', { OPENCLAW_ROOT: undefined }],
    ['empty', { OPENCLAW_ROOT: '' }],
    ['explicit', { OPENCLAW_ROOT: join(sb.home, '.openclaw') }],
    ['trailing slash', { OPENCLAW_ROOT: `${join(sb.home, '.openclaw')}/` }],
    ['trailing slashes', { OPENCLAW_ROOT: `${join(sb.home, '.openclaw')}//` }],
  ];
  for (const [label, extra] of cases) {
    const env = sb.env(extra);
    if (extra.OPENCLAW_ROOT === undefined) delete env.OPENCLAW_ROOT;
    const r = spawnSync('bash', [INSTALL_SH, '--help'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${label}: ${r.stderr}`);
    assert.match(r.stdout, /^Usage: bash install\.sh/m, label);
    assert.doesNotMatch(r.stderr, /not supported/, label);
  }
  assert.deepEqual(readdirSync(sb.home), []);

  mkdirSync(join(sb.home, '.openclaw'));
  const link = join(sb.dir, 'link-to-default');
  symlinkSync(join(sb.home, '.openclaw'), link);
  const r = sb.run('bash', [INSTALL_SH, '--help'], { OPENCLAW_ROOT: link });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Usage: bash install\.sh/m);

  const other = join(sb.dir, 'other-existing');
  mkdirSync(other);
  const refused = sb.run('bash', [INSTALL_SH, '--help'], { OPENCLAW_ROOT: other });
  assert.notEqual(refused.status, 0, 'an existing directory that is not ~/.openclaw is still refused');
  assert.ok(refused.stderr.includes(`OPENCLAW_ROOT=${other}: a custom install root is not supported.`), refused.stderr);
});

// A whole dry run, as the --dry-run tests in install-modules run it, for each accepted
// spelling: it completes and uses the one canonical root, never the alias it was given.
test('install.sh --dry-run completes under an explicit ~/.openclaw, a trailing slash and a symlink to it', () => {
  const sb = sandbox();
  mkdirSync(join(sb.home, '.openclaw'));
  const link = join(sb.dir, 'link-to-default');
  symlinkSync(join(sb.home, '.openclaw'), link);
  const canonical = join(sb.home, '.openclaw');
  for (const root of [canonical, `${canonical}/`, link]) {
    const r = spawnSync('bash', [INSTALL_SH, '--dry-run', '--sandbox', '--role=worker'], {
      encoding: 'utf8', timeout: 300_000, env: { ...process.env, HOME: sb.home, OPENCLAW_ROOT: root },
    });
    const out = `${root}: exit ${r.status}\n${r.stdout.slice(-2000)}\n${r.stderr.slice(-500)}`;
    assert.equal(r.status, 0, out);
    assert.doesNotMatch(r.stderr, /not supported/, out);
    assert.ok(r.stdout.includes(`${canonical}/workspace`), out);
    assert.ok(!r.stdout.includes(`${canonical}//`), `${root}: rendered a doubled slash`);
    assert.ok(!r.stdout.includes(link), `${root}: rendered the alias`);
    assert.deepEqual(readdirSync(canonical), [], `${root}: a dry run writes nothing`);
  }
});

// The installer's own --help says so.
test('install.sh --help says a custom OPENCLAW_ROOT is refused and why', () => {
  const r = spawnSync('bash', [INSTALL_SH, '--help'], { encoding: 'utf8', env: { ...process.env, OPENCLAW_ROOT: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OPENCLAW_ROOT/);
  assert.match(r.stdout, /refused/);
  assert.match(r.stdout, /read ~\/\.openclaw/);
});

test('install.sh renders the default root, whichever accepted spelling OPENCLAW_ROOT had', () => {
  const src = readFileSync(INSTALL_SH, 'utf8');
  assert.match(src, /^export OPENCLAW_ROOT="\$HOME\/\.openclaw"$/m);
  const guard = src.indexOf('refuse_custom_openclaw_root');
  assert.ok(guard > 0, 'install.sh runs the root check');
  for (const later of ['NATS_WRITER_LOCK=', 'nats-legacy-lock.py', 'export OPENCLAW_ROOT=', 'for arg in "$@"']) {
    assert.ok(src.indexOf(later) > guard, `the root check runs before ${later}`);
  }
});

// The npx harness copies itself to <root>/harness/<version> before install.sh runs.
test('cli.js under npx refuses a custom OPENCLAW_ROOT before copying the package or running anything', () => {
  for (const args of [['--update'], ['--mesh-only'], ['--dry-run']]) {
    const sb = sandbox();
    const pkg = join(sb.dir, 'npm-cache', '_npx', 'f00d', 'node_modules', 'openclaw-node-harness');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    copyFileSync(join(ROOT, 'cli.js'), join(pkg, 'cli.js'));
    symlinkSync(join(ROOT, 'lib'), join(pkg, 'lib'));
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'openclaw-node-harness', version: '9.9.9' }));
    writeFileSync(join(pkg, 'install.sh'), `touch ${JSON.stringify(join(sb.dir, 'install-ran'))}\n`);
    writeFileSync(join(pkg, 'bin', 'openclaw-node-init.js'), `require('fs').writeFileSync(${JSON.stringify(join(sb.dir, 'init-ran'))}, '')\n`);
    const r = sb.run(process.execPath, [join(pkg, 'cli.js'), ...args]);
    assertRefusedUntouched(sb, r, `cli.js ${args.join(' ')}`);
    assert.equal(existsSync(join(sb.dir, 'install-ran')), false, 'install.sh never ran');
    assert.equal(existsSync(join(sb.dir, 'init-ran')), false, 'node-init never ran');
  }
});

// A worker join renders its units' PATH from OPENCLAW_ROOT but writes openclaw.env and the
// identity to ~/.openclaw.
test('openclaw-node-init refuses a custom OPENCLAW_ROOT before touching anything', () => {
  for (const args of [['--nats', 'nats://127.0.0.1:9'], ['--dry-run', '--nats', 'nats://127.0.0.1:9']]) {
    const sb = sandbox();
    const r = sb.run(process.execPath, [join(ROOT, 'bin', 'openclaw-node-init.js'), ...args], { MESH_JOIN_TOKEN: '' });
    assertRefusedUntouched(sb, r, `openclaw-node-init ${args.join(' ')}`);
    assert.doesNotMatch(r.stdout, /Detecting environment/, 'refused before step 1');
  }
});

// bootstrap.sh installs Homebrew/apt packages before it hands off to install.sh.
test('bootstrap.sh refuses a custom OPENCLAW_ROOT before the dependency wave', () => {
  const sb = sandbox();
  const r = sb.run('bash', [join(ROOT, 'bootstrap.sh'), '--role=worker', '--skip-llm']);
  assertRefusedUntouched(sb, r, 'bootstrap.sh');
  assert.doesNotMatch(r.stdout, /platform:/, 'refused before anything else ran');

  const depsOnly = sb.run('bash', [join(ROOT, 'bootstrap.sh'), '--skip-llm'], { OPENCLAW_NO_INSTALL: '1' });
  assert.doesNotMatch(depsOnly.stderr, /not supported/, 'OPENCLAW_NO_INSTALL=1 runs no installer, so the root does not matter');
  assert.match(depsOnly.stdout, /platform:/);
});

// mesh-install.sh installs Node/git and clones before it hands off to openclaw-node-init.
test('mesh-install.sh refuses a custom OPENCLAW_ROOT before installing or cloning', () => {
  const sb = sandbox();
  const r = sb.run('bash', [join(ROOT, 'mesh-install.sh')], { MESH_JOIN_TOKEN: 'x' });
  assertRefusedUntouched(sb, r, 'mesh-install.sh');
});

// Wave 2 writes LLM_MODEL/LLM_BASE_URL to <root>/openclaw.env, which the memory daemon never reads.
test('llm-setup.sh refuses a custom OPENCLAW_ROOT before writing the env file or pulling', () => {
  for (const args of [['--check'], ['--yes'], ['--embedder-only']]) {
    const sb = sandbox();
    const r = sb.run('bash', [join(ROOT, 'scripts/install/llm-setup.sh'), ...args], { NODE_BIN: process.execPath });
    assertRefusedUntouched(sb, r, `llm-setup.sh ${args.join(' ')}`);
  }
});

test('every installer entry point prints the same refusal', () => {
  const sb = sandbox();
  const runs = {
    'install.sh': sb.run('bash', [INSTALL_SH, '--update']),
    'llm-setup.sh': sb.run('bash', [join(ROOT, 'scripts/install/llm-setup.sh'), '--check']),
    'bootstrap.sh': sb.run('bash', [join(ROOT, 'bootstrap.sh'), '--role=worker']),
    'mesh-install.sh': sb.run('bash', [join(ROOT, 'mesh-install.sh')], { MESH_JOIN_TOKEN: 'x' }),
    'cli.js': sb.run(process.execPath, [join(ROOT, 'cli.js'), '--update']),
    'openclaw-node-init.js': sb.run(process.execPath, [join(ROOT, 'bin', 'openclaw-node-init.js'), '--dry-run']),
  };
  const expected = refusalBlock(runs['install.sh'].stderr);
  assert.equal(expected.split('\n').length, 4, runs['install.sh'].stderr);
  for (const [name, r] of Object.entries(runs)) {
    assert.equal(refusalBlock(r.stderr), expected, `${name}\n${r.stdout}\n${r.stderr}`);
  }
});

// bootstrap.sh and mesh-install.sh carry their own copy of the check (they run before
// the repo is on disk), so each entry point is run with every accepted spelling.
test('every entry point accepts ~/.openclaw however it is spelled', () => {
  const sb = sandbox();
  const canonical = join(sb.home, '.openclaw');
  mkdirSync(canonical);
  const link = join(sb.dir, 'link-to-default');
  symlinkSync(canonical, link);
  const { isDefaultOpenclawRoot, customRootRefusal } = createRequire(import.meta.url)('../lib/openclaw-root.js');
  for (const root of [undefined, '', canonical, `${canonical}/`, `${canonical}//`, link]) {
    const extra = { OPENCLAW_ROOT: root };
    const env = sb.env(extra);
    if (root === undefined) delete env.OPENCLAW_ROOT;
    const runs = {
      'bootstrap.sh': [spawnSync('bash', [join(ROOT, 'bootstrap.sh'), '--role=worker', '--skip-llm'], { encoding: 'utf8', timeout: 60_000, env }), /platform:/],
      'mesh-install.sh': [spawnSync('bash', [join(ROOT, 'mesh-install.sh')], { encoding: 'utf8', timeout: 60_000, env: { ...env, MESH_JOIN_TOKEN: 'x' } }), /Detected OS/],
      'llm-setup.sh': [spawnSync('bash', [join(ROOT, 'scripts/install/llm-setup.sh'), '--check'], { encoding: 'utf8', timeout: 60_000, env: { ...env, NODE_BIN: process.execPath } }), /Wave 2/],
    };
    for (const [name, [r, ran]] of Object.entries(runs)) {
      assert.doesNotMatch(r.stderr, /not supported/, `${name} with OPENCLAW_ROOT=${root}`);
      assert.match(r.stdout, ran, `${name} with OPENCLAW_ROOT=${root} got past the check\n${r.stdout}\n${r.stderr}`);
    }
    assert.equal(isDefaultOpenclawRoot(root, sb.home), true, String(root));
    assert.equal(customRootRefusal(root, sb.home), null, String(root));
  }
  assert.equal(isDefaultOpenclawRoot(join(sb.dir, 'elsewhere'), sb.home), false);
  assert.equal(isDefaultOpenclawRoot(sb.dir, sb.home), false, 'an existing directory that is not ~/.openclaw');
});

// An install made with a custom root before the refusal must still come off.
test('uninstall.sh still removes an install made under a custom OPENCLAW_ROOT', { skip: process.platform !== 'linux' && 'uninstall.sh lock step is Darwin-specific' }, () => {
  const sb = sandbox({ rootExists: true });
  for (const rel of ['workspace/bin/x', 'config/daemon.json', 'identity.key']) {
    mkdirSync(dirname(join(sb.elsewhere, rel)), { recursive: true });
    writeFileSync(join(sb.elsewhere, rel), 'x');
  }
  const purge = spawnSync('bash', [join(ROOT, 'uninstall.sh'), '--purge'], { encoding: 'utf8', env: sb.env(), input: 'y\n' });
  assert.equal(purge.status, 0, `${purge.stdout}\n${purge.stderr}`);
  assert.doesNotMatch(purge.stderr, /not supported/);
  assert.equal(existsSync(sb.elsewhere), false, purge.stdout);
});
