import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stageRuntime, bindRuntimeDependencies } from '../lib/runtime-deploy.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-deploy-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'source'), root = path.join(home, '.openclaw');
  function write(name, text) {
    const p = path.join(source, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
  }
  write('package.json', JSON.stringify({ name: 'owned-runtime', files: ['bin/', 'lib/', 'packages/', 'skills/', 'mission-control/'] }));
  write('package-lock.json', '{"lockfileVersion":3}\n');
  write('node_modules/nats/package.json', '{"name":"nats","main":"index.cjs"}');
  write('node_modules/nats/index.cjs', 'exports.value = 42;\n');
  write('lib/service.cjs', 'module.exports = require("nats").value;\n');
  write('packages/owned/index.cjs', 'exports.owned = true;\n');
  fs.mkdirSync(path.join(source, 'node_modules/@owned'));
  fs.symlinkSync('../../packages/owned', path.join(source, 'node_modules/@owned/pkg'));
  write('bin/start.cjs', 'console.log(require("../lib/service.cjs"));\n');
  write('skills/owned/assets/data/catalog.csv', 'owned,asset\n');
  write('mission-control/data/private.db', 'do not stage live data');
  write('lib/.env.example', 'OWNED=template');
  write('lib/.env.private', 'owned secret, do not stage');
  write('node_modules/.cache/model', 'owned model cache, do not stage');
  return { home, source, root, write, stage: options => stageRuntime({ source, root, availableBytes: () => 64 * 1024 ** 3, ...options }) };
}

function run(release) {
  return spawnSync(process.execPath, [path.join(release, 'bin/start.cjs')], { encoding: 'utf8' });
}

test('runtime code/dependencies survive source removal and exclude private/cache input', t => {
  const f = fixture(t), deployed = f.stage();
  assert.equal(deployed.reused, false);
  assert.equal(fs.existsSync(path.join(deployed.release, 'lib/.env.private')), false);
  assert.equal(fs.existsSync(path.join(deployed.release, 'node_modules/.cache')), false);
  assert.equal(fs.readFileSync(path.join(deployed.release, 'skills/owned/assets/data/catalog.csv'), 'utf8'), 'owned,asset\n');
  assert.equal(fs.readFileSync(path.join(deployed.release, 'lib/.env.example'), 'utf8'), 'OWNED=template');
  assert.equal(fs.existsSync(path.join(deployed.release, 'mission-control/data')), false);
  assert.equal(fs.realpathSync(path.join(deployed.release, 'node_modules/@owned/pkg')), path.join(deployed.release, 'packages/owned'));
  assert.notEqual(fs.statSync(path.join(deployed.release, 'node_modules/nats/index.cjs')).ino,
    fs.statSync(path.join(f.source, 'node_modules/nats/index.cjs')).ino);
  fs.renameSync(f.source, f.source + '-removed');
  const result = run(deployed.release);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '42\n');
  const record = JSON.parse(fs.readFileSync(path.join(f.root, 'config/installation.json')));
  assert.equal(record.runtime, deployed.release);
  assert.equal(record.source, f.source);
  assert.equal(fs.statSync(path.join(f.root, 'config/installation.json')).mode & 0o777, 0o600);
});

test('identical runtime reuses its binding; changed code retains old code and shares only readonly owned deps', t => {
  const f = fixture(t), first = f.stage(), reused = f.stage();
  assert.equal(reused.reused, true);
  assert.equal(reused.release, first.release);
  f.write('bin/start.cjs', 'console.log(require("../lib/service.cjs") + 1);\n');
  const second = f.stage();
  assert.notEqual(first.release, second.release);
  assert.equal(run(first.release).stdout, '42\n');
  assert.equal(run(second.release).stdout, '43\n');
  assert.equal(fs.statSync(path.join(first.release, 'node_modules/nats/index.cjs')).ino,
    fs.statSync(path.join(second.release, 'node_modules/nats/index.cjs')).ino);
  assert.equal(fs.statSync(path.join(second.release, 'node_modules/nats/index.cjs')).mode & 0o222, 0);
  assert.ok(second.receipt.reusedDependencyBytes > 0);
  f.write('node_modules/nats/index.cjs', 'exports.value = 9;\n');
  const third = f.stage();
  assert.equal(run(first.release).stdout, '42\n');
  assert.equal(run(third.release).stdout, '10\n');
});

test('binding retains an existing dependency directory and switches a stale symlink atomically', t => {
  const f = fixture(t), first = f.stage(), destination = path.join(f.root, 'workspace/node_modules');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'owned-extra'), 'preserve these bytes');
  const result = bindRuntimeDependencies({ source: path.join(first.release, 'node_modules'), destination, root: f.root });
  assert.equal(fs.readFileSync(path.join(result.archived, 'owned-extra'), 'utf8'), 'preserve these bytes');
  assert.equal(fs.realpathSync(destination), path.join(first.release, 'node_modules'));
  assert.equal(bindRuntimeDependencies({ source: path.join(first.release, 'node_modules'), destination, root: f.root }).reused, true);
  f.write('lib/service.cjs', 'module.exports = 77;\n');
  const second = f.stage();
  bindRuntimeDependencies({ source: path.join(second.release, 'node_modules'), destination, root: f.root });
  assert.equal(fs.realpathSync(destination), path.join(second.release, 'node_modules'));
  assert.equal(fs.readFileSync(path.join(result.archived, 'owned-extra'), 'utf8'), 'preserve these bytes');
});

test('external symlinks and insufficient space refuse before current selection', t => {
  const f = fixture(t);
  const foreign = path.join(f.home, 'foreign'); fs.writeFileSync(foreign, 'not owned source');
  fs.symlinkSync(foreign, path.join(f.source, 'node_modules/foreign'));
  assert.throws(() => f.stage(), /link leaves source/);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node/current')), false);
  fs.unlinkSync(path.join(f.source, 'node_modules/foreign'));
  assert.throws(() => f.stage({ availableBytes: () => 0 }), /4GiB reserve/);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node/current')), false);
});

test('existing deployment lock and incomplete stage are preserved and block another writer', t => {
  const f = fixture(t), parent = path.join(f.root, 'runtime/node');
  fs.mkdirSync(path.join(parent, '.deploy-lock'), { recursive: true });
  assert.throws(() => f.stage(), /is locked/);
  assert.ok(fs.existsSync(path.join(parent, '.deploy-lock')));
  fs.rmdirSync(path.join(parent, '.deploy-lock'));
  fs.mkdirSync(path.join(parent, '.staging-owned-interrupted'));
  assert.throws(() => f.stage(), /incomplete runtime stage/);
  assert.ok(fs.existsSync(path.join(parent, '.staging-owned-interrupted')));
});

test('changed or writable retained dependencies cannot be reused', t => {
  const f = fixture(t), first = f.stage(), file = path.join(first.release, 'node_modules/nats/index.cjs');
  fs.chmodSync(file, 0o644);
  assert.throws(() => f.stage(), /mode mismatch/);
});


test('symlinked installation root remains canonical across staging reuse and dependency binding', t => {
  const f = fixture(t), actual = path.join(f.home, 'actual-root');
  fs.mkdirSync(actual); fs.symlinkSync(actual, f.root);
  const first = f.stage(), second = f.stage();
  assert.equal(first.release, second.release);
  assert.ok(first.release.startsWith(actual + path.sep));
  const destination = path.join(f.root, 'workspace/node_modules');
  bindRuntimeDependencies({ source: path.join(first.release, 'node_modules'), destination, root: f.root });
  assert.equal(fs.realpathSync(destination), path.join(first.release, 'node_modules'));
});


test('rendered log-rotation command runs from the snapshot after source removal without changing owned logs', t => {
  const f = fixture(t), repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  f.write('bin/log-rotate', fs.readFileSync(path.join(repo, 'bin/log-rotate')));
  const deployed = f.stage();
  fs.mkdirSync(path.join(f.root, 'logs'));
  const log = path.join(f.root, 'logs/owned-live.log'); fs.writeFileSync(log, 'keep owned log bytes\n');
  const code = `const fs=require('fs');const root=process.argv[2];const m=require(root+'/bin/openclaw-node-init.js');
    const vars=m.serviceTemplateVars({meshDir:process.argv[3],nodeId:'owned',config:{nats:'nats://127.0.0.1:1'}});
    process.stdout.write(m.renderServiceTemplate(fs.readFileSync(root+'/services/systemd/openclaw-log-rotate.service','utf8'),vars));`;
  const env = { HOME: f.home, OPENCLAW_ROOT: f.root, PATH: process.env.PATH, OPENCLAW_UNIT_TEST: '1', OPENCLAW_MODEL_ENABLED: '0' };
  const rendered = spawnSync(process.execPath, ['-e', code, 'owned-render', repo, deployed.release], { env, encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  const script = rendered.stdout.match(/^ExecStart=\/bin\/bash (.+)$/m)?.[1];
  assert.equal(script, path.join(deployed.release, 'bin/log-rotate'));
  fs.renameSync(f.source, f.source + '-removed');
  const result = spawnSync('/bin/bash', [script], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rotated=0/);
  assert.equal(fs.readFileSync(log, 'utf8'), 'keep owned log bytes\n');
});


test('Git selection keeps packaged public data and generated schemas while ignoring private/changing output', t => {
  const f = fixture(t);
  const initialized = spawnSync('git', ['init', '--quiet', f.source], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  f.write('.gitignore', '*.log\nnode_modules/\npackages/event-schemas/dist/\n');
  f.write('lib/churn.log', 'first output');
  f.write('lib/private.key', 'owned key bytes, never stage');
  f.write('mission-control/.npm-cache/output', 'private cache');
  f.write('packages/event-schemas/dist/index.js', 'export const owned = true;\n');
  const added = spawnSync('git', ['-C', f.source, 'add', '.'], { encoding: 'utf8' });
  assert.equal(added.status, 0, added.stderr);
  const first = f.stage();
  assert.equal(first.receipt.sourceGit.selection, 'git-index-unignored-and-generated-schemas');
  assert.equal(fs.readFileSync(path.join(first.release, 'skills/owned/assets/data/catalog.csv'), 'utf8'), 'owned,asset\n');
  assert.equal(fs.readFileSync(path.join(first.release, 'packages/event-schemas/dist/index.js'), 'utf8'), 'export const owned = true;\n');
  assert.equal(fs.existsSync(path.join(first.release, 'lib/churn.log')), false);
  assert.equal(fs.existsSync(path.join(first.release, 'lib/private.key')), false);
  assert.equal(fs.existsSync(path.join(first.release, 'mission-control/.npm-cache')), false);
  f.write('lib/churn.log', 'later output');
  assert.equal(f.stage().release, first.release);
});

test('invalid Git checkout metadata refuses instead of changing to packed-source selection', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.source, '.git'));
  assert.throws(() => f.stage(), /Cannot enumerate the source Git checkout/);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node/current')), false);
});
