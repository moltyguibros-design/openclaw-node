/**
 * node-init-mesh-code.test.mjs — re-running node-init on an existing checkout
 * reports what really happened. It used to ignore git pull's and npm install's
 * exit codes and always print "Updated", and on a checkout the signed-deploy
 * listener had detached the pull failed every time. mesh-install.sh, the usual
 * entry, gets the same treatment.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.env.OPENCLAW_OBS_DB = ':memory:';
const { installMeshCode } = require('../bin/openclaw-node-init.js');

const tmp = mkdtempSync(join(tmpdir(), 'node-init-mesh-'));
const git = (...a) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...a], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

function runInit({ npmStatus = 0 } = {}) {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'npm') return { status: npmStatus, stderr: npmStatus ? 'npm ERR! missing peer' : '' };
    return spawnSync(cmd, args, opts);
  };
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { installMeshCode('unused', { meshDir: tmp, run }); } finally { console.log = orig; }
  return { calls, out: lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '') };
}

describe('node-init installMeshCode on an existing checkout', () => {
  before(() => {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(tmp, 'package.json'), '{}\n');
    git('add', 'package.json');
    git('commit', '-q', '-m', 'init');
  });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('a branch checkout whose pull fails says so instead of "Updated"', () => {
    const { calls, out } = runInit();
    assert.ok(calls.includes('git pull --ff-only'));
    assert.match(out, /git pull failed — code not updated/);
    assert.doesNotMatch(out, /✓ Updated/);
  });

  it('a checkout detached by signed deploys is left alone', () => {
    const sha = git('rev-parse', '--short', 'HEAD');
    git('checkout', '-q', '--detach');
    const { calls, out } = runInit();
    assert.ok(!calls.some(c => c.startsWith('git pull')), calls.join('\n'));
    assert.match(out, new RegExp(`Code left at ${sha}: signed deploys manage this checkout`));
    assert.match(out, /✓ Dependencies installed/);
  });

  it('a failed npm install is reported, not called success', () => {
    const { out } = runInit({ npmStatus: 1 });
    assert.match(out, /npm install failed: npm ERR! missing peer/);
    assert.doesNotMatch(out, /Dependencies installed|✓ Updated/);
  });

  it('mesh-install.sh leaves a detached checkout alone and reports a failed npm install', () => {
    const src = readFileSync(join(ROOT, 'mesh-install.sh'), 'utf8');
    const fn = src.slice(src.indexOf('ensure_mesh_code() {'), src.indexOf('\n}\n', src.indexOf('ensure_mesh_code() {')) + 3);
    const bin = join(tmp, '.bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(join(bin, 'git'), `#!/bin/sh\n[ "$1" = pull ] && echo PULLED\nexec ${JSON.stringify(spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim())} "$@"\n`, { mode: 0o755 });
    const script = `set -euo pipefail\nok(){ echo "OK $1"; }\nwarn(){ echo "WARN $1"; }\nlog(){ echo "$1"; }\nMESH_DIR=${JSON.stringify(tmp)}\n${fn}\nensure_mesh_code\n`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /PULLED/);
    assert.match(r.stdout, /OK Code left at [0-9a-f]+: signed deploys manage this checkout/);
    assert.match(r.stdout, /WARN npm install failed/);
    assert.doesNotMatch(r.stdout, /Dependencies updated/);
  });
});
