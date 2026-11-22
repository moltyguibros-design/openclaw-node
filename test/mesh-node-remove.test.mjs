import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'bin', 'mesh-node-remove.js');

// Stands in for the nats package: every KV call lands in FAKE_NATS_LOG as one JSON line.
const PRELOAD = `
const Module = require('module');
const fs = require('fs');
const record = (entry) => fs.appendFileSync(process.env.FAKE_NATS_LOG, JSON.stringify(entry) + '\\n');
const empty = () => (async function* () {})();
const fakeNats = {
  StringCodec: () => ({ encode: (s) => Buffer.from(s), decode: (b) => Buffer.from(b).toString() }),
  connect: async () => ({
    getServer: () => 'fake:4222',
    publish: () => {},
    drain: async () => {},
    jetstream: () => ({ views: { kv: async (bucket) => ({
      keys: async () => empty(),
      get: async (key) => { record({ bucket, op: 'get', key }); return null; },
      delete: async (key) => { record({ bucket, op: 'delete', key }); },
    }) } }),
  }),
};
const realLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'nats' ? fakeNats : realLoad.call(this, request, ...rest); };
`;

function runRemote(nodeArg) {
  const home = mkdtempSync(join(tmpdir(), 'mesh-node-remove-'));
  try {
    const preload = join(home, 'fake-nats.cjs');
    const calls = join(home, 'calls.jsonl');
    writeFileSync(preload, PRELOAD);
    const r = spawnSync(process.execPath, [SCRIPT, '--node', nodeArg, '--force'], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, HOME: home, OPENCLAW_NODE_ID: 'lead-x', NODE_OPTIONS: `--require ${preload}`, FAKE_NATS_LOG: calls },
    });
    const log = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { ...r, log };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('mesh-node-remove --node', () => {
  it('resolves an alias and reports a missing registry entry instead of claiming a removal', () => {
    const r = runRemote('calos');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Target node: \S*calos-vmware-virtual-platform/);
    const nodes = r.log.filter((c) => c.bucket === 'MESH_NODES');
    assert.deepEqual(nodes, [{ bucket: 'MESH_NODES', op: 'get', key: 'calos-vmware-virtual-platform' }]);
    assert.match(r.stdout, /No MESH_NODES entry for calos-vmware-virtual-platform/);
    assert.doesNotMatch(r.stdout, /Removed \S+ from MESH_NODES/);
  });
});
