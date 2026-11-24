/**
 * mesh-kv.test.mjs — OPENCLAW_KV_REPLICAS reaches the mesh KV buckets.
 *
 * Install wrote the council replica count to openclaw.env and the README
 * promised 3 copies, but every opener called js.views.kv(bucket) without
 * `replicas`, so MESH_TASKS / collab / plans / deploy / health were R=1 and
 * losing the machine that held them lost the data.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { openMeshKv, meshKvReplicas } = require('../lib/mesh-kv.js');

function fakeJs(failures = []) {
  const calls = [];
  return {
    calls,
    views: {
      async kv(bucket, opts) {
        calls.push({ bucket, opts });
        const err = failures.shift();
        if (err) throw new Error(err);
        return { bucket, opts };
      },
    },
  };
}
const noSleep = async () => {};

describe('openMeshKv', () => {
  let home, saved;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-kv-'));
    saved = { HOME: process.env.HOME, R: process.env.OPENCLAW_KV_REPLICAS };
    process.env.HOME = home;
    delete process.env.OPENCLAW_KV_REPLICAS;
  });
  afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.R === undefined) delete process.env.OPENCLAW_KV_REPLICAS; else process.env.OPENCLAW_KV_REPLICAS = saved.R;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('creates the bucket at the replica count install wrote to openclaw.env', async () => {
    fs.mkdirSync(path.join(home, '.openclaw'));
    fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_KV_REPLICAS=3\n');
    assert.equal(meshKvReplicas(), 3);
    const js = fakeJs();
    await openMeshKv(js, 'MESH_TASKS', { history: 1 });
    assert.deepEqual(js.calls, [{ bucket: 'MESH_TASKS', opts: { history: 1, replicas: 3 } }]);
  });

  it('a solo box (nothing set) gets R=1', async () => {
    const js = fakeJs();
    await openMeshKv(js, 'MESH_TASKS');
    assert.equal(js.calls[0].opts.replicas, 1);
  });

  it('waits for a forming cluster instead of falling back to R=1', async () => {
    const js = fakeJs(['insufficient resources', 'no suitable peers for placement']);
    const kv = await openMeshKv(js, 'MESH_COLLAB', {}, { replicas: 3, sleep: noSleep, log: () => {} });
    assert.equal(kv.opts.replicas, 3);
    assert.deepEqual(js.calls.map(c => c.opts.replicas), [3, 3, 3]);
  });

  it('gives up after waitMs (a CLI passes 0 and fails at once)', async () => {
    const js = fakeJs(['insufficient resources']);
    await assert.rejects(openMeshKv(js, 'MESH_DEPLOY_RESULTS', {}, { replicas: 3, waitMs: 0, sleep: noSleep }),
      /could not place 3 replicas/);
    assert.equal(js.calls.length, 1);
  });

  it('other errors, and any error at R=1, are not retried', async () => {
    await assert.rejects(openMeshKv(fakeJs(['authorization violation']), 'B', {}, { replicas: 3, sleep: noSleep }), /authorization/);
    await assert.rejects(openMeshKv(fakeJs(['insufficient resources']), 'B', {}, { replicas: 1, sleep: noSleep }), /insufficient/);
  });
});

describe('mesh KV openers', () => {
  const OPENERS = [
    'bin/mesh-task-daemon.js', 'bin/mesh-deploy-listener.js', 'bin/mesh-health-publisher.js',
    'lib/mesh-registry.js', 'bin/fleet-deploy.js', 'bin/mesh.js', 'bin/mesh-node-remove.js',
    'bin/discord-read.js', 'bin/openclaw-node-init.js',
  ];
  for (const rel of OPENERS) {
    it(`${rel} opens its buckets through openMeshKv`, () => {
      const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
      assert.doesNotMatch(src, /views\.kv\(/, 'a direct views.kv() creates the bucket at R=1');
      assert.match(src, /openMeshKv\(js, /);
    });
  }
});
