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

test('engines say >=22.12 everywhere, and CI tests the floor instead of Node 20', () => {
  for (const rel of ['package.json', 'mission-control/package.json',
    'packages/openclaw-memory-context-engine/package.json', 'lib/mcp-knowledge/package.json']) {
    assert.equal(JSON.parse(read(rel)).engines.node, '>=22.12', rel);
  }
  const matrix = read('.github/workflows/test.yml').match(/node-version: \[([^\]]*)\]/)[1];
  assert.deepEqual(matrix.split(',').map(s => s.trim()), ["'22.12.0'", '22']);
});
