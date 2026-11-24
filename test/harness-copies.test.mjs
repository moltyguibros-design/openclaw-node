// Each `npx openclaw-node-harness` version is copied to ~/.openclaw/harness/<version>
// (about 0.5 GB with its node_modules) and none was ever removed. The workspace and
// mesh-home dependency links were made once, into the first copy, and never moved,
// so the daemons kept running that version's libraries after every update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function linkDependencyTree() {
  const src = readFileSync(join(ROOT, 'scripts/install/deps.sh'), 'utf8');
  const start = src.indexOf('link_dependency() {');
  const end = src.indexOf('\n}\n', src.indexOf('link_dependency_tree() {'));
  assert.ok(start >= 0 && end > start, 'link_dependency_tree parsed');
  return src.slice(start, end + 3);
}

test('dependency links left in an older harness copy follow the current one; other links stay', () => {
  const root = mkdtempSync(join(tmpdir(), 'oc-harness-links-'));
  try {
    const oc = join(root, '.openclaw');
    for (const v of ['1.0.0', '2.0.0']) {
      for (const pkg of ['nats', 'mine', '@scope/x']) mkdirSync(join(oc, 'harness', v, 'node_modules', pkg), { recursive: true });
    }
    const custom = join(root, 'elsewhere', 'mine');
    mkdirSync(custom, { recursive: true });
    const ws = join(oc, 'workspace', 'node_modules');
    mkdirSync(join(ws, '@scope'), { recursive: true });
    const old = join(oc, 'harness', '1.0.0', 'node_modules');
    symlinkSync(join(old, 'nats'), join(ws, 'nats'));
    symlinkSync(join(old, '@scope', 'x'), join(ws, '@scope', 'x'));
    symlinkSync(custom, join(ws, 'mine'));

    const cur = join(oc, 'harness', '2.0.0', 'node_modules');
    const r = spawnSync('bash', ['-ec', `run() { "$@"; }\n${linkDependencyTree()}\nlink_dependency_tree "$1" "$2"\necho "linked=$LINKED_COUNT"`, 'x', cur, ws], {
      encoding: 'utf8', env: { ...process.env, OPENCLAW_ROOT: oc },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readlinkSync(join(ws, 'nats')), join(cur, 'nats'));
    assert.equal(readlinkSync(join(ws, '@scope', 'x')), join(cur, '@scope', 'x'));
    assert.equal(readlinkSync(join(ws, 'mine')), custom, 'a link the operator pointed elsewhere is left alone');
    assert.match(r.stdout, /linked=2$/m);

    const again = spawnSync('bash', ['-ec', `run() { "$@"; }\n${linkDependencyTree()}\nlink_dependency_tree "$1" "$2"\necho "linked=$LINKED_COUNT"`, 'x', cur, ws], {
      encoding: 'utf8', env: { ...process.env, OPENCLAW_ROOT: oc },
    });
    assert.match(again.stdout, /linked=0$/m, 'links already at the current copy are not rewritten');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function npxPackage(dir, version, installBody) {
  const pkg = join(dir, 'npm-cache', '_npx', 'f00d', 'node_modules', 'openclaw-node-harness');
  mkdirSync(join(pkg, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, 'cli.js'), join(pkg, 'cli.js'));
  copyFileSync(join(ROOT, 'lib', 'openclaw-root.js'), join(pkg, 'lib', 'openclaw-root.js'));
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'openclaw-node-harness', version }));
  writeFileSync(join(pkg, 'install.sh'), `${installBody}\n`);
  return pkg;
}

function seedCopies(home, versions) {
  for (const v of versions) {
    mkdirSync(join(home, '.openclaw', 'harness', v), { recursive: true });
    writeFileSync(join(home, '.openclaw', 'harness', v, 'install.sh'), 'exit 0\n');
  }
}

test('a successful npx install keeps the current copy and the newest older one, and any a service unit runs from', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-harness-prune-'));
  try {
    const home = join(dir, 'home');
    const harness = join(home, '.openclaw', 'harness');
    seedCopies(home, ['0.9.0', '1.0.0', '1.9.0', '1.10.0-rc.1']);
    mkdirSync(join(harness, '2.0.0.tmp-123'), { recursive: true });
    const units = join(home, '.config', 'systemd', 'user');
    mkdirSync(units, { recursive: true });
    writeFileSync(join(units, 'openclaw-mesh-agent.service'), `[Service]\nExecStart=/usr/bin/node ${harness}/0.9.0/bin/mesh-agent.js\n`);
    const agents = join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, 'ai.openclaw.other.plist'), `<string>${harness}/1.0.01/bin/x.js</string>\n`);

    const pkg = npxPackage(dir, '2.0.0', 'exit 0');
    const r = spawnSync(process.execPath, [join(pkg, 'cli.js'), '--update'], {
      env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(harness).sort(), ['0.9.0', '1.10.0-rc.1', '2.0.0', '2.0.0.tmp-123']);
    assert.match(r.stdout, /Removed old harness copy .*1\.0\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed, dry-run or help run removes no harness copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-harness-keep-'));
  try {
    const home = join(dir, 'home');
    const harness = join(home, '.openclaw', 'harness');
    seedCopies(home, ['1.0.0', '1.1.0']);
    const failing = npxPackage(join(dir, 'a'), '2.0.0', 'exit 3');
    const env = { PATH: process.env.PATH, HOME: home };
    assert.equal(spawnSync(process.execPath, [join(failing, 'cli.js'), '--update'], { env, encoding: 'utf8' }).status, 3);
    assert.deepEqual(readdirSync(harness).sort(), ['1.0.0', '1.1.0', '2.0.0']);

    const ok = npxPackage(join(dir, 'b'), '3.0.0', 'exit 0');
    assert.equal(spawnSync(process.execPath, [join(ok, 'cli.js'), '--dry-run'], { env, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [join(ok, 'cli.js'), '--help'], { env, encoding: 'utf8' }).status, 0);
    assert.ok(existsSync(join(harness, '1.0.0')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
