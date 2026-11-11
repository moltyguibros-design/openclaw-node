/**
 * nats-cluster-config.test.mjs — step 1.5. Proves the multi-machine cluster
 * config + replica logic is correct WITHOUT real machines (the failover itself
 * can only be proven on separate hardware; this proves the config we'd deploy).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parsePeers, peerToRoute, renderClusterRoutes,
  replicasForPeers, clampReplicas, resolveKvReplicas, CLUSTER_PORT,
} from '../lib/nats-cluster-config.js';

test('parsePeers: comma/space/array → clean tokens', () => {
  assert.deepEqual(parsePeers('100.64.0.2, 100.64.0.3'), ['100.64.0.2', '100.64.0.3']);
  assert.deepEqual(parsePeers('a  b\tc'), ['a', 'b', 'c']);
  assert.deepEqual(parsePeers(['x', 'y']), ['x', 'y']);
  assert.deepEqual(parsePeers(''), []);
  assert.deepEqual(parsePeers(null), []);
});

test('peerToRoute: bare host gets cluster port; explicit port preserved', () => {
  assert.equal(peerToRoute('100.64.0.2'), `nats-route://100.64.0.2:${CLUSTER_PORT}`);
  assert.equal(peerToRoute('100.64.0.2:7000'), 'nats-route://100.64.0.2:7000');
  assert.equal(peerToRoute('nats-route://10.0.1.11'), `nats-route://10.0.1.11:${CLUSTER_PORT}`);
  assert.equal(peerToRoute('[fd00::2]:6222'), 'nats-route://[fd00::2]:6222');
});

test('renderClusterRoutes: two peers → indented route lines (matches template block)', () => {
  const block = renderClusterRoutes('100.64.0.2,100.64.0.3');
  assert.equal(block, '    nats-route://100.64.0.2:6222\n    nats-route://100.64.0.3:6222');
});

test('replicasForPeers: solo→1, 2-node→2, 3-node→3, 5-node capped at 3', () => {
  assert.equal(replicasForPeers(0), 1); // no peers = solo
  assert.equal(replicasForPeers(1), 2); // self + 1
  assert.equal(replicasForPeers(2), 3); // self + 2 = the council
  assert.equal(replicasForPeers(4), 3); // capped at MAX
});

test('clampReplicas: valid range [1,5], junk → 1', () => {
  assert.equal(clampReplicas(3), 3);
  assert.equal(clampReplicas(0), 1);
  assert.equal(clampReplicas(9), 5);
  assert.equal(clampReplicas('nope'), 1);
  assert.equal(clampReplicas(undefined), 1);
});

test('resolveKvReplicas: env-driven; solo box (no env) → 1 (never crashes a lone server)', () => {
  assert.equal(resolveKvReplicas({}), 1);
  assert.equal(resolveKvReplicas({ OPENCLAW_KV_REPLICAS: '3' }), 3);
  assert.equal(resolveKvReplicas({ OPENCLAW_KV_REPLICAS: '1' }), 1);
});

test('item 9: routes carry cluster credentials when provided', () => {
  assert.equal(
    peerToRoute('100.64.0.2', undefined, { user: 'openclaw-route', pass: 's3cret' }),
    'nats-route://openclaw-route:s3cret@100.64.0.2:6222',
  );
  const block = renderClusterRoutes('100.64.0.2,100.64.0.3', { user: 'openclaw-route', pass: 'pw' });
  assert.equal(block,
    '    nats-route://openclaw-route:pw@100.64.0.2:6222\n    nats-route://openclaw-route:pw@100.64.0.3:6222');
  // no credentials → unchanged legacy form
  assert.equal(peerToRoute('100.64.0.2'), 'nats-route://100.64.0.2:6222');
});

test('cluster docs show the authenticated own-address config the template renders', () => {
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
  const template = read('services/nats/nats-cluster-node.conf');
  assert.match(template, /^http: 127\.0\.0\.1:8222$/m);
  assert.match(template, /^include "nats-auth\.conf"$/m);
  for (const doc of ['docs/MULTI_NODE_DEPLOY.md', 'docs/NATS_CLUSTER.md']) {
    const blocks = [...read(doc).matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => /\bcluster\s*\{/.test(b));
    assert.ok(blocks.length > 0, doc);
    for (const b of blocks) {
      assert.doesNotMatch(b, /listen:\s*0\.0\.0\.0/, doc);
      assert.doesNotMatch(b, /http_port:\s*8222/, doc);
      assert.match(b, /^http: 127\.0\.0\.1:8222$/m, doc);
      assert.match(b, /include "nats-auth\.conf"/, doc);
      assert.match(b, /authorization\s*\{/, doc);
      assert.match(b, /nats-route:\/\/openclaw-route:/, doc);
    }
  }
  assert.doesNotMatch(read('docs/MULTI_NODE_DEPLOY.md'), /binds `0\.0\.0\.0`/);
});
