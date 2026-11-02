import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const RECEIPT = '.openclaw-node-release.json';
const RESERVE = 4 * 1024 ** 3;
const NODE = { version: process.versions.node, abi: process.versions.modules, platform: process.platform, arch: process.arch };

function gitCheckout(source) {
  if (!fs.existsSync(path.join(source, '.git'))) return false;
  const result = spawnSync('git', ['-C', source, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || fs.realpathSync(result.stdout.trim()) !== source) throw new Error('Cannot enumerate the source Git checkout');
  return true;
}

function entries(source) {
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  const roots = [...new Set(['package.json', 'package-lock.json', 'bootstrap.sh', 'mesh-install.sh', 'memory-plan',
    ...pkg.files.map(name => name.replace(/\/$/, '')), 'node_modules'])];
  const result = new Map();
  const generated = 'packages/event-schemas/dist';
  let allowed = null, directories = null;
  if (gitCheckout(source)) {
    const list = spawnSync('git', ['-C', source, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
      ...roots.filter(name => name !== 'node_modules')], { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 ** 2 });
    if (list.status !== 0) throw new Error('Cannot read the source Git file list');
    allowed = new Set(list.stdout.split('\0').filter(Boolean));
    directories = new Set();
    for (const name of allowed) {
      let parent = path.dirname(name);
      while (parent !== '.') { directories.add(parent); parent = path.dirname(parent); }
    }
  }
  function visit(name) {
    const parts = name.split(path.sep), dependency = parts[0] === 'node_modules';
    if (parts.includes('.git') || parts.includes('.cache')) return;
    if (!dependency && (parts.includes('.tmp') || parts.includes('.npm-cache')
      || parts.includes('.tick.lock') || path.basename(name) === 'TIMELINE.md'
      || /\.(?:log|err|key|pem|sqlite(?:3)?(?:-wal|-shm)?)$/.test(name)
      || name.includes('/tick-logs/') && path.basename(name) !== '.gitkeep')) return;
    if (!dependency && allowed && !allowed.has(name) && !directories.has(name)
      && name !== generated && !name.startsWith(generated + '/') && !generated.startsWith(name + '/')) return;
    if (!dependency && (parts.includes('node_modules') || parts.includes('.next') || /^mission-control\/(?:data|\.build-home|\.build-data)(?:\/|$)/.test(name)
      || parts.some(part => part.startsWith('.env') && !/\.(?:example|sample|template)$/.test(part))
      || /\.tsbuildinfo$/.test(name) || parts[0] === 'memory-plan' && /\.(?:db(?:-wal|-shm)?|zip|tar|qcow2|asif)$/.test(name))) return;
    const absolute = path.resolve(source, name);
    if (!absolute.startsWith(source + path.sep)) throw new Error('Runtime manifest path escapes its source');
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolute).sort()) visit(path.join(name, child));
    } else if (stat.isSymbolicLink()) {
      const resolved = fs.realpathSync(absolute);
      if (!resolved.startsWith(source + path.sep)) throw new Error(`Runtime dependency link leaves source: ${name}`);
      const target = path.relative(path.dirname(name), path.relative(source, resolved));
      result.set(name, { name, kind: 'link', target });
    } else if (stat.isFile()) {
      result.set(name, { name, kind: 'file', bytes: stat.size, mode: stat.mode & 0o777,
        sha256: hash(fs.readFileSync(absolute)) });
    } else throw new Error(`Unsupported runtime source entry: ${name}`);
  }
  for (const name of roots) if (fs.existsSync(path.join(source, name))) visit(name);
  if (!fs.existsSync(path.join(source, 'node_modules/nats'))) throw new Error('Runtime dependencies missing; prepare the source lock before staging');
  return [...result.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function verify(release, files) {
  for (const entry of files) {
    const p = path.join(release, entry.name), stat = fs.lstatSync(p);
    if (entry.kind === 'link') {
      if (!stat.isSymbolicLink() || fs.readlinkSync(p) !== entry.target) throw new Error(`Runtime link mismatch: ${entry.name}`);
      if (!fs.realpathSync(p).startsWith(release + path.sep)) throw new Error(`Runtime link is not self-contained: ${entry.name}`);
    } else {
      const mode = entry.name.startsWith('node_modules/') ? entry.mode & ~0o222 : entry.mode;
      if (!stat.isFile() || hash(fs.readFileSync(p)) !== entry.sha256 || (stat.mode & 0o777) !== mode) {
        throw new Error(`Runtime content or mode mismatch: ${entry.name}`);
      }
    }
  }
}

function sourceGit(source) {
  if (!gitCheckout(source)) return { selection: 'packed-roots', head: null, dirty: null };
  const head = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
  if (head.status !== 0) return { selection: 'git-index-unignored-and-generated-schemas', head: null, dirty: null };
  const dirty = spawnSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8', timeout: 5000 });
  return { selection: 'git-index-unignored-and-generated-schemas', head: head.stdout.trim(), dirty: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null };
}

function prepareInstallation(root, source, release, digest, sourceGit) {
  fs.mkdirSync(path.join(root, 'config'), { recursive: true, mode: 0o700 });
  const record = path.join(root, 'config', 'installation.json');
  const prior = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : null;
  if (prior && ![1, 2].includes(prior.schema)) throw new Error('Unknown installation record schema');
  const summary = value => value && ({ runtime: value.runtime, digest: value.digest,
    phase: value.phase || 'legacy-unknown', updated: value.updated,
    completedAt: value.completedAt || null, acceptance: value.acceptance || null,
    servicesRequested: value.servicesRequested ?? null });
  const value = { schema: 2, attemptId: randomUUID(), phase: 'prepared', source, runtime: release, digest,
    node: NODE, sourceGit, workspace: path.join(root, 'workspace'), updated: new Date().toISOString(),
    priorSelection: summary(prior), previousComplete: prior?.phase === 'installer-complete'
      ? summary(prior) : prior?.previousComplete || null };
  const pending = `${record}.${randomUUID()}`;
  fs.writeFileSync(pending, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
  return { record, pending, value };
}

export function stageRuntime({ source, root, availableBytes = dir => {
  const stat = fs.statfsSync(dir); return stat.bavail * stat.bsize;
} }) {
  source = fs.realpathSync(source);
  root = path.resolve(root);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  root = fs.realpathSync(root);
  const parent = path.join(root, 'runtime', 'node');
  if (parent === source || parent.startsWith(source + path.sep)) throw new Error('Runtime destination is inside the source');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lock = path.join(parent, '.deploy-lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Runtime deployment is locked: ${lock}`); throw error; }
  let stage;
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), source }) + '\n', { mode: 0o600 });
    const unknown = fs.readdirSync(parent).filter(name => name.startsWith('.staging-'));
    if (unknown.length) throw new Error(`Retained incomplete runtime stage requires reconciliation: ${unknown.join(', ')}`);
    const files = entries(source);
    const digest = hash(JSON.stringify({ node: NODE, files }));
    const release = path.join(parent, digest), current = path.join(parent, 'current');
    let previous = null, previousReceipt = null;
    if (fs.readdirSync(parent).includes('current')) {
      if (!fs.lstatSync(current).isSymbolicLink()) throw new Error('Runtime current must be an owned release symlink');
      previous = fs.realpathSync(current);
      if (path.dirname(previous) !== parent) throw new Error('Runtime current leaves the managed release directory');
      previousReceipt = JSON.parse(fs.readFileSync(path.join(previous, RECEIPT), 'utf8'));
      if (previousReceipt.schema !== 1 || previousReceipt.digest !== path.basename(previous)) throw new Error('Runtime current receipt is invalid');
      verify(previous, previousReceipt.files);
    }
    if (fs.existsSync(release)) {
      const receipt = JSON.parse(fs.readFileSync(path.join(release, RECEIPT), 'utf8'));
      if (receipt.digest !== digest || JSON.stringify(receipt.files) !== JSON.stringify(files)) throw new Error('Runtime reuse receipt differs from source');
      verify(release, files);
      if (previous !== release) throw new Error('Existing runtime is not current; an explicit rollback contract is required');
      const record = prepareInstallation(root, source, release, digest, receipt.sourceGit);
      fs.renameSync(record.pending, record.record);
      return { release, digest, reused: true, receipt, attemptId: record.value.attemptId };
    }
    const retained = fs.readdirSync(parent).filter(name => /^[a-f0-9]{64}$/.test(name));
    if (retained.length >= 8) throw new Error('Runtime release retention reached 8; preserve and reconcile old releases before another allocation');
    const previousFiles = new Map((previousReceipt?.files || []).map(entry => [entry.name, entry]));
    const reuseFile = entry => entry.name.startsWith('node_modules/') && entry.kind === 'file'
      && previousFiles.get(entry.name)?.sha256 === entry.sha256 && previousFiles.get(entry.name)?.mode === entry.mode;
    const allocation = files.reduce((sum, entry) => sum + (entry.kind === 'file' && !reuseFile(entry) ? entry.bytes : 0), 0);
    if (availableBytes(parent) < allocation + RESERVE) throw new Error('Insufficient runtime allocation space plus 4GiB reserve');
    stage = path.join(parent, `.staging-${randomUUID()}`);
    fs.mkdirSync(stage, { mode: 0o700 });
    fs.writeFileSync(path.join(stage, '.stage.json'), JSON.stringify({ source, digest, pid: process.pid, started: new Date().toISOString() }) + '\n', { mode: 0o600 });
    let reusedDependencyBytes = 0;
    for (const entry of files) {
      const target = path.join(stage, entry.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (entry.kind === 'link') fs.symlinkSync(entry.target, target);
      else if (reuseFile(entry)) {
        const prior = path.join(previous, entry.name);
        if (fs.statSync(prior).mode & 0o222) throw new Error(`Managed dependency is writable: ${entry.name}`);
        fs.linkSync(prior, target);
        reusedDependencyBytes += entry.bytes;
      } else {
        fs.copyFileSync(path.join(source, entry.name), target, fs.constants.COPYFILE_FICLONE);
        fs.chmodSync(target, entry.name.startsWith('node_modules/') ? entry.mode & ~0o222 : entry.mode);
      }
    }
    verify(stage, files);
    if (JSON.stringify(entries(source)) !== JSON.stringify(files)) throw new Error('Source changed during runtime staging');
    const receipt = { schema: 1, digest, source, sourceGit: sourceGit(source), node: NODE, files,
      previousRelease: previous, created: new Date().toISOString(), allocation, reusedDependencyBytes };
    fs.writeFileSync(path.join(stage, RECEIPT), JSON.stringify(receipt) + '\n', { mode: 0o600 });
    fs.unlinkSync(path.join(stage, '.stage.json'));
    fs.renameSync(stage, release);
    stage = null;
    const record = prepareInstallation(root, source, release, digest, receipt.sourceGit);
    const temporary = path.join(parent, `.current-${randomUUID()}`);
    fs.symlinkSync(release, temporary);
    fs.renameSync(temporary, current);
    fs.renameSync(record.pending, record.record);
    return { release, digest, reused: false, receipt, attemptId: record.value.attemptId };
  } catch (error) {
    if (stage) fs.writeFileSync(path.join(stage, '.failed.json'), JSON.stringify({ error: error.message, outcome: 'failed', at: new Date().toISOString() }) + '\n', { mode: 0o600 });
    throw error;
  } finally {
    fs.rmSync(lock, { recursive: true });
  }
}

export function completeInstallation({ root, runtime, attemptId, acceptance, servicesRequested }) {
  if (!['accepted', 'incomplete', 'skipped'].includes(acceptance) || typeof servicesRequested !== 'boolean') {
    throw new Error('Invalid installer outcome');
  }
  root = fs.realpathSync(root);
  runtime = fs.realpathSync(runtime);
  const parent = path.join(root, 'runtime', 'node'), lock = path.join(parent, '.deploy-lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error(`Runtime deployment is locked: ${lock}`); throw error; }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, operation: 'complete-installation' }) + '\n', { mode: 0o600 });
    const recordPath = path.join(root, 'config', 'installation.json');
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (record.schema !== 2 || record.phase !== 'prepared' || record.attemptId !== attemptId
      || record.runtime !== runtime || path.dirname(runtime) !== parent
      || fs.realpathSync(path.join(parent, 'current')) !== runtime || record.digest !== path.basename(runtime)) {
      throw new Error('Installer completion does not match the prepared attempt/current runtime');
    }
    const receipt = JSON.parse(fs.readFileSync(path.join(runtime, RECEIPT), 'utf8'));
    if (receipt.schema !== 1 || receipt.digest !== record.digest
      || hash(JSON.stringify({ node: receipt.node, files: receipt.files })) !== record.digest) {
      throw new Error('Installer completion manifest receipt mismatch');
    }
    verify(runtime, receipt.files);
    const completed = { ...record, phase: 'installer-complete', acceptance, servicesRequested,
      completedAt: new Date().toISOString(), verification: 'installer-record' };
    const pending = `${recordPath}.${randomUUID()}`;
    fs.writeFileSync(pending, JSON.stringify(completed) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(pending, recordPath);
    return completed;
  } finally {
    try { fs.rmSync(path.join(lock, 'owner.json'), { force: true }); fs.rmdirSync(lock); }
    catch (error) { process.stderr.write(`Installer completion lock retained: ${error.message}\n`); }
  }
}

export function bindRuntimeDependencies({ source, destination, root }) {
  source = fs.realpathSync(source);
  destination = path.resolve(destination);
  root = fs.realpathSync(root);
  const release = path.dirname(source), parent = path.join(root, 'runtime', 'node');
  if (path.dirname(release) !== parent || path.basename(source) !== 'node_modules') throw new Error('Dependency binding requires a managed runtime');
  const receipt = JSON.parse(fs.readFileSync(path.join(release, RECEIPT), 'utf8'));
  if (receipt.schema !== 1 || receipt.digest !== path.basename(release)) throw new Error('Dependency binding receipt is invalid');
  let present = false;
  try { fs.lstatSync(destination); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (present && fs.realpathSync(destination) === source) return { destination, source, reused: true, archived: null };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.select-${randomUUID()}`;
  fs.symlinkSync(source, temporary);
  let archived = null;
  try {
    if (present && !fs.lstatSync(destination).isSymbolicLink()) {
      archived = path.join(path.dirname(destination), `.node_modules.pre-runtime-${randomUUID()}`);
      fs.renameSync(destination, archived);
    }
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (archived) fs.renameSync(archived, destination);
    throw error;
  }
  const record = { source, destination, archived, selected: new Date().toISOString() };
  const recordDir = path.join(root, 'config', 'dependency-bindings');
  fs.mkdirSync(recordDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(recordDir, `${hash(destination).slice(0, 16)}.json`), JSON.stringify(record) + '\n', { mode: 0o600 });
  return { ...record, reused: false };
}
