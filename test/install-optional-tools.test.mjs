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
  const body = section('scripts/install/components.sh', 'step "Step 12: Playwright Browser"', 'step "Step 13: Companion Bridge"');
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
  const body = section('scripts/install/components.sh', 'step "Step 12: Playwright Browser"', 'step "Step 13: Companion Bridge"');
  const result = runSection(f, body, { REPO_DIR: source, WORKSPACE: workspace, SANDBOX: 'false',
    DRY_RUN: 'true', OS: 'linux', UPDATE_ONLY: 'false' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /\[dry-run\] would install Chromium/);
});
