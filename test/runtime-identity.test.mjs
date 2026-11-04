import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stageRuntime } from '../lib/runtime-deploy.mjs';

const require = createRequire(import.meta.url);
const { readRuntimeIdentity } = require('../lib/runtime-identity');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-identity-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'source'), root = path.join(home, 'root');
  fs.mkdirSync(path.join(source, 'node_modules/nats'), { recursive: true });
  fs.writeFileSync(path.join(source, 'package.json'), '{"files":["bin/"]}\n');
  fs.writeFileSync(path.join(source, 'package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(source, 'node_modules/nats/package.json'), '{"name":"nats"}\n');
  fs.mkdirSync(path.join(source, 'bin')); fs.writeFileSync(path.join(source, 'bin/owned.js'), 'owned content\n');
  const stage = () => stageRuntime({ source, root, availableBytes: () => 64 * 1024 ** 3 });
  return { home, source, root, stage };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

function init(cwd) {
  git(cwd, 'init', '-q'); git(cwd, 'config', 'user.name', 'Owned fixture'); git(cwd, 'config', 'user.email', 'owned@example.invalid');
  git(cwd, 'add', '.'); git(cwd, 'commit', '-qm', 'owned initial');
}

test('managed identity binds canonical release/manifest and retains packed-source qualification', t => {
  const f = fixture(t), deployed = f.stage();
  const link = path.join(f.home, 'root-link'); fs.symlinkSync(f.root, link);
  const identity = readRuntimeIdentity({ repoDir: path.join(link, 'runtime/node/current'), root: link });
  assert.equal(identity.kind, 'managed-runtime');
  assert.equal(identity.deployVersion, `runtime:${deployed.digest}`);
  assert.equal(identity.digest, deployed.digest);
  assert.deepEqual(identity.sourceGit, { selection: 'packed-roots', head: null, dirty: null });
  assert.match(identity.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(identity.verification, 'manifest-receipt-only');
  assert.equal(identity.node.abi, process.versions.modules);
});

test('managed source Git stays qualified dirty rather than being reported as the deployed Git revision', t => {
  const f = fixture(t); init(f.source);
  fs.writeFileSync(path.join(f.source, 'bin/owned.js'), 'dirty owned code\n');
  const deployed = f.stage(), head = git(f.source, 'rev-parse', 'HEAD');
  const identity = readRuntimeIdentity({ repoDir: deployed.release, root: f.root });
  assert.equal(identity.sourceGit.head, head);
  assert.equal(identity.sourceGit.dirty, true);
  assert.equal(identity.sourceGit.selection, 'git-index-unignored-and-generated-schemas');
  assert.equal(identity.deployVersion, `runtime:${deployed.digest}`);
  assert.notEqual(identity.deployVersion, head);
});

test('changed receipt digest/files/node and invalid source qualification refuse', t => {
  for (const mutate of [r => { r.digest = '0'.repeat(64); }, r => { r.files[0].bytes++; },
    r => { r.node.abi = 'foreign'; }, r => { r.sourceGit.dirty = 'false'; }, r => { r.sourceGit.head = 'not-a-git-object'; }]) {
    const f = fixture(t), deployed = f.stage();
    const receipt = path.join(deployed.release, '.openclaw-node-release.json');
    const value = JSON.parse(fs.readFileSync(receipt)); mutate(value); fs.writeFileSync(receipt, JSON.stringify(value));
    assert.throws(() => readRuntimeIdentity({ repoDir: deployed.release, root: f.root }), /receipt|qualification/);
  }
});

test('managed missing receipt or release outside the root refuses without a Git fallback', t => {
  const f = fixture(t), deployed = f.stage(), receipt = path.join(deployed.release, '.openclaw-node-release.json');
  const foreign = path.join(f.home, 'foreign'); fs.mkdirSync(foreign);
  fs.copyFileSync(receipt, path.join(foreign, '.openclaw-node-release.json'));
  assert.throws(() => readRuntimeIdentity({ repoDir: foreign, root: f.root }), /receipt/);
  init(f.source); fs.unlinkSync(receipt);
  assert.throws(() => readRuntimeIdentity({ repoDir: f.source, root: f.root }), /no receipt/);
  assert.throws(() => readRuntimeIdentity({ repoDir: deployed.release, root: f.root }), /no receipt/);
});

test('legacy identity uses only an owning Git checkout and qualifies dirty bytes', t => {
  const f = fixture(t); init(f.source);
  const identity = readRuntimeIdentity({ repoDir: f.source, root: f.root });
  assert.equal(identity.kind, 'unmanaged-git'); assert.equal(identity.sourceGit.dirty, false);
  fs.writeFileSync(path.join(f.source, 'bin/owned.js'), 'changed\n');
  const dirty = readRuntimeIdentity({ repoDir: f.source, root: f.root });
  assert.equal(dirty.sourceGit.dirty, true); assert.match(dirty.deployVersion, /-dirty$/);
  const nested = path.join(f.source, 'nested'); fs.mkdirSync(nested);
  assert.deepEqual(readRuntimeIdentity({ repoDir: nested, root: f.root }), { kind: 'unmanaged', deployVersion: 'unknown', sourceGit: null });
});

test('the report explicitly describes manifest metadata rather than file authentication', t => {
  const f = fixture(t), deployed = f.stage();
  const before = readRuntimeIdentity({ repoDir: deployed.release, root: f.root });
  fs.writeFileSync(path.join(deployed.release, 'bin/owned.js'), 'outside installer modification\n');
  const after = readRuntimeIdentity({ repoDir: deployed.release, root: f.root });
  assert.deepEqual(after, before);
  assert.equal(after.verification, 'manifest-receipt-only');
});

test('both actual staged consumers report their code path even when the configured deploy target differs', t => {
  const f = fixture(t), repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  fs.writeFileSync(path.join(f.source, 'package.json'), '{"files":["bin/","lib/"]}\n');
  fs.mkdirSync(path.join(f.source, 'lib'));
  for (const name of ['mesh-health-publisher.js', 'mesh-deploy-listener.js']) {
    fs.copyFileSync(path.join(repo, 'bin', name), path.join(f.source, 'bin', name));
  }
  fs.copyFileSync(path.join(repo, 'lib/runtime-identity.js'), path.join(f.source, 'lib/runtime-identity.js'));
  fs.writeFileSync(path.join(f.source, 'node_modules/nats/index.js'), 'exports.connect = () => { throw Error("daemon must not start during import"); }; exports.StringCodec = () => ({});\n');
  fs.writeFileSync(path.join(f.source, 'lib/tracer.js'), 'exports.createTracer=()=>({wrap:(_n,fn)=>fn,wrapAsync:(_n,fn)=>fn}); exports.setNatsConnection=()=>{};\n');
  fs.writeFileSync(path.join(f.source, 'lib/node-id.js'), 'exports.resolveNodeId=()=>"owned";\n');
  fs.writeFileSync(path.join(f.source, 'lib/nats-resolve.js'), 'exports.NATS_URL="nats://127.0.0.1:1"; exports.natsConnectOpts=()=>({});\n');
  fs.writeFileSync(path.join(f.source, 'lib/mesh-roles.js'), 'exports.ROLE_COMPONENTS={};\n');
  const deployed = f.stage();
  for (const name of ['mesh-health-publisher.js', 'mesh-deploy-listener.js']) {
    const stdout = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require(process.argv[1]).getDeployIdentity()))', path.join(deployed.release, 'bin', name)], {
      encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH, HOME: f.home, OPENCLAW_ROOT: f.root,
        OPENCLAW_REPO_DIR: f.source, OPENCLAW_NODE_ROLE: 'lead' },
    });
    const identity = JSON.parse(stdout);
    assert.equal(identity.kind, 'managed-runtime');
    assert.equal(identity.digest, deployed.digest);
    assert.equal(identity.deployVersion, `runtime:${deployed.digest}`);
  }
});


test('a self-consistent receipt for a foreign ABI refuses while a version difference stays explicit', t => {
  const f = fixture(t), deployed = f.stage();
  let location = deployed.release, receipt = JSON.parse(fs.readFileSync(path.join(location, '.openclaw-node-release.json')));
  const replace = change => {
    change(receipt.node);
    receipt.digest = createHash('sha256').update(JSON.stringify({ node: receipt.node, files: receipt.files })).digest('hex');
    const next = path.join(path.dirname(location), receipt.digest); fs.renameSync(location, next); location = next;
    fs.writeFileSync(path.join(location, '.openclaw-node-release.json'), JSON.stringify(receipt));
  };
  replace(node => { node.version = 'owned-other-version'; });
  const version = readRuntimeIdentity({ repoDir: location, root: f.root });
  assert.equal(version.nodeVersionMatches, false); assert.equal(version.nodeAbiCompatible, true);
  assert.equal(version.runningNode.version, process.versions.node);
  replace(node => { node.abi = 'owned-foreign-ABI'; });
  assert.throws(() => readRuntimeIdentity({ repoDir: location, root: f.root }), /ABI\/platform\/architecture/);
});
