import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('managed CLI and listener refuse before legacy fetch/checkout and leave installation data alone', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-deploy-refusal-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, '.openclaw'), source = path.join(home, 'source'), stub = path.join(home, 'stub');
  for (const p of [path.join(root, 'config'), source, stub]) fs.mkdirSync(p, { recursive: true });
  const record = path.join(root, 'config/installation.json'); fs.writeFileSync(record, '{"schema":1,"owned":"keep"}\n');
  const calls = path.join(home, 'git-calls');
  fs.writeFileSync(path.join(stub, 'git'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OWNED_GIT_CALLS"\nexit 91\n', { mode: 0o755 });
  const env = { HOME: home, OPENCLAW_ROOT: root, OPENCLAW_REPO_DIR: source, OPENCLAW_NODE_ID: 'owned',
    OPENCLAW_NODE_ROLE: 'lead', OPENCLAW_UNIT_TEST: '1', OPENCLAW_MODEL_ENABLED: '0',
    PATH: stub + path.delimiter + process.env.PATH, OWNED_GIT_CALLS: calls };
  const before = fs.readFileSync(record);
  const cli = spawnSync(process.execPath, [path.join(repo, 'bin/mesh-deploy.js'), '--local'], { env, encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr + cli.stdout, /staged installer update/);
  const code = `require(${JSON.stringify(path.join(repo, 'bin/mesh-deploy-listener.js'))}).runDeploy({sha:'abcdef1234567'}).then(r=>console.log(JSON.stringify(r)))`;
  const listener = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(listener.status, 0, listener.stderr);
  const result = JSON.parse(listener.stdout.trim().split('\n').at(-1));
  assert.equal(result.status, 'failed');
  assert.match(result.errors.join(' '), /staged installer update/);
  assert.deepEqual(fs.readFileSync(record), before);
  assert.equal(fs.existsSync(calls), false);
  assert.deepEqual(fs.readdirSync(source), []);
  const init = spawnSync(process.execPath, [path.join(repo, 'bin/openclaw-node-init.js')], { env, encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(init.status, 0);
  assert.match(init.stderr + init.stdout, /legacy node-init provisioning refused/);
  assert.equal(fs.existsSync(calls), false);
  assert.equal(fs.existsSync(path.join(home, '.ssh')), false);
  assert.equal(fs.existsSync(path.join(root, 'openclaw.env')), false);
  assert.deepEqual(fs.readFileSync(record), before);
});
