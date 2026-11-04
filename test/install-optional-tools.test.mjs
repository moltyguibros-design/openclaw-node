import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

function executable(file, body) {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  return { root, bin, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function section(file, start, end) {
  const source = fs.readFileSync(path.join(repo, file), 'utf8');
  const first = source.indexOf(start), last = end ? source.indexOf(end, first) : source.length;
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function runSection(f, text, env) {
  const script = path.join(f.root, 'section.sh');
  fs.writeFileSync(script, text);
  return spawnSync('/bin/bash', ['-c',
    'set -e; step(){ :; }; info(){ echo "$*"; }; warn(){ echo "$*"; }; error(){ echo "$*"; }; run(){ "$@"; }; source "$OWNED_SECTION"'],
  { env: { ...f.env, ...env, OWNED_SECTION: script }, encoding: 'utf8' });
}

function browserSection(f, identity = 'ID=ubuntu\nVERSION_ID="24.04"\n') {
  const release = path.join(f.root, 'os-release');
  fs.writeFileSync(release, identity);
  executable(path.join(f.bin, 'uname'), 'if [ "$1" = -m ]; then printf "%s\\n" "${OWNED_MACHINE_ARCH:-aarch64}"; else /usr/bin/uname "$@"; fi');
  return section('scripts/install/components.sh', 'step "Step 12: Playwright Browser"', 'step "Step 13: Companion Bridge"')
    .replaceAll('/etc/os-release', release);
}

function playwrightFixture(t, identity = 'ID=ubuntu\nVERSION_ID="26.04"\n') {
  const f = fixture(t), source = path.join(f.root, 'source'), workspace = path.join(f.root, 'workspace');
  const playwright = path.join(source, 'node_modules', 'playwright');
  const core = path.join(source, 'node_modules', 'playwright-core');
  fs.mkdirSync(playwright, { recursive: true });
  fs.mkdirSync(core, { recursive: true });
  fs.mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
  fs.symlinkSync(playwright, path.join(workspace, 'node_modules', 'playwright'));
  for (const dir of [playwright, core]) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.58.2' }));
  fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/playwright': { version: '1.58.2' },
    'node_modules/playwright-core': { version: '1.58.2' },
  } }));
  fs.writeFileSync(path.join(core, 'browsers.json'), JSON.stringify({ browsers: [
    { name: 'chromium', revision: '1208' },
    { name: 'chromium-headless-shell', revision: '1208' },
    { name: 'ffmpeg', revision: '1011' },
  ] }));
  fs.writeFileSync(path.join(playwright, 'cli.js'), `require('node:fs').appendFileSync(process.env.OWNED_CLI_CALLS, process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE + ' ' + process.argv.slice(2).join(' ') + '\\n'); if (process.env.OWNED_FAIL_CLI === '1') process.exit(42);`);
  fs.writeFileSync(path.join(playwright, 'index.js'), `exports.chromium = { launch: async () => { require('node:fs').appendFileSync(process.env.OWNED_LAUNCH_CALLS, process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE + '\\n'); if (process.env.OWNED_FAIL_LAUNCH === '1') throw new Error('owned raw launch diagnostic'); return { close: async () => {} }; } };`);
  executable(path.join(f.bin, 'npx'), 'printf "%s\\n" "$*" >> "$OWNED_NPX_CALLS"; exit 99');
  const node = path.join(f.bin, 'node');
  executable(node, 'if [ "$1" = -p ] && [ "$2" = process.arch ]; then printf "%s\\n" "${OWNED_NODE_ARCH:-arm64}"; else exec "$OWNED_REAL_NODE" "$@"; fi');
  const env = { REPO_DIR: source, WORKSPACE: workspace, SANDBOX: 'false', DRY_RUN: 'false', OS: 'linux',
    UPDATE_ONLY: 'false', NODE_BIN: node, OWNED_REAL_NODE: process.execPath,
    OWNED_CLI_CALLS: path.join(f.root, 'cli-calls'), OWNED_LAUNCH_CALLS: path.join(f.root, 'launch-calls'),
    OWNED_NPX_CALLS: path.join(f.root, 'npx-calls'), OWNED_ENV_AFTER: path.join(f.root, 'env-after') };
  return { f, source, workspace, env, body: browserSection(f, identity) };
}

test('installed skills retain their scripts and use a verified managed Python environment', t => {
  const f = fixture(t), source = path.join(f.root, 'source'), workspace = path.join(f.root, 'workspace');
  const skill = path.join(source, 'skills', 'sample');
  fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(skill, 'requirements.txt'), 'sample>=1\n');
  fs.writeFileSync(path.join(skill, 'scripts', 'run.py'), 'print("ready")\n');
  const python = path.join(f.bin, 'python3');
  executable(python,
    'if [ "$1" = -m ] && [ "$2" = venv ]; then mkdir -p "$3/bin"; cp "$OWNED_PYTHON" "$3/bin/python"; exit 0; fi\n' +
    'printf "%s\\n" "$*" >> "$OWNED_PIP_CALLS"\n' +
    '[ "${OWNED_FAIL_PIP:-0}" = 1 ] && exit 42\nexit 0');
  const env = { REPO_DIR: source, WORKSPACE: workspace, SANDBOX: 'false', DRY_RUN: 'false',
    OWNED_PYTHON: python, OWNED_PIP_CALLS: path.join(f.root, 'pip-calls') };
  const body = section('scripts/install/workspace.sh', 'step "Step 6: Skills"');
  const result = runSection(f, body, env);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(workspace, 'skills', 'sample', 'scripts', 'run.py'), 'utf8'), 'print("ready")\n');
  assert.deepEqual(fs.readFileSync(env.OWNED_PIP_CALLS, 'utf8').trim().split('\n'),
    ['-m pip install -r ' + path.join(workspace, 'skills', 'sample', 'requirements.txt'), '-m pip check']);
  const fail = runSection(f, body, { ...env, OWNED_FAIL_PIP: '1' });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stdout, /Python requirements failed/);
});

test('Linux browser readiness requires dependency install and a real launch check', t => {
  const f = fixture(t), source = path.join(f.root, 'source'), workspace = path.join(f.root, 'workspace');
  fs.mkdirSync(source);
  fs.mkdirSync(path.join(workspace, 'node_modules', 'playwright'), { recursive: true });
  executable(path.join(f.bin, 'npx'), 'printf "%s\\n" "$*" >> "$OWNED_NPX_CALLS"; [ "${OWNED_FAIL_NPX:-0}" != 1 ]');
  const node = path.join(f.bin, 'node');
  executable(node, 'printf "%s\\n" "$*" >> "$OWNED_NODE_CALLS"; [ "${OWNED_FAIL_NODE:-0}" != 1 ]');
  const env = { REPO_DIR: source, WORKSPACE: workspace, SANDBOX: 'false', DRY_RUN: 'false',
    OS: 'linux', UPDATE_ONLY: 'false', NODE_BIN: node, OWNED_NPX_CALLS: path.join(f.root, 'npx-calls'),
    OWNED_NODE_CALLS: path.join(f.root, 'node-calls') };
  const body = browserSection(f);
  const pass = runSection(f, body, env);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(fs.readFileSync(env.OWNED_NPX_CALLS, 'utf8'), /playwright install --with-deps chromium/);
  assert.match(fs.readFileSync(env.OWNED_NODE_CALLS, 'utf8'), /chromium\.launch/);
  const update = runSection(f, body, { ...env, UPDATE_ONLY: 'true' });
  assert.equal(update.status, 0, update.stdout + update.stderr);
  assert.equal(fs.readFileSync(env.OWNED_NPX_CALLS, 'utf8').trim().split('\n').at(-1), 'playwright install chromium');
  const installFailure = runSection(f, body, { ...env, OWNED_FAIL_NPX: '1' });
  assert.notEqual(installFailure.status, 0);
  assert.match(installFailure.stdout, /system dependencies failed to install/);
  const launchFailure = runSection(f, body, { ...env, OWNED_FAIL_NODE: '1' });
  assert.notEqual(launchFailure.status, 0);
  assert.match(launchFailure.stdout, /headless launch failed/);
  const updateLaunchFailure = runSection(f, body, { ...env, UPDATE_ONLY: 'true', OWNED_FAIL_NODE: '1' });
  assert.notEqual(updateLaunchFailure.status, 0);
  assert.match(updateLaunchFailure.stdout, /Install Linux browser prerequisites separately/);
});

test('fresh dry-run describes browser work without requiring a deployed dependency link', t => {
  const f = fixture(t), source = path.join(f.root, 'source'), workspace = path.join(f.root, 'workspace');
  fs.mkdirSync(source);
  fs.mkdirSync(workspace);
  const body = browserSection(f);
  const result = runSection(f, body, { REPO_DIR: source, WORKSPACE: workspace, SANDBOX: 'false',
    DRY_RUN: 'true', OS: 'linux', UPDATE_ONLY: 'false' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[dry-run\] would install Chromium/);
});

test('Ubuntu 26.04 ARM64 uses only pinned local Chromium and process-scoped override on fresh and update', t => {
  const { f, env, body } = playwrightFixture(t);
  for (const update of ['false', 'true']) {
    const result = runSection(f, body + '\nprintf "%s" "${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-unset}" > "$OWNED_ENV_AFTER"\n',
      { ...env, UPDATE_ONLY: update });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  assert.deepEqual(fs.readFileSync(env.OWNED_CLI_CALLS, 'utf8').trim().split('\n'),
    ['ubuntu24.04-arm64 install chromium', 'ubuntu24.04-arm64 install chromium']);
  assert.deepEqual(fs.readFileSync(env.OWNED_LAUNCH_CALLS, 'utf8').trim().split('\n'),
    ['ubuntu24.04-arm64', 'ubuntu24.04-arm64']);
  assert.equal(fs.readFileSync(env.OWNED_ENV_AFTER, 'utf8'), 'unset');
  assert.equal(fs.existsSync(env.OWNED_NPX_CALLS), false);
});

test('Ubuntu 26.04 ARM64 refuses changed package, lock, browser, architecture or local CLI before download', t => {
  const { f, source, env, body } = playwrightFixture(t);
  const playwright = path.join(source, 'node_modules', 'playwright');
  const core = path.join(source, 'node_modules', 'playwright-core');
  const cases = [
    [{ ...env, OWNED_NODE_ARCH: 'x64' }, null],
    [env, () => fs.writeFileSync(path.join(playwright, 'package.json'), JSON.stringify({ version: '1.58.3' }))],
    [env, () => fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ version: '1.58.3' }))],
    [env, () => fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/playwright': { version: '1.58.3' } } }))],
    [env, () => fs.writeFileSync(path.join(core, 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium', revision: '1209' }] }))],
    [env, () => fs.rmSync(path.join(playwright, 'cli.js'))],
  ];
  for (const [caseEnv, change] of cases) {
    change?.();
    const result = runSection(f, body, caseEnv);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(env.OWNED_CLI_CALLS), false);
    if (change) {
      fs.writeFileSync(path.join(playwright, 'package.json'), JSON.stringify({ version: '1.58.2' }));
      fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ version: '1.58.2' }));
      fs.writeFileSync(path.join(source, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/playwright': { version: '1.58.2' }, 'node_modules/playwright-core': { version: '1.58.2' } } }));
      fs.writeFileSync(path.join(core, 'browsers.json'), JSON.stringify({ browsers: [
        { name: 'chromium', revision: '1208' }, { name: 'chromium-headless-shell', revision: '1208' }, { name: 'ffmpeg', revision: '1011' },
      ] }));
      fs.writeFileSync(path.join(playwright, 'cli.js'), '');
    }
  }
});

test('Ubuntu 26.04 ARM64 fails closed on browser CLI or headless launch without installer apt hint', t => {
  const { f, env, body } = playwrightFixture(t);
  const cli = runSection(f, body, { ...env, OWNED_FAIL_CLI: '1' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stdout, /Chromium download failed/);
  assert.equal(fs.existsSync(env.OWNED_LAUNCH_CALLS), false);
  const launch = runSection(f, body, { ...env, OWNED_FAIL_LAUNCH: '1' });
  assert.notEqual(launch.status, 0);
  assert.match(launch.stderr, /owned raw launch diagnostic/);
  assert.match(launch.stdout, /separately reviewed system-library decision/);
  assert.doesNotMatch(launch.stdout, /sudo npx playwright install-deps/);
});

test('Ubuntu 26.04 ARM64 refuses a missing shared browser dependency', t => {
  const { f, env, body } = playwrightFixture(t);
  fs.unlinkSync(path.join(env.WORKSPACE, 'node_modules', 'playwright'));
  const result = runSection(f, body, env);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /playwright missing from the shared dependency tree/);
  assert.equal(fs.existsSync(env.OWNED_CLI_CALLS), false);
});

test('Ubuntu 26.04 ARM64 dry-run needs no packages; sandbox skips identity; other platforms stay ordinary', t => {
  const { f, env, body } = playwrightFixture(t);
  fs.rmSync(path.join(env.REPO_DIR, 'node_modules'), { recursive: true });
  fs.rmSync(path.join(env.WORKSPACE, 'node_modules'), { recursive: true });
  const dry = runSection(f, body, { ...env, DRY_RUN: 'true' });
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /would select ubuntu24\.04-arm64 Chromium.*without automatic system dependencies if installed Playwright is exactly 1\.58\.2/);
  assert.equal(fs.existsSync(env.OWNED_CLI_CALLS), false);
  const sandbox = runSection(f, body.replaceAll(path.join(f.root, 'os-release'), path.join(f.root, 'absent')),
    { ...env, SANDBOX: 'true' });
  assert.equal(sandbox.status, 0, sandbox.stdout + sandbox.stderr);
  assert.match(sandbox.stdout, /Sandbox: skipping Playwright/);
  for (const identity of ['ID=ubuntu\nVERSION_ID="24.04"\n', 'ID=debian\nVERSION_ID="12"\n']) {
    const ordinary = runSection(f, browserSection(f, identity), { ...env, DRY_RUN: 'true' });
    assert.equal(ordinary.status, 0, ordinary.stdout + ordinary.stderr);
    assert.match(ordinary.stdout, /would install Chromium \(linux\)/);
  }
  const x64 = runSection(f, browserSection(f, 'ID=ubuntu\nVERSION_ID="26.04"\n'),
    { ...env, DRY_RUN: 'true', OWNED_MACHINE_ARCH: 'x86_64' });
  assert.notEqual(x64.status, 0);
  assert.match(x64.stdout, /unsupported architecture refused/);
  for (const identity of ['ID=ubuntu\n', 'ID=ubuntu\nVERSION_ID=???\n']) {
    const refused = runSection(f, browserSection(f, identity), { ...env, DRY_RUN: 'true' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stdout, /identity is malformed/);
  }
});

test('Linux identities without a version keep the ordinary browser path unless Ubuntu is identified', t => {
  const f = fixture(t), source = path.join(f.root, 'source'), workspace = path.join(f.root, 'workspace');
  fs.mkdirSync(source);
  fs.mkdirSync(workspace);
  const env = { REPO_DIR: source, WORKSPACE: workspace, SANDBOX: 'false', DRY_RUN: 'true', OS: 'linux' };
  for (const identity of ['ID=debian\n', "ID='debian'\n", 'VERSION_ID=26.04\n']) {
    const result = runSection(f, browserSection(f, identity), env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /would install Chromium \(linux\)/);
  }
  const absent = browserSection(f, 'ID=debian\n');
  fs.unlinkSync(path.join(f.root, 'os-release'));
  const missing = runSection(f, absent, env);
  assert.equal(missing.status, 0, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /would install Chromium \(linux\)/);
  const ubuntu = runSection(f, browserSection(f, "ID='ubuntu'\nVERSION_ID='26.04'\n"), env);
  assert.equal(ubuntu.status, 0, ubuntu.stdout + ubuntu.stderr);
  assert.match(ubuntu.stdout, /would select ubuntu24\.04-arm64 Chromium/);
});
