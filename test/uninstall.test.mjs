import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UNINSTALL_SH = join(ROOT, 'uninstall.sh');

const LAUNCHERS = [
  'Applications/OpenClaw Stack.app',
  '.local/share/applications/openclaw-stack.desktop',
];

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'uninstall-'));
  const put = (rel) => {
    mkdirSync(dirname(join(home, rel)), { recursive: true });
    writeFileSync(join(home, rel), 'x');
  };
  put('Applications/OpenClaw Stack.app/Contents/Info.plist');
  put('.local/share/applications/openclaw-stack.desktop');
  for (const d of ['bin', 'lib', 'packages', 'node_modules']) put(`.openclaw/workspace/${d}/x`);
  put('.openclaw/workspace/memory/keep.md');
  put('openclaw/bin/x');
  put('openclaw/lib/x');
  put('.openclaw-src/openclaw-node/node_modules/@huggingface/transformers/.cache/x');

  const stub = join(home, 'stub-bin');
  mkdirSync(stub);
  const tool = (name, body) => {
    writeFileSync(join(stub, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(stub, name), 0o755);
  };
  tool('lsof', 'touch "$HOME/lsof-called"\necho 4242\nexit 0');
  tool('sudo', 'exit 0');
  tool('systemctl', 'exit 1');
  return { home, stub };
}

function putUnit({ home }) {
  const unit = join(home, '.config/systemd/user/openclaw-memory-daemon.service');
  mkdirSync(dirname(unit), { recursive: true });
  writeFileSync(unit, '[Service]\n');
  return unit;
}

function runUninstall({ home, stub }, args = [], input = '') {
  return spawnSync('bash', [UNINSTALL_SH, ...args], {
    env: { HOME: home, OPENCLAW_ROOT: join(home, '.openclaw'), PATH: `${stub}:/usr/bin:/bin` },
    input,
    encoding: 'utf8',
  });
}

// On Darwin the script first takes the NATS legacy writer lock.
const linuxOnly = { skip: process.platform !== 'linux' && 'uninstall.sh lock step is Darwin-specific' };

test('uninstall removes launchers and installed code trees, keeps memory, never probes :3000', linuxOnly, () => {
  const fx = fixture();
  try {
    const r = runUninstall(fx);
    assert.equal(r.status, 0, r.stderr);
    for (const rel of LAUNCHERS) assert.equal(existsSync(join(fx.home, rel)), false, rel);
    for (const rel of [
      '.openclaw/workspace/bin',
      '.openclaw/workspace/lib',
      '.openclaw/workspace/packages',
      '.openclaw/workspace/node_modules',
      'openclaw/bin',
      'openclaw/lib',
    ]) assert.equal(existsSync(join(fx.home, rel)), false, rel);
    assert.equal(existsSync(join(fx.home, '.openclaw/workspace/memory/keep.md')), true);
    assert.equal(existsSync(join(fx.home, '.openclaw-src/openclaw-node/node_modules')), true);
    assert.equal(existsSync(join(fx.home, 'lsof-called')), false);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test('install-daemon is retired: uninstall removes the memory-daemon unit itself and never runs a stale copy', linuxOnly, () => {
  assert.equal(existsSync(join(ROOT, 'workspace-bin/install-daemon')), false);
  assert.match(readFileSync(join(ROOT, 'scripts/install/retired-files.txt'), 'utf8'), /^workspace-bin install-daemon$/m);
  const fx = fixture();
  try {
    const unit = join(fx.home, '.config/systemd/user/openclaw-memory-daemon.service');
    mkdirSync(dirname(unit), { recursive: true });
    writeFileSync(unit, '[Service]\n');
    writeFileSync(join(fx.home, '.openclaw/workspace/bin/install-daemon'), 'touch "$HOME/install-daemon-ran"\n');
    const r = runUninstall(fx);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(unit), false);
    assert.equal(existsSync(join(fx.home, 'install-daemon-ran')), false);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test('uninstall --purge also removes the launchers outside OPENCLAW_ROOT', linuxOnly, () => {
  const fx = fixture();
  try {
    const unit = putUnit(fx);
    const r = runUninstall(fx, ['--purge'], 'y\n');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(unit), false);
    assert.equal(existsSync(join(fx.home, '.openclaw')), false);
    assert.equal(existsSync(join(fx.home, 'openclaw')), false);
    assert.equal(existsSync(join(fx.home, '.openclaw-src')), false);
    for (const rel of LAUNCHERS) assert.equal(existsSync(join(fx.home, rel)), false, rel);
    for (const rel of ['.openclaw', 'openclaw', '.openclaw-src/openclaw-node']) {
      assert.ok(r.stdout.includes(`    ${join(fx.home, rel)}\n`), `the prompt names ${rel}`);
    }
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test('uninstall --purge answered N or EOF changes nothing', linuxOnly, () => {
  for (const input of ['n\n', '']) {
    const fx = fixture();
    try {
      const unit = putUnit(fx);
      const r = runUninstall(fx, ['--purge'], input);
      assert.equal(r.status, 0, `${JSON.stringify(input)}: ${r.stderr}`);
      assert.match(r.stdout, /nothing changed/, JSON.stringify(input));
      for (const rel of [
        ...LAUNCHERS,
        '.openclaw/workspace/bin',
        'openclaw/bin',
        '.openclaw-src/openclaw-node/node_modules',
      ]) assert.equal(existsSync(join(fx.home, rel)), true, `${JSON.stringify(input)}: ${rel}`);
      assert.equal(existsSync(unit), true, JSON.stringify(input));
    } finally {
      rmSync(fx.home, { recursive: true, force: true });
    }
  }
});
