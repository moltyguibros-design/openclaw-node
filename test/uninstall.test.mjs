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
    for (const line of [".openclaw (the toolkit's files)", 'openclaw', '.openclaw-src/openclaw-node']) {
      assert.ok(r.stdout.includes(`    ${join(fx.home, line)}\n`), `the prompt names ${line}`);
    }
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

// bootstrap keeps openclaw-node.old when install.sh fails and leaves .new after an
// interrupted download; both are its own trees under ~/.openclaw-src.
test('uninstall --purge also removes the bootstrap .old and .new trees, with or without the live one', linuxOnly, () => {
  for (const live of [true, false]) {
    const fx = fixture();
    try {
      if (!live) rmSync(join(fx.home, '.openclaw-src/openclaw-node'), { recursive: true });
      for (const rel of ['.openclaw-src/openclaw-node.old/node_modules/big/blob', '.openclaw-src/openclaw-node.new/x']) {
        mkdirSync(dirname(join(fx.home, rel)), { recursive: true });
        writeFileSync(join(fx.home, rel), 'x');
      }
      const r = runUninstall(fx, ['--purge'], 'y\n');
      assert.equal(r.status, 0, r.stderr);
      for (const rel of ['.openclaw-src/openclaw-node.old', '.openclaw-src/openclaw-node.new']) {
        assert.ok(r.stdout.includes(`    ${join(fx.home, rel)}\n`), `live=${live}: the prompt names ${rel}`);
      }
      assert.equal(existsSync(join(fx.home, '.openclaw-src')), false, `live=${live}`);
    } finally {
      rmSync(fx.home, { recursive: true, force: true });
    }
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

function putFiles(home, base, rels) {
  for (const rel of rels) {
    mkdirSync(dirname(join(home, base, rel)), { recursive: true });
    writeFileSync(join(home, base, rel), 'x');
  }
}

// The workspace skills dir is shared: install.sh rsyncs the repo's skills into it and
// the scanner gate installs ClawHub skills next to them.
test('uninstall keeps operator-installed skills and removes only the repo-shipped ones', linuxOnly, () => {
  const fx = fixture();
  try {
    putFiles(fx.home, '.openclaw/workspace/skills', ['mesh/SKILL.md', 'find-skills/SKILL.md', 'my-clawhub-skill/SKILL.md', 'my-clawhub-skill/fix.md']);
    const r = runUninstall(fx);
    assert.equal(r.status, 0, r.stderr);
    for (const shipped of ['mesh', 'find-skills']) {
      assert.equal(existsSync(join(fx.home, '.openclaw/workspace/skills', shipped)), false, shipped);
    }
    assert.equal(existsSync(join(fx.home, '.openclaw/workspace/skills/my-clawhub-skill/fix.md')), true);
    assert.match(r.stdout, /Kept operator-installed skills in .*\/workspace\/skills: my-clawhub-skill\n/);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test('uninstall removes the workspace skills dir when only repo-shipped skills were in it', linuxOnly, () => {
  const fx = fixture();
  try {
    putFiles(fx.home, '.openclaw/workspace/skills', ['mesh/SKILL.md']);
    const r = runUninstall(fx);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(fx.home, '.openclaw/workspace/skills')), false);
    assert.doesNotMatch(r.stdout, /Kept operator-installed skills/);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

// Leftovers of the retired openclaw-mesh setup are reported, never removed: the
// legacy-agent runbook retires them with checks a blind sudo rm skips.
function logTool({ stub }, name, body = 'exit 0') {
  writeFileSync(join(stub, name), `#!/bin/sh\necho "$*" >> "$HOME/${name}.log"\n${body}\n`);
  chmodSync(join(stub, name), 0o755);
}
const logOf = (home, name) => (existsSync(join(home, `${name}.log`)) ? readFileSync(join(home, `${name}.log`), 'utf8') : '');

test('uninstall.sh never runs sudo and removes no system path', () => {
  const src = readFileSync(UNINSTALL_SH, 'utf8');
  assert.doesNotMatch(src, /\bsudo\s/);
  assert.doesNotMatch(src, /rm -[rf]+ "?\/(etc|usr|Library)\//);
});

test('uninstall on Linux reports an active legacy openclaw-agent and leaves it running', linuxOnly, () => {
  const fx = fixture();
  try {
    logTool(fx, 'sudo');
    logTool(fx, 'systemctl');
    const unit = putUnit(fx);
    const r = runUninstall(fx);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(unit), false);
    assert.match(r.stdout, /Legacy openclaw-mesh leftovers found, left in place/);
    assert.match(r.stdout, /system service openclaw-agent/);
    assert.match(r.stdout, /LEGACY_AGENT_RETIREMENT_RUNBOOK\.md/);
    assert.equal(logOf(fx.home, 'sudo'), '');
    for (const line of logOf(fx.home, 'systemctl').split('\n').filter(Boolean)) {
      assert.ok(line.startsWith('--user ') || line.startsWith('is-active '), line);
    }
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

test('uninstall on macOS unloads the user LaunchAgents without sudo', linuxOnly, () => {
  const fx = fixture();
  try {
    logTool(fx, 'sudo');
    logTool(fx, 'launchctl');
    logTool(fx, 'uname', 'echo Darwin');
    putFiles(fx.home, 'Library/LaunchAgents', ['ai.openclaw.memory-daemon.plist']);
    const r = runUninstall(fx);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(fx.home, 'Library/LaunchAgents/ai.openclaw.memory-daemon.plist')), false);
    assert.match(logOf(fx.home, 'launchctl'), /^unload .*ai\.openclaw\.memory-daemon\.plist$/m);
    assert.equal(logOf(fx.home, 'sudo'), '');
    assert.doesNotMatch(r.stdout, /Legacy openclaw-mesh leftovers/);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});

// ~/.openclaw is shared with the OpenClaw gateway, which stays installed: --purge removes
// the toolkit's files and asks a second time before the product's.
const TOOLKIT = [
  'workspace/memory/keep.md', 'config/daemon.json', 'souls/daedalus/SOUL.md', 'logs/memory-daemon.log',
  'state.db', 'openclaw.env', 'identity.key', '.mesh-secret', 'skills/mesh/SKILL.md',
  'state/observer.jsonl', 'skills.retired-2026-01-01/old/SKILL.md', 'retired/2026-01-01/x',
];
const PRODUCT = [
  'credentials/whatsapp/a/creds.json', 'state/openclaw.sqlite', 'agents/main/agent/openclaw-agent.sqlite',
  'agents/main/sessions/s.jsonl', 'openclaw.json', 'devices/paired.json', 'skills/my-skill/SKILL.md',
];

function purgeFixture() {
  const fx = fixture();
  putFiles(fx.home, '.openclaw', [...TOOLKIT, ...PRODUCT]);
  return fx;
}

test('uninstall --purge removes the toolkit files and keeps the OpenClaw product files on a second N or EOF', linuxOnly, () => {
  for (const input of ['y\nn\n', 'y\n']) {
    const fx = purgeFixture();
    try {
      const r = runUninstall(fx, ['--purge'], input);
      assert.equal(r.status, 0, `${JSON.stringify(input)}: ${r.stderr}`);
      for (const rel of TOOLKIT) assert.equal(existsSync(join(fx.home, '.openclaw', rel)), false, `${JSON.stringify(input)}: ${rel}`);
      for (const rel of PRODUCT) assert.equal(existsSync(join(fx.home, '.openclaw', rel)), true, `${JSON.stringify(input)}: ${rel}`);
      for (const rel of ['openclaw', '.openclaw-src']) assert.equal(existsSync(join(fx.home, rel)), false, rel);
      for (const name of ['agents', 'credentials', 'devices', 'openclaw.json', 'skills', 'state']) {
        assert.ok(r.stdout.includes(`    ${name}\n`), `${JSON.stringify(input)}: the second prompt lists ${name}`);
      }
      assert.match(r.stdout, /Kept OpenClaw's own files in /);
    } finally {
      rmSync(fx.home, { recursive: true, force: true });
    }
  }
});

test('uninstall --purge answered Y twice removes ~/.openclaw entirely', linuxOnly, () => {
  const fx = purgeFixture();
  try {
    const r = runUninstall(fx, ['--purge'], 'y\ny\n');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(fx.home, '.openclaw')), false);
  } finally {
    rmSync(fx.home, { recursive: true, force: true });
  }
});
