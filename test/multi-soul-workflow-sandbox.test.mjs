/**
 * multi-soul-workflow-sandbox.test.mjs — workspace-bin/test-multi-soul-workflow
 * creates tasks, approves an evolution and commits into the souls repo. It must
 * do that against a disposable Mission Control (own HOME, DB, souls repo, off
 * the mesh bus) and remove it all on exit, never against the live :3000 and
 * ~/.openclaw state.
 *
 * A stub `next` records the environment the script launches Mission Control
 * with, then exits, so this needs no MC build.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'workspace-bin', 'test-multi-soul-workflow');
const ACCESS = join(ROOT, 'workspace-bin', 'clawvault-access-control');
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;

test('the script launches a disposable Mission Control and removes it on exit', { skip: !HAVE_GIT && 'git not available' }, () => {
  const base = mkdtempSync(join(tmpdir(), 'multi-soul-sandbox-'));
  try {
    const home = join(base, 'home');
    const mcDir = join(base, 'mc');
    const record = join(base, 'record');
    mkdirSync(home);
    mkdirSync(join(mcDir, 'node_modules', '.bin'), { recursive: true });
    const stub = join(mcDir, 'node_modules', '.bin', 'next');
    writeFileSync(stub, `#!/usr/bin/env bash
{
  echo "ARGS=$*"
  echo "PWD=$PWD"
  env | grep -E '^(HOME|DB_PATH|OPENCLAW_WORKSPACE|WORKSPACE_ROOT|OPENCLAW_STATE_DB|OPENCLAW_NATS|OPENCLAW_NATS_TOKEN)='
  echo "SOULS=$(jq '.souls | length' "$HOME/.openclaw/souls/registry.json")"
  echo "SEEDED=$(git -C "$HOME/.openclaw/souls" log --oneline | wc -l | tr -d ' ')"
  access() { OPENCLAW_SOULS_DIR="$HOME/.openclaw/souls" node ${JSON.stringify(ACCESS)} blockchain-auditor "$1" read || true; }
  echo "ACCESS_OWN=$(access private/blockchain-auditor)"
  echo "ACCESS_HANDOFF=$(access handoffs)"
  echo "ACCESS_OTHER=$(access private/lore-writer)"
} > ${JSON.stringify(record)}
exit 1
`);
    chmodSync(stub, 0o755);

    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: process.env.PATH, HOME: home, TMPDIR: base,
        OPENCLAW_MC_DIR: mcDir, MULTI_SOUL_TEST_PORT: '3999',
        OPENCLAW_NATS: 'nats://127.0.0.1:4222', OPENCLAW_NATS_TOKEN: 'live-token',
      },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /disposable Mission Control exited/);

    assert.ok(existsSync(record), `next was never launched:\n${r.stdout}${r.stderr}`);
    const env = Object.fromEntries(readFileSync(record, 'utf8').trim().split('\n').map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }));
    assert.equal(env.ARGS, 'start -H 127.0.0.1 -p 3999');
    assert.equal(env.PWD, mcDir);
    assert.notEqual(env.HOME, home);
    assert.ok(env.HOME.startsWith(join(base, 'multi-soul-test.')), env.HOME);
    for (const key of ['DB_PATH', 'OPENCLAW_WORKSPACE', 'WORKSPACE_ROOT', 'OPENCLAW_STATE_DB']) {
      assert.ok(env[key]?.startsWith(env.HOME), `${key}=${env[key]}`);
    }
    assert.equal(env.OPENCLAW_NATS, 'nats://127.0.0.1:9', 'the instance must stay off the mesh bus');
    assert.equal(env.OPENCLAW_NATS_TOKEN, undefined);
    assert.equal(env.SOULS, '3');
    assert.equal(env.SEEDED, '1');
    assert.equal(env.ACCESS_OWN, 'GRANTED', 'Test 5 needs the soul to read its own private memory');
    assert.equal(env.ACCESS_HANDOFF, 'GRANTED', 'Test 2 needs the receiver to read handoffs');
    assert.match(env.ACCESS_OTHER, /^DENIED/);

    assert.equal(existsSync(env.HOME), false, 'the sandbox must be removed on exit');
    assert.equal(existsSync(join(home, '.openclaw')), false, 'the caller HOME must not be written');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
