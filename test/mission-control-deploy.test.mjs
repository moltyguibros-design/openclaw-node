import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deployMissionControl, cleanupMissionControl } from '../lib/mission-control-deploy.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-deployment-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'source'), root = path.join(home, 'node'), workspace = path.join(root, 'workspace');
  const legacy = path.join(workspace, 'projects', 'mission-control');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), '{"name":"mission-control"}\n');
  fs.writeFileSync(path.join(source, 'package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(source, 'src', 'old-route.ts'), 'owned old route');
  fs.mkdirSync(path.join(legacy, 'data'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'data', 'owned.db'), 'owned live data');
  fs.writeFileSync(path.join(legacy, '.env.local'), 'DB_PATH=/owned/custom.db\nCUSTOM_VALUE=retained\n', { mode: 0o600 });
  const calls = [];
  let fail = false, active = true, free = 16 * 1024 ** 3;
  const run = (args, options) => {
    calls.push({ args, ...options });
    if (args[0] === 'run') {
      assert.ok(!fs.existsSync(path.join(options.cwd, '.env.local')), 'runtime credentials absent during build');
      if (fail) throw new Error('owned build failure');
      fs.mkdirSync(path.join(options.cwd, '.next'));
      fs.writeFileSync(path.join(options.cwd, '.next', 'BUILD_ID'), `owned-build-${calls.length}`);
    }
  };
  const deploy = () => deployMissionControl({ source, root, workspace, run, confirmActive: () => active, freeBytes: () => free,
    env: { PATH: process.env.PATH, HOME: home, DB_PATH: '/live/db', STATE_DB_PATH: '/live/state.db',
      OPENCLAW_STATE_DB: '/live/state.db', GOOGLE_API_KEY: 'owned-secret', OPENCLAW_NATS_TOKEN: 'owned-token' } });
  return { home, source, root, workspace, legacy, calls, deploy, fail: () => { fail = true; },
    active: value => { active = value; }, free: value => { free = value; },
    cleanup: () => cleanupMissionControl({ root, workspace, confirmActive: () => active }) };
}

test('a changed deployment gets fresh source/build, removes obsolete routes and preserves the old release and live data', t => {
  const f = fixture(t), first = f.deploy();
  const inode = fs.statSync(path.join(f.legacy, 'data', 'owned.db')).ino;
  fs.unlinkSync(path.join(f.source, 'src', 'old-route.ts'));
  fs.writeFileSync(path.join(f.source, 'src', 'new-route.ts'), 'owned new route');
  const next = f.deploy();
  assert.notEqual(next.release, first.release);
  assert.ok(fs.existsSync(path.join(first.release, 'src', 'old-route.ts')));
  assert.ok(!fs.existsSync(path.join(next.directory, 'src', 'old-route.ts')));
  assert.ok(fs.existsSync(path.join(next.directory, 'src', 'new-route.ts')));
  assert.equal(fs.readFileSync(path.join(next.directory, 'data', 'owned.db'), 'utf8'), 'owned live data');
  assert.equal(fs.statSync(path.join(next.directory, 'data', 'owned.db')).ino, inode);
  assert.equal(fs.readFileSync(path.join(next.directory, '.env.local'), 'utf8'), 'DB_PATH=/owned/custom.db\nCUSTOM_VALUE=retained\n');
  assert.equal(fs.statSync(path.join(next.directory, '.env.local')).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(path.join(next.directory, '.openclaw-mc-release.json'))).previousRelease, first.release);
});

test('a failed build keeps the selected release and live data untouched and retains its failed stage', t => {
  const f = fixture(t), first = f.deploy();
  fs.writeFileSync(path.join(f.source, 'src', 'new-route.ts'), 'owned failing change');
  f.fail();
  assert.throws(() => f.deploy(), /owned build failure/);
  assert.equal(fs.realpathSync(first.directory), first.release);
  assert.equal(fs.readFileSync(path.join(first.directory, 'data', 'owned.db'), 'utf8'), 'owned live data');
  const failed = fs.readdirSync(path.dirname(first.directory)).find(name => name.startsWith('.staging-'));
  assert.match(fs.readFileSync(path.join(path.dirname(first.directory), failed, '.failed.json'), 'utf8'), /owned build failure/);
});

test('an unchanged source and matching build may be reused; a missing build is rebuilt', t => {
  const f = fixture(t), first = f.deploy();
  assert.equal(f.deploy().changed, false);
  assert.equal(f.calls.length, 2);
  fs.unlinkSync(path.join(first.directory, '.next', 'BUILD_ID'));
  assert.equal(f.deploy().changed, true);
  assert.equal(f.calls.length, 4);
});

test('builds receive an isolated home/database and no live app credentials or state-path overrides', t => {
  const f = fixture(t), result = f.deploy();
  for (const { args, env, cwd } of f.calls) {
    assert.ok(env.HOME.startsWith(cwd));
    assert.ok(env.DB_PATH.startsWith(cwd));
    assert.equal(env.STATE_DB_PATH, undefined);
    assert.equal(env.OPENCLAW_STATE_DB, undefined);
    assert.equal(env.GOOGLE_API_KEY, undefined);
    assert.equal(env.OPENCLAW_NATS_TOKEN, 'isolated-build');
    assert.equal(env.OPENCLAW_MODEL_ENABLED, '0');
    if (args[0] === 'ci') assert.deepEqual(args, ['ci', '--include=dev']);
  }
  assert.equal(fs.readFileSync(path.join(result.directory, '.env.local'), 'utf8').includes('owned-secret'), false);
});

test('unmanaged source symlinks are refused before they can bring in outside data', t => {
  const f = fixture(t);
  fs.symlinkSync(f.legacy, path.join(f.source, 'outside'));
  assert.throws(() => f.deploy(), /source symlink/);
  assert.equal(f.calls.length, 0);
});

test('confirmed activation retains current and previous code, removes build-only caches and never follows the data link', t => {
  const f = fixture(t), first = f.deploy();
  for (let i = 1; i <= 2; i++) {
    fs.writeFileSync(path.join(f.source, 'src', 'new-route.ts'), `owned route ${i}`);
    const next = f.deploy();
    assert.ok(!fs.existsSync(path.join(next.directory, '.build-home')));
    assert.ok(!fs.existsSync(path.join(next.directory, '.build-data')));
    f.cleanup();
  }
  const parent = path.join(f.root, 'runtime/mission-control');
  assert.equal(fs.readdirSync(parent).filter(name => /^[a-f0-9]{16}-/.test(name)).length, 2);
  assert.ok(!fs.existsSync(first.release));
  assert.equal(fs.readFileSync(path.join(f.legacy, 'data/owned.db'), 'utf8'), 'owned live data');
});

test('older failed build payloads are pruned only after preserving their source, lock and error record privately', t => {
  const f = fixture(t);f.deploy();f.fail();
  for (let i = 0; i < 2; i++) {
    fs.writeFileSync(path.join(f.source, 'src', 'new-route.ts'), `failed source ${i}`);
    assert.throws(() => f.deploy(), /owned build failure/);
  }
  const parent = path.join(f.root, 'runtime/mission-control');
  assert.equal(fs.readdirSync(parent).filter(name => name.startsWith('.staging-')).length, 1);
  const history = path.join(parent, 'failure-history');
  const archives = fs.readdirSync(history);assert.equal(archives.length, 1);
  const archive = JSON.parse(gunzipSync(fs.readFileSync(path.join(history, archives[0]))));
  assert.match(Buffer.from(archive.files['.failed.json'], 'base64').toString(), /owned build failure/);
  assert.equal(Buffer.from(archive.files['src/new-route.ts'], 'base64').toString(), 'failed source 0');
  assert.ok(archive.files['package-lock.json']);
  assert.equal(fs.statSync(path.join(history, archives[0])).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'data/owned.db'), 'utf8'), 'owned live data');
});

test('unconfirmed activation and low disk space refuse further builds before they allocate dependencies', t => {
  const f = fixture(t);f.deploy();f.active(false);
  fs.writeFileSync(path.join(f.source, 'src', 'new-route.ts'), 'pending source');
  const pending = f.deploy();
  fs.writeFileSync(path.join(f.source, 'src', 'new-route.ts'), 'another pending source');
  const count = f.calls.length;
  assert.throws(() => f.deploy(), /retention bound reached/);
  assert.equal(f.calls.length, count);
  assert.equal(fs.realpathSync(pending.directory), pending.release);
  const low = fixture(t);low.free(1024 ** 3);
  assert.throws(() => low.deploy(), /4GiB free/);
  assert.equal(low.calls.length, 0);
});

test('both rendered service templates let the real Mission Control signing wrapper resolve its shared library from the release layout', t => {
  const f = fixture(t), release = f.deploy().release;
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const wrapper = ts.transpileModule(fs.readFileSync(path.join(repo, 'mission-control/src/lib/mesh-sign.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  fs.writeFileSync(path.join(release, 'mesh-sign.mjs'), wrapper);
  fs.mkdirSync(path.join(f.workspace, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(f.workspace, 'lib/operator-auth.mjs'), 'export const signOperatorRequest = payload => ({...payload, owned_shared_library:true});\n');
  for (const [name, pattern] of [
    ['services/systemd/openclaw-mission-control.service', /Environment=OPENCLAW_LIB_DIR=(.+)/],
    ['services/launchd/ai.openclaw.mission-control.plist', /<key>OPENCLAW_LIB_DIR<\/key>\s*<string>([^<]+)<\/string>/],
  ]) {
    const binding = fs.readFileSync(path.join(repo, name), 'utf8').match(pattern)?.[1];
    assert.ok(binding, name);
    const env = { ...process.env, OPENCLAW_LIB_DIR: binding.replace('${OPENCLAW_WORKSPACE}', f.workspace) };
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      "const m=await import('./mesh-sign.mjs');const p=await m.signOperatorRequest({action:'owned-unpublished'});if(!p.owned_shared_library)process.exit(1);"],
    { cwd: release, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('aged unmarked build stages become qualified interrupted records, while a recent stage blocks duplicate allocation', t => {
  const f = fixture(t);const live = f.deploy();
  const parent = path.dirname(live.directory);
  const old = path.join(parent, `.staging-${randomUUID()}`);
  fs.mkdirSync(path.join(old, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(old, 'package-lock.json'), '{"owned":"retained-lock"}');
  fs.writeFileSync(path.join(old, '.build.log'), 'owned interrupted partial output');
  const past = new Date(Date.now() - 36 * 60_000);fs.utimesSync(old, past, past);
  f.cleanup();
  const record = JSON.parse(fs.readFileSync(path.join(old, '.failed.json')));
  assert.equal(record.reason, 'unmarked-stage-age-exceeded');
  assert.equal(record.original_outcome, 'unknown');
  assert.equal(record.sourceDigest, null);
  assert.equal(fs.readFileSync(path.join(old, '.build.log'), 'utf8'), 'owned interrupted partial output');
  const young = path.join(parent, `.staging-${randomUUID()}`);fs.mkdirSync(young);
  fs.writeFileSync(path.join(f.source, 'src/new-route.ts'), 'new source while another build remains');
  const count = f.calls.length;
  assert.throws(() => f.deploy(), /unmarked build stage/);
  assert.equal(f.calls.length, count);
  assert.equal(fs.realpathSync(live.directory), live.release);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'data/owned.db'), 'utf8'), 'owned live data');
});

test('interrupted first installs can recover before any current release or service exists', t => {
  const f = fixture(t), parent = path.join(f.root, 'runtime/mission-control');
  for (let i = 0; i < 2; i++) {
    const stage = path.join(parent, `.staging-${randomUUID()}`);
    fs.mkdirSync(path.join(stage, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(stage, 'package-lock.json'), `{"owned":${i}}`);
    fs.writeFileSync(path.join(stage, '.build.log'), `owned interrupted first install ${i}`);
    const past = new Date(Date.now() - 36 * 60_000);fs.utimesSync(stage, past, past);
  }
  assert.equal(f.cleanup().confirmed, false);
  assert.equal(fs.readdirSync(parent).filter(name => name.startsWith('.staging-')).length, 1);
  assert.equal(fs.readdirSync(path.join(parent, 'failure-history')).length, 1);
  assert.equal(f.deploy().changed, true);
  assert.equal(fs.readFileSync(path.join(f.legacy, 'data/owned.db'), 'utf8'), 'owned live data');
});

test('active MC transaction excludes another deploy or cleanup before a second builder runs', t => {
  const f = fixture(t); let otherBuildCalls = 0;
  const options = { source: f.source, root: f.root, workspace: f.workspace, confirmActive: () => true, freeBytes: () => 16 * 1024 ** 3 };
  const result = deployMissionControl({ ...options, run(args, { cwd }) {
    assert.throws(() => deployMissionControl({ ...options, run() { otherBuildCalls++; } }), /locked/);
    assert.throws(() => cleanupMissionControl(options), /locked/);
    if (args[0] === 'run') { fs.mkdirSync(path.join(cwd, '.next')); fs.writeFileSync(path.join(cwd, '.next/BUILD_ID'), 'owned-concurrent-build'); }
  } });
  assert.equal(otherBuildCalls, 0); assert.ok(fs.existsSync(result.directory));
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/mission-control/.deploy-lock')), false);
});

test('foreign per-MC lock remains intact and a symlinked root/workspace reuse canonical ownership', t => {
  const f = fixture(t), first = f.deploy(), parent = path.join(f.root, 'runtime/mission-control');
  const lock = path.join(parent, '.deploy-lock'); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.txt'), 'foreign owned fixture');
  assert.throws(() => f.deploy(), /locked/);
  assert.equal(fs.readFileSync(path.join(lock, 'owner.txt'), 'utf8'), 'foreign owned fixture');
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
  fs.rmSync(lock, { recursive: true });
  const rootLink = path.join(f.home, 'root-link'), workspaceLink = path.join(f.home, 'workspace-link');
  fs.symlinkSync(f.root, rootLink); fs.symlinkSync(f.workspace, workspaceLink);
  const reused = deployMissionControl({ root: rootLink, workspace: workspaceLink, source: f.source,
    run() { throw Error('canonical unchanged source must not rebuild'); }, confirmActive: () => true });
  assert.equal(reused.changed, false); assert.equal(reused.release, first.release);
  assert.equal(fs.readFileSync(path.join(first.release, 'data/owned.db'), 'utf8'), 'owned live data');
});

test('failed MC selection removes its own temporary link and archives failure before pruning the build', t => {
  const f = fixture(t), first = f.deploy(), parent = path.join(f.root, 'runtime/mission-control');
  const inode = fs.statSync(path.join(f.legacy, 'data/owned.db')).ino;
  fs.writeFileSync(path.join(f.source, 'src/new-route.ts'), 'owned changed route');
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (path.basename(from).startsWith('.current-')) throw Error('owned selection failure');
    return rename(from, to);
  };
  try { assert.throws(() => f.deploy(), /owned selection failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.realpathSync(first.directory), first.release);
  assert.equal(fs.statSync(path.join(f.legacy, 'data/owned.db')).ino, inode);
  assert.equal(fs.readdirSync(parent).some(name => name.startsWith('.current-')), false);
  const failed = fs.readdirSync(parent).find(name => name !== path.basename(first.release) && /^[a-f0-9]{16}-/.test(name));
  const failedPath = path.join(parent, failed);
  assert.match(fs.readFileSync(path.join(failedPath, '.selection-failed.json'), 'utf8'), /owned selection failure/);
  f.cleanup();
  assert.equal(fs.existsSync(failedPath), false);
  const archive = JSON.parse(gunzipSync(fs.readFileSync(path.join(parent, 'failure-history', failed + '.json.gz'))));
  assert.match(Buffer.from(archive.files['.selection-failed.json'], 'base64').toString('utf8'), /owned selection failure/);
  assert.equal(fs.realpathSync(first.directory), first.release);
  assert.equal(fs.readFileSync(path.join(first.release, 'data/owned.db'), 'utf8'), 'owned live data');
});

test('a broken current link refuses a changed build and remains available for explicit reconciliation', t => {
  const f = fixture(t), parent = path.join(f.root, 'runtime/mission-control'); fs.mkdirSync(parent, { recursive: true });
  const current = path.join(parent, 'current'); fs.symlinkSync(path.join(parent, 'missing-owned-release'), current);
  assert.throws(() => f.deploy(), /existing release symlink/);
  assert.equal(fs.readlinkSync(current), path.join(parent, 'missing-owned-release'));
  assert.equal(f.calls.length, 0);
});

test('unchanged build reuse cannot bypass current directory or foreign-target ownership checks', t => {
  for (const foreign of [false, true]) {
    const f = fixture(t), first = f.deploy(), beforeCalls = f.calls.length;
    fs.unlinkSync(first.directory);
    if (foreign) {
      const outside = path.join(f.home, 'outside-release'); fs.renameSync(first.release, outside);
      fs.symlinkSync(outside, first.directory);
    } else {
      fs.renameSync(first.release, first.directory);
    }
    f.active(false);
    assert.throws(() => f.deploy(), foreign ? /leaves the managed release directory/ : /existing release symlink/);
    assert.equal(f.calls.length, beforeCalls);
    assert.equal(fs.readFileSync(path.join(f.legacy, 'data/owned.db'), 'utf8'), 'owned live data');
  }
});

test('failure creating the MC selection link is retained and archived with the completed unselected build', t => {
  const f = fixture(t), first = f.deploy(), parent = path.join(f.root, 'runtime/mission-control');
  fs.writeFileSync(path.join(f.source, 'src/new-route.ts'), 'owned new route');
  const symlink = fs.symlinkSync;
  fs.symlinkSync = (from, to, ...args) => {
    if (path.basename(to).startsWith('.current-')) throw Error('owned link creation failure');
    return symlink(from, to, ...args);
  };
  try { assert.throws(() => f.deploy(), /owned link creation failure/); }
  finally { fs.symlinkSync = symlink; }
  const failed = fs.readdirSync(parent).find(name => name !== path.basename(first.release) && /^[a-f0-9]{16}-/.test(name));
  assert.match(fs.readFileSync(path.join(parent, failed, '.selection-failed.json'), 'utf8'), /owned link creation failure/);
  f.cleanup();
  const archive = JSON.parse(gunzipSync(fs.readFileSync(path.join(parent, 'failure-history', failed + '.json.gz'))));
  assert.match(Buffer.from(archive.files['.selection-failed.json'], 'base64').toString('utf8'), /owned link creation failure/);
  assert.equal(fs.realpathSync(first.directory), first.release);
  assert.equal(fs.readFileSync(path.join(first.release, 'data/owned.db'), 'utf8'), 'owned live data');
});
