import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditShippedDependencies } from './run-root-tests.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-policy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const stub = path.join(home, 'stub'), repo = path.join(home, 'source'), calls = path.join(home, 'calls');
  fs.mkdirSync(stub); fs.mkdirSync(path.join(repo, 'node_modules/nats'), { recursive: true });
  fs.writeFileSync(path.join(stub, 'nats-server'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'npx'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OWNED_CALLS"\ncase "$*" in *--version) printf "%s\\n" "$OWNED_VERSION";; *) exit "${OWNED_STATUS:-0}";; esac\n', { mode: 0o755 });
  return { home, repo, calls, env: { ...process.env, PATH: stub + ':' + process.env.PATH,
    OWNED_CALLS: calls, OWNED_VERSION: '11.21.1', OWNED_STATUS: '0' } };
}

function envModule(f, extra = {}) {
  const file = fileURLToPath(new URL('../scripts/install/env.sh', import.meta.url));
  const source = fs.readFileSync(file, 'utf8').split('# The memory daemon imports')[0];
  return spawnSync('bash', ['-e', '-c', 'info(){ :; };error(){ printf "%s\\n" "$*" >&2; };run(){ "$@"; };load_env_file(){ :; };' + source],
    { env: { ...f.env, REPO_DIR: f.repo, ENV_FILE: path.join(f.home, 'owned.env'), DRY_RUN: 'false', ...extra }, encoding: 'utf8' });
}

test('existing nats directory cannot skip a clean pinned lock installation', t => {
  const f = fixture(t), result = envModule(f); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(f.calls, 'utf8').trim().split('\n'), [
    '--yes --package=npm@11.21.1 npm --version', '--yes --package=npm@11.21.1 npm ci --omit=dev',
  ]);
});

test('wrong canonical tool, failed ci and dry run preserve refusal semantics without alternate installers', t => {
  const f = fixture(t);
  assert.notEqual(envModule(f, { OWNED_VERSION: '10.9.9' }).status, 0);
  assert.equal(fs.readFileSync(f.calls, 'utf8').includes(' ci '), false);
  fs.unlinkSync(f.calls);
  assert.notEqual(envModule(f, { OWNED_STATUS: '19' }).status, 0);
  assert.equal(fs.readFileSync(f.calls, 'utf8').trim().split('\n').length, 2);
  fs.unlinkSync(f.calls);
  assert.equal(envModule(f, { DRY_RUN: 'true' }).status, 0);
  assert.equal(fs.existsSync(f.calls), false);
});

test('shipped CI audit uses the pinned driver and propagates advisory/provider failure', async t => {
  const f = fixture(t);
  await auditShippedDependencies({ cwd: f.repo, env: f.env });
  assert.equal(fs.readFileSync(f.calls, 'utf8').trim(), '--yes --package=npm@11.21.1 npm audit --omit=dev --audit-level=high');
  await assert.rejects(auditShippedDependencies({ cwd: f.repo, env: { ...f.env, OWNED_STATUS: '1' } }), /audit failed/);
  await assert.rejects(auditShippedDependencies({ cwd: f.repo, env: { ...f.env, OWNED_STATUS: '2' } }), /audit failed/);
});

test('runtime staging uses the same model capability that installation will persist', t => {
  const f = fixture(t), script = fileURLToPath(new URL('../scripts/install/runtime.sh', import.meta.url));
  const envFile = path.join(f.home, 'openclaw.env');
  const run = (disable, saved, skip = 'true', inherited = saved) => {
    if (saved === null) fs.rmSync(envFile, { force: true });
    else fs.writeFileSync(envFile, `OPENCLAW_MODEL_ENABLED=${saved}\n`);
    const env = { ...process.env, SCRIPT: script, ENV_FILE: envFile, REPO_DIR: f.repo,
      OPENCLAW_ROOT: f.home, DRY_RUN: 'true', SKIP_LLM: skip, DISABLE_MODELS: disable };
    if (inherited === null) delete env.OPENCLAW_MODEL_ENABLED;
    else env.OPENCLAW_MODEL_ENABLED = inherited;
    const result = spawnSync('bash', ['-c',
      'step(){ :; }; info(){ :; }; source "$SCRIPT"; printf "%s" "${OPENCLAW_MODEL_ENABLED:-unset}"'],
      { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(run('true', '1'), '0');
  assert.equal(run('false', null), '0');
  assert.equal(run('false', '1'), '1');
  assert.equal(run('false', '0'), '0');
  assert.equal(run('false', null, 'false', '0'), '1');
});
