import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stageRuntime, withRuntimeTransaction } from '../lib/runtime-deploy.mjs';
import { archiveRuntime } from '../lib/runtime-retention.mjs';

const verifier = fileURLToPath(new URL('../scripts/install/verify-runtime-archive.py', import.meta.url));
const reader = fileURLToPath(new URL('./helpers/runtime-retention-process-reader.py', import.meta.url));
const referenceRefusal = error => error.message === 'Runtime archive refused: Selected release has a current/previous/config/unit/workspace/process reference';
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

function fixture(t) {
  const scratch = fileURLToPath(new URL('../.tmp/', import.meta.url));
  fs.mkdirSync(scratch, { recursive: true });
  const home = fs.mkdtempSync(path.join(scratch, 'owned-retention-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'source'), root = path.join(home, 'røøt');
  const stub = path.join(home, 'owned-unit-reader'); fs.mkdirSync(stub);
  fs.writeFileSync(path.join(stub, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const previousPath = process.env.PATH; process.env.PATH = stub + ':' + previousPath;
  t.after(() => { process.env.PATH = previousPath; });
  const write = (name, value) => { const p = path.join(source, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
  write('package.json', JSON.stringify({ files: ['bin/', 'lib/'] }));
  write('package-lock.json', '{}'); write('node_modules/nats/index.js', 'owned dependency');
  write('lib/value.js', 'owned1'); write('bin/start.js', 'owned');
  fs.symlinkSync('nats/index.js', path.join(source, 'node_modules/alias'));
  const releases = [];
  for (let i = 0; i < 4; i++) {
    write('lib/value.js', `owned${i}`);
    releases.push(stageRuntime({ root, source, availableBytes: () => 64 * 1024 ** 3 }));
  }
  fs.mkdirSync(path.join(root, 'workspace'));
  const parent = path.join(root, 'runtime/node'), configPath = path.join(home, 'reader-config.json');
  const config = { parent, uid: process.getuid(), mode: 'live', node: process.execPath, liveReference: null };
  const setReader = value => fs.writeFileSync(configPath, JSON.stringify({ ...config, ...value }), { mode: 0o600 });
  setReader({});
  fs.writeFileSync(path.join(stub, 'sudo'), `#!/bin/sh\nexec /usr/bin/python3 -I -S -B ${shellQuote(reader)} ${shellQuote(configPath)} "$@"\n`, { mode: 0o755 });
  const readerArgv = ['-n', '/usr/bin/python3', '-I', '-S', '-B', verifier, '--process-references', parent, '--uid', String(config.uid)];
  const invokeReader = (args = readerArgv) => spawnSync('/usr/bin/python3', ['-I', '-S', '-B', reader, configPath, ...args], { encoding: 'utf8', timeout: 15000 });
  const journal = () => fs.readFileSync(path.join(home, 'reader.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  return { home, root, source, releases, names: releases.slice(0, 2).map(r => r.digest), parent, setReader, invokeReader, readerArgv, journal };
}

const linux = process.platform === 'linux';

test('archive verifies every file/link and preserves shared dependency bytes before retired-code pruning', { skip: !linux }, t => {
  const f = fixture(t), current = fs.realpathSync(path.join(f.parent, 'current'));
  const data = path.join(f.root, 'owned-current.db'); fs.writeFileSync(data, 'owned data remains');
  const result = archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names });
  assert.equal(result.phase, 'complete'); assert.deepEqual(result.pruned, [...f.names].sort());
  const observations = f.journal();
  assert.equal(observations.length, 2);
  for (const record of observations) {
    assert.equal(record.mode, 'live'); assert.equal(record.scanner_called, true); assert.equal(record.enumerated, true);
    assert.equal(record.entries.length, 1); assert.match(record.entries[0], /^\/proc\/\d+$/);
    assert.equal(record.outcome, 'success'); assert.deepEqual(record.selected, []);
  }
  for (const name of f.names) assert.equal(fs.existsSync(path.join(f.parent, name)), false);
  for (const release of f.releases.slice(2)) assert.equal(fs.existsSync(release.release), true);
  assert.equal(fs.realpathSync(path.join(f.parent, 'current')), current);
  assert.equal(fs.readFileSync(data, 'utf8'), 'owned data remains');
  const verified = spawnSync('/usr/bin/python3', ['-I', '-S', '-B', verifier, '--verify', result.attempt], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr); assert.equal(JSON.parse(verified.stdout).archive_sha256, result.archive_sha256);
  const archive = path.join(result.attempt, 'runtime.tar.gz');
  const bytes = fs.readFileSync(archive); bytes[Math.floor(bytes.length / 2)] ^= 255; fs.writeFileSync(archive, bytes);
  const corrupt = spawnSync('/usr/bin/python3', ['-I', '-S', '-B', verifier, '--verify', result.attempt], { encoding: 'utf8' });
  assert.notEqual(corrupt.status, 0);
});

test('current, current previous, installation metadata and workspace references refuse without archive allocation', { skip: !linux }, t => {
  const f = fixture(t);
  for (const r of f.releases.slice(2)) assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: [r.digest] }), referenceRefusal);
  fs.symlinkSync(path.join(f.releases[0].release, 'node_modules'), path.join(f.root, 'workspace/node_modules'));
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: [f.names[0]] }), referenceRefusal);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node-archives')), false);
});

test('corruption, unknown mutable data, unsafe selection and foreign lock refuse while preserving code', { skip: !linux }, t => {
  const f = fixture(t), release = f.releases[0].release;
  fs.writeFileSync(path.join(release, 'owned-private.db'), 'not archived or deleted');
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /Unknown data/);
  fs.unlinkSync(path.join(release, 'owned-private.db'));
  fs.writeFileSync(path.join(release, 'lib/value.js'), 'corrupt');
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /mismatch/);
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: ['../escape'] }), /explicit unique/);
  const lock = path.join(f.root, '.installer-lock'); fs.mkdirSync(lock); fs.writeFileSync(path.join(lock, 'other'), 'keep');
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /locked/);
  assert.equal(fs.readFileSync(path.join(lock, 'other'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(release), true);
});

test('unfinished archive attempt refuses another writer and retains all evidence/code', { skip: !linux }, t => {
  const f = fixture(t), prior = path.join(f.root, 'runtime/node-archives/owned-interrupted');
  fs.mkdirSync(prior, { recursive: true }); fs.writeFileSync(path.join(prior, 'result.json'), '{"phase":"verified"}');
  fs.writeFileSync(path.join(prior, 'runtime.partial.tar.gz'), 'owned partial');
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /Unfinished archive/);
  assert.equal(fs.readFileSync(path.join(prior, 'runtime.partial.tar.gz'), 'utf8'), 'owned partial');
  assert.equal(fs.existsSync(f.releases[0].release), true);
});

test('runtime mutation and retention share the installer and runtime transaction locks', t => {
  const f = fixture(t);
  withRuntimeTransaction(f.root, 'owned-test', () => {
    assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /locked/);
    assert.throws(() => stageRuntime({ root: f.root, source: f.source }), /locked/);
  });
  assert.equal(fs.existsSync(path.join(f.root, '.installer-lock')), false);
});


test('archive writer failure retains intent/partial data and prunes nothing', { skip: !linux }, t => {
  const f = fixture(t), stub = path.join(f.home, 'stub'); fs.mkdirSync(stub);
  fs.writeFileSync(path.join(stub, 'tar'), '#!/bin/sh\nprintf owned-partial\nexit 9\n', { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = stub + ':' + previous;
  try { assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /status 9/); }
  finally { process.env.PATH = previous; }
  const folder = path.join(f.root, 'runtime/node-archives'), attempts = fs.readdirSync(folder);
  assert.equal(attempts.length, 1);
  const attempt = path.join(folder, attempts[0]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(attempt, 'result.json'))).phase, 'error');
  assert.equal(fs.readFileSync(path.join(attempt, 'runtime.partial.tar.gz'), 'utf8'), 'owned-partial');
  for (const release of f.releases) assert.equal(fs.existsSync(release.release), true);
});

test('archive budget refuses without removing old archives or retired code', { skip: !linux }, t => {
  const f = fixture(t), prior = path.join(f.root, 'runtime/node-archives/owned-complete');
  fs.mkdirSync(prior, { recursive: true }); fs.writeFileSync(path.join(prior, 'result.json'), '{"phase":"complete"}'); fs.writeFileSync(path.join(prior, 'manifest.json'), '{}');
  const fd = fs.openSync(path.join(prior, 'runtime.tar.gz'), 'w'); fs.ftruncateSync(fd, 1024 ** 3); fs.closeSync(fd);
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /budget/);
  assert.equal(fs.existsSync(prior), true); assert.equal(fs.existsSync(f.releases[0].release), true);
});


test('retained staging/selection leftovers refuse archival without touching their evidence', { skip: !linux }, t => {
  const f = fixture(t), pending = path.join(f.parent, '.staging-owned-interrupted');
  fs.mkdirSync(pending); fs.writeFileSync(path.join(pending, 'owned-data'), 'retain');
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), /parent entry/);
  assert.equal(fs.readFileSync(path.join(pending, 'owned-data'), 'utf8'), 'retain');
  assert.equal(fs.existsSync(f.releases[0].release), true);
});


test('active config and non-ASCII installation metadata keep retired code referenced', { skip: !linux }, t => {
  const f = fixture(t), config = path.join(f.root, 'config/owned-policy.json');
  fs.writeFileSync(config, JSON.stringify({ root: f.releases[0].release }));
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), referenceRefusal);
  fs.unlinkSync(config);
  const envFile = path.join(f.root, 'openclaw.env');
  fs.writeFileSync(envFile, `OWNED_ROOT='${f.releases[0].release}'\n`);
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), referenceRefusal);
  fs.unlinkSync(envFile);
  const record = path.join(f.root, 'config/installation.json'), value = JSON.parse(fs.readFileSync(record));
  value.previousComplete = { runtime: f.releases[0].release };
  fs.writeFileSync(record, JSON.stringify(value));
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), referenceRefusal);
  assert.equal(fs.existsSync(f.releases[0].release), true);
});

test('an owned process using a retired release only through NODE_PATH protects it', { skip: !linux }, t => {
  const f = fixture(t);
  f.setReader({ liveReference: f.releases[0].release });
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), referenceRefusal);
  const [record] = f.journal();
  assert.equal(record.scanner_called, true); assert.equal(record.enumerated, true);
  assert.equal(record.mode, 'live'); assert.equal(record.outcome, 'success');
  assert.equal(record.entries.length, 2); assert.ok(record.entries.includes(`/proc/${record.child_pid}`));
  assert.deepEqual(record.selected, [f.names[0]]); assert.equal(record.child_reaped, true);
  assert.throws(() => process.kill(record.child_pid, 0), { code: 'ESRCH' });
  assert.equal(fs.existsSync(f.releases[0].release), true);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node-archives')), false);
});

function procEntry(f, channel, identity = Array(4).fill(process.getuid())) {
  const proc = path.join(f.home, 'proc');
  fs.rmSync(proc, { recursive: true, force: true });
  const entry = path.join(proc, '12345'); fs.mkdirSync(path.join(entry, 'fd'), { recursive: true });
  fs.writeFileSync(path.join(entry, 'status'), `Name:\towned\nUid:\t${identity.join('\t')}\n`);
  for (const field of ['cmdline', 'maps', 'environ']) fs.writeFileSync(path.join(entry, field), 'owned');
  for (const field of ['cwd', 'exe', 'root']) fs.symlinkSync(f.home, path.join(entry, field));
  fs.symlinkSync(f.home, path.join(entry, 'fd/4'));
  if (['cmdline', 'maps', 'environ'].includes(channel)) {
    fs.writeFileSync(path.join(entry, channel), `owned\0${f.releases[0].release}\0`);
  } else if (channel) {
    const link = path.join(entry, channel === 'fd' ? 'fd/4' : channel);
    fs.unlinkSync(link); fs.symlinkSync(f.releases[0].release, link);
  }
  f.setReader({ mode: 'synthetic' });
  return entry;
}

test('owned reader exercises every production process-reference channel', { skip: !linux }, t => {
  const f = fixture(t);
  for (const channel of ['cmdline', 'maps', 'environ', 'cwd', 'exe', 'root', 'fd']) {
    procEntry(f, channel);
    const result = f.invokeReader();
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), [f.names[0]], channel);
    const record = f.journal().at(-1);
    assert.equal(record.scanner_called, true); assert.equal(record.enumerated, true);
    assert.equal(record.entries.length, 1); assert.equal(record.outcome, 'success');
  }
});

test('owned reader matches each UID field and ignores other UIDs and non-PID entries', { skip: !linux }, t => {
  const f = fixture(t), uid = process.getuid();
  for (let i = 0; i < 4; i++) {
    const identity = Array(4).fill(uid + 1); identity[i] = uid;
    procEntry(f, 'environ', identity);
    const result = f.invokeReader();
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), [f.names[0]]);
  }
  const entry = procEntry(f, 'environ', Array(4).fill(uid + 1));
  fs.mkdirSync(path.join(f.home, 'proc/not-a-pid'));
  let result = f.invokeReader(); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), []);
  fs.writeFileSync(path.join(entry, 'status'), 'Name:\towned\n');
  result = f.invokeReader(); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), []);
});

test('owned reader distinguishes a disappeared process from denied metadata', { skip: !linux }, t => {
  const f = fixture(t), entry = procEntry(f, 'environ');
  fs.unlinkSync(path.join(entry, 'cmdline'));
  let result = f.invokeReader(); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout), []);
  fs.writeFileSync(path.join(entry, 'cmdline'), 'owned');
  fs.chmodSync(path.join(entry, 'maps'), 0);
  try {
    result = f.invokeReader(); assert.equal(result.status, 77); assert.match(result.stderr, /PermissionError/);
    const record = f.journal().at(-1);
    assert.equal(record.scanner_called, true); assert.equal(record.outcome, 'error'); assert.equal(record.error_type, 'PermissionError');
  } finally { fs.chmodSync(path.join(entry, 'maps'), 0o600); }
});

test('owned reader refuses changed command arguments, parent and UID', { skip: !linux }, t => {
  const f = fixture(t);
  for (const args of [f.readerArgv.slice(1), [...f.readerArgv, '--extra'], f.readerArgv.map(value => value === f.parent ? f.home : value), [...f.readerArgv.slice(0, -1), String(process.getuid() + 1)]]) {
    const result = f.invokeReader(args); assert.equal(result.status, 77); assert.match(result.stderr, /Unexpected owned reader argv/);
  }
  for (const value of [{ parent: f.home }, { uid: process.getuid() + 1 }, { uid: String(process.getuid()) }]) {
    f.setReader(value);
    const result = f.invokeReader(); assert.equal(result.status, 77); assert.match(result.stderr, /parent\/UID mismatch/);
  }
  assert.equal(fs.existsSync(path.join(f.home, 'reader.jsonl')), false);
});

test('a denied reader cannot satisfy the protected-reference assertion', { skip: !linux }, t => {
  const f = fixture(t); f.setReader({ mode: 'denied' });
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), error => {
    assert.match(error.message, /--process-references/); assert.match(error.message, /exit status 77/);
    assert.equal(referenceRefusal(error), false); return true;
  });
  const [record] = f.journal();
  assert.equal(record.scanner_called, false); assert.equal(record.outcome, 'error'); assert.equal(record.error_type, 'PermissionError');
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node-archives')), false);
  for (const release of f.releases) assert.equal(fs.existsSync(release.release), true);
});

test('malformed reader data refuses before archive allocation and preserves code', { skip: !linux }, t => {
  const f = fixture(t); f.setReader({ mode: 'malformed' });
  assert.throws(() => archiveRuntime({ root: f.root, privilegedProcessReader: true, releases: f.names }), error => {
    assert.match(error.message, /Expecting value/); assert.equal(referenceRefusal(error), false); return true;
  });
  assert.equal(f.journal()[0].outcome, 'malformed-output-control');
  assert.equal(fs.existsSync(path.join(f.root, 'runtime/node-archives')), false);
  for (const release of f.releases) assert.equal(fs.existsSync(release.release), true);
});
