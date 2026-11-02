import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const OMIT = new Set(['node_modules', '.next', '.git', 'data', '.build-home', '.build-data']);

function sourceFiles(root, relative = '') {
  return fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      if (OMIT.has(entry.name) || entry.name.startsWith('.env') || /\.(?:db(?:-wal|-shm)?|tsbuildinfo)$/.test(entry.name)) return [];
      const name = path.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Mission Control source symlink is unsupported: ${name}`);
      return entry.isDirectory() ? sourceFiles(root, name) : [name];
    });
}

function runNpm(args, { cwd, env }) {
  const result = spawnSync('npm', args, { cwd, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 900_000 });
  fs.appendFileSync(path.join(cwd, '.build.log'), `npm ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}\n`, { mode: 0o600 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Mission Control npm ${args.join(' ')} failed (${result.signal || result.status}); see ${cwd}/.build.log`);
}

function runningCurrent(parent) {
  if (process.platform !== 'linux') return false;
  const result = spawnSync('systemctl', ['--user', 'show', 'openclaw-mission-control.service',
    '--property=LoadState,ActiveState,MainPID'], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) return false;
  const fields = Object.fromEntries(result.stdout.trim().split('\n').filter(s => s.includes('=')).map(s => s.split('=')));
  if (fields.LoadState !== 'loaded') return false;
  if (fields.ActiveState === 'inactive' && fields.MainPID === '0') return true;
  if (fields.ActiveState !== 'active' || !Number(fields.MainPID)) return false;
  try { return fs.realpathSync(`/proc/${fields.MainPID}/cwd`) === fs.realpathSync(path.join(parent, 'current')); }
  catch { return false; }
}

function releases(parent, data) {
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^[a-f0-9]{16}-[a-f0-9-]{36}$/.test(entry.name))
    .flatMap(entry => {
      const dir = path.join(parent, entry.name);
      let receipt;
      try { receipt = JSON.parse(fs.readFileSync(path.join(dir, '.openclaw-mc-release.json'), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      return receipt.schema === 1 && receipt.data === data ? [{ dir, receipt }] : [];
    });
}

function stagingDirectories(parent) {
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^\.staging-[a-f0-9-]{36}$/.test(entry.name))
    .map(entry => path.join(parent, entry.name));
}

function reconcileInterruptedStages(parent) {
  const thresholdMs = 35 * 60_000;
  for (const dir of stagingDirectories(parent)) {
    if (fs.existsSync(path.join(dir, '.failed.json')) || Date.now() - fs.statSync(dir).mtimeMs < thresholdMs) continue;
    let owner;
    try { owner = JSON.parse(fs.readFileSync(path.join(dir, '.stage.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const record = { reason: 'unmarked-stage-age-exceeded', original_outcome: 'unknown',
      sourceDigest: owner?.sourceDigest || null, threshold_ms: thresholdMs, reconciled_at: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, '.failed.json'), JSON.stringify(record) + '\n', { mode: 0o600, flag: 'wx' });
  }
}

function failedStages(parent) {
  return stagingDirectories(parent).filter(dir => fs.existsSync(path.join(dir, '.failed.json')))
    .sort((a, b) => Number(fs.statSync(path.join(b, '.failed.json'), { bigint: true }).mtimeNs
      - fs.statSync(path.join(a, '.failed.json'), { bigint: true }).mtimeNs));
}

function archiveFailure(parent, dir) {
  const history = path.join(parent, 'failure-history');
  fs.mkdirSync(history, { recursive: true, mode: 0o700 });
  const files = Object.fromEntries(sourceFiles(dir).map(name => [name, fs.readFileSync(path.join(dir, name)).toString('base64')]));
  const archive = gzipSync(Buffer.from(JSON.stringify({ schema: 1, files })));
  const used = fs.readdirSync(history).reduce((n, name) => n + fs.statSync(path.join(history, name)).size, 0);
  if (used + archive.length > 64 * 1024 * 1024) throw new Error('Mission Control failure archive reached its 64MiB limit; export retained evidence before another build');
  fs.writeFileSync(path.join(history, path.basename(dir) + '.json.gz'), archive, { mode: 0o600, flag: 'wx' });
}

export function cleanupMissionControl({ root, workspace, confirmActive = runningCurrent }) {
  const parent = path.join(root, 'runtime', 'mission-control');
  const current = path.join(parent, 'current');
  reconcileInterruptedStages(parent);
  const removed = [];
  for (const dir of failedStages(parent).slice(1)) {
    archiveFailure(parent, dir);
    fs.rmSync(dir, { recursive: true });
    removed.push(dir);
  }
  if (!fs.existsSync(current) || !confirmActive(parent)) return { confirmed: false, removed };
  const owned = releases(parent, path.join(workspace, 'projects', 'mission-control', 'data'));
  const active = owned.find(entry => entry.dir === fs.realpathSync(current));
  if (!active) throw new Error('Mission Control current release has no matching ownership receipt');
  const keep = new Set([active.dir, active.receipt.previousRelease]);
  for (const entry of owned) {
    if (keep.has(entry.dir)) {
      for (const name of ['.build-home', '.build-data']) fs.rmSync(path.join(entry.dir, name), { recursive: true, force: true });
    } else {
      fs.rmSync(entry.dir, { recursive: true });
      removed.push(entry.dir);
    }
  }
  return { confirmed: true, removed };
}

function envLine(key, value) {
  return `${key}=${JSON.stringify(String(value)).replace(/\$/g, '\\$')}\n`;
}

export function deployMissionControl({ source, root, workspace, env = process.env, run = runNpm, confirmActive = runningCurrent, freeBytes }) {
  const parent = path.join(root, 'runtime', 'mission-control');
  const current = path.join(parent, 'current');
  const legacy = path.join(workspace, 'projects', 'mission-control');
  const files = sourceFiles(source);
  const hash = createHash('sha256');
  for (const name of files) hash.update(JSON.stringify([name, createHash('sha256').update(fs.readFileSync(path.join(source, name))).digest('hex')]));
  const sourceDigest = hash.digest('hex');
  const receiptName = '.openclaw-mc-release.json';
  const cleanup = cleanupMissionControl({ root, workspace, confirmActive });
  let prior;
  try { prior = JSON.parse(fs.readFileSync(path.join(current, receiptName), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (prior?.sourceDigest === sourceDigest && fs.existsSync(path.join(current, '.next', 'BUILD_ID'))
      && fs.readFileSync(path.join(current, '.next', 'BUILD_ID'), 'utf8').trim() === prior.buildId) {
    return { directory: current, changed: false, sourceDigest, release: fs.realpathSync(current) };
  }
  if (fs.existsSync(current) && !fs.lstatSync(current).isSymbolicLink()) throw new Error('Managed Mission Control current path must be a release symlink');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const pending = stagingDirectories(parent).find(dir => !fs.existsSync(path.join(dir, '.failed.json')));
  if (pending) throw new Error(`Mission Control has an unmarked build stage at ${pending}; no second build will start. Completed or aged stages are reconciled before the next allocation`);
  const count = releases(parent, path.join(legacy, 'data')).length;
  if (count >= 3 || (count >= 2 && !cleanup.confirmed) || failedStages(parent).length >= 2) {
    throw new Error('Mission Control retention bound reached; activate the selected release and finalize cleanup before another build');
  }
  const stat = freeBytes ? null : fs.statfsSync(parent);
  const available = freeBytes ? freeBytes() : stat.bavail * stat.bsize;
  if (available < 4 * 1024 ** 3) throw new Error('Mission Control staging requires 4GiB free (2GiB build budget plus 2GiB live-data reserve)');
  const stage = path.join(parent, `.staging-${randomUUID()}`);
  fs.mkdirSync(stage, { mode: 0o700 });
  fs.writeFileSync(path.join(stage, '.stage.json'), JSON.stringify({ sourceDigest, pid: process.pid, started_at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  const release = path.join(parent, `${sourceDigest.slice(0, 16)}-${randomUUID()}`);
  try {
    for (const name of files) {
      const dest = path.join(stage, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(source, name), dest);
    }
    const buildHome = path.join(stage, '.build-home');
    const buildData = path.join(stage, '.build-data');
    fs.mkdirSync(buildHome, { mode: 0o700 });
    fs.mkdirSync(buildData, { mode: 0o700 });
    const allowed = new Set(['PATH', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP', 'CI',
      'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
      'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
    const buildEnv = Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key)));
    Object.assign(buildEnv, {
      HOME: buildHome, OPENCLAW_HOME: path.join(buildHome, '.openclaw'),
      WORKSPACE_ROOT: path.join(buildHome, 'workspace'), OPENCLAW_WORKSPACE: path.join(buildHome, 'workspace'),
      DB_PATH: path.join(buildData, 'build.db'), OPENCLAW_NATS: 'nats://127.0.0.1:1',
      OPENCLAW_NATS_TOKEN: 'isolated-build', OPENCLAW_MODEL_ENABLED: '0', OPENCLAW_NO_EMBED_MODEL: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    });
    run(['ci', '--include=dev'], { cwd: stage, env: buildEnv });
    run(['run', 'build'], { cwd: stage, env: buildEnv });
    const buildId = fs.readFileSync(path.join(stage, '.next', 'BUILD_ID'), 'utf8').trim();
    if (!buildId) throw new Error('Mission Control build produced an empty BUILD_ID');
    fs.rmSync(buildHome, { recursive: true });
    fs.rmSync(buildData, { recursive: true });
    let runtimeEnv;
    for (const file of [path.join(current, '.env.local'), path.join(legacy, '.env.local')]) {
      if (fs.existsSync(file)) { runtimeEnv = fs.readFileSync(file, 'utf8'); break; }
    }
    if (runtimeEnv === undefined) {
      runtimeEnv = envLine('WORKSPACE_ROOT', workspace) + envLine('OPENCLAW_HOME', root)
        + envLine('DB_PATH', path.join(legacy, 'data', 'mission-control.db'))
        + envLine('OPENCLAW_NATS', env.OPENCLAW_NATS || '')
        + envLine('OPENCLAW_NATS_TOKEN', env.OPENCLAW_NATS_TOKEN || '')
        + envLine('OPENCLAW_NATS_AUTH', env.OPENCLAW_NATS_AUTH || 'token')
        + envLine('GEMINI_API_KEY', env.GOOGLE_API_KEY || '');
    }
    fs.writeFileSync(path.join(stage, '.env.local'), runtimeEnv, { mode: 0o600 });
    fs.mkdirSync(path.join(legacy, 'data'), { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(legacy, 'data'), path.join(stage, 'data'));
    const receipt = { schema: 1, sourceDigest, buildId, data: path.join(legacy, 'data'), previousRelease: prior ? fs.realpathSync(current) : null };
    fs.writeFileSync(path.join(stage, receiptName), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(stage, release);
    const link = path.join(parent, `.current-${randomUUID()}`);
    fs.symlinkSync(release, link);
    fs.renameSync(link, current);
    return { directory: current, changed: true, sourceDigest, release };
  } catch (error) {
    if (fs.existsSync(stage)) {
      fs.writeFileSync(path.join(stage, '.failed.json'), JSON.stringify({ error: error.message, sourceDigest }) + '\n', { mode: 0o600 });
      try { cleanupMissionControl({ root, workspace, confirmActive }); }
      catch (retentionError) { error.message += `; retention: ${retentionError.message}`; }
    }
    throw error;
  }
}
