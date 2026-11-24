/**
 * node-floor.test.mjs — one Node floor: 22.12.
 *
 * require() of an ES module (lib/node-identity.mjs, loaded by
 * bin/mesh-join-token.js and openclaw-node-init) works unflagged only from
 * 22.12, but engines said >=22, prereqs/bootstrap compared the major version
 * only, mesh-install accepted 18 and never linked the keg-only node@22, and CI
 * tested Node 20. A 22.0-22.11 box passed every gate, then failed on join.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function nodeOkFrom(rel) {
  const m = read(rel).match(/^[ \t]*node_ok\(\) \{\n[\s\S]*?\n[ \t]*\}\n/m);
  assert.ok(m, `${rel} defines a multi-line node_ok()`);
  return m[0];
}

// node_ok with a fake `node` that reports `version` (null: no node on PATH).
function nodeOk(fn, version) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'node-floor-'));
  try {
    if (version) {
      fs.writeFileSync(path.join(bin, 'node'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
    }
    const script = `have() { command -v "$1" >/dev/null 2>&1; }\n${fn}\nnode_ok`;
    return spawnSync('/bin/bash', ['-c', script], { env: { PATH: bin } }).status === 0;
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
}

for (const rel of ['scripts/install/prereqs.sh', 'bootstrap.sh', 'mesh-install.sh']) {
  test(`${rel} node_ok accepts 22.12+ and refuses everything older`, () => {
    const fn = nodeOkFrom(rel);
    for (const v of ['v22.12.0', 'v22.20.1', 'v23.0.0', 'v24.3.0']) assert.equal(nodeOk(fn, v), true, v);
    for (const v of ['v22.11.0', 'v22.0.0', 'v20.19.0', 'v18.20.4', null]) assert.equal(nodeOk(fn, v), false, String(v));
  });
}

test('mesh-install.sh gates on node_ok and links the keg-only node@22 it installs', () => {
  const src = read('mesh-install.sh');
  assert.match(src, /if node_ok; then/);
  assert.match(src, /brew install node@22 && brew link --overwrite --force node@22/);
  assert.match(src, /node_ok \|\| die/);
  assert.doesNotMatch(src, /18\+/);
});

// The worker join piped NodeSource's setup script into `sudo -E bash`; bootstrap.sh and
// prereqs.sh add the signed apt source instead.
test('mesh-install.sh installs Node on apt from the signed NodeSource source, never a piped root script', () => {
  const src = read('mesh-install.sh');
  const fn = src.match(/^ensure_node\(\) \{\n[\s\S]*?\n\}\n/m)[0];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-install-node-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const tool = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    tool('apt-get', 'exit 0');
    tool('curl', `echo "$*" >> "${dir}/curl.log"; echo FAKE-KEY`);
    tool('sudo', [
      `echo "$*" >> "${dir}/sudo.log"`,
      `case "$1" in tee|gpg|bash) cat > "${dir}/stdin.$1" ;; esac`,
      `[ "$*" = "apt-get install -y nodejs" ] && printf '#!/bin/sh\\necho v22.12.0\\n' > "${bin}/node" && chmod +x "${bin}/node"`,
      'exit 0',
    ].join('\n'));
    for (const real of ['cat', 'chmod', 'printf']) {
      const p = spawnSync('/bin/bash', ['-c', `command -v ${real}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).stdout.trim();
      if (p.startsWith('/')) fs.symlinkSync(p, path.join(bin, real));
    }
    const script = `log() { :; }; ok() { :; }; warn() { :; }; die() { echo "DIE $1"; exit 1; }\n${nodeOkFrom('mesh-install.sh')}\n${fn}\nOS=linux\nensure_node`;
    const r = spawnSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { PATH: bin } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const sudo = fs.readFileSync(path.join(dir, 'sudo.log'), 'utf8');
    assert.doesNotMatch(sudo, /^(-E )?bash/m, 'no downloaded script runs as root');
    assert.equal(fs.existsSync(path.join(dir, 'stdin.bash')), false);
    assert.match(sudo, /^apt-get update -y\napt-get install -y ca-certificates gnupg\nmkdir -p \/etc\/apt\/keyrings$/m);
    assert.match(sudo, /^gpg --dearmor --yes -o \/etc\/apt\/keyrings\/nodesource\.gpg$/m);
    assert.equal(fs.readFileSync(path.join(dir, 'stdin.gpg'), 'utf8'), 'FAKE-KEY\n');
    assert.equal(fs.readFileSync(path.join(dir, 'stdin.tee'), 'utf8'),
      'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n');
    assert.match(sudo, /^tee \/etc\/apt\/sources\.list\.d\/nodesource\.list$/m);
    assert.match(sudo, /^apt-get update -y\napt-get install -y nodejs$/m);
    assert.equal(fs.readFileSync(path.join(dir, 'curl.log'), 'utf8'), '-fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('engines say >=22.12 everywhere, and CI tests the floor instead of Node 20', () => {
  for (const rel of ['package.json', 'mission-control/package.json',
    'packages/openclaw-memory-context-engine/package.json', 'lib/mcp-knowledge/package.json']) {
    assert.equal(JSON.parse(read(rel)).engines.node, '>=22.12', rel);
  }
  const matrix = read('.github/workflows/test.yml').match(/node-version: \[([^\]]*)\]/)[1];
  assert.deepEqual(matrix.split(',').map(s => s.trim()), ["'22.12.0'", '22']);
});
