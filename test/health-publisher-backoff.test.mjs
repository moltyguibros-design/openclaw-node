/**
 * health-publisher-backoff.test.mjs — the publisher's put-failure backoff must
 * retry before its MESH_NODE_HEALTH entry expires. A retry gap longer than the
 * KV TTL leaves a node offline in MC and fleet-deploy long after NATS is back.
 *
 * mesh-health-publisher.js connects to NATS on load, so this reads its source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'bin', 'mesh-health-publisher.js'), 'utf8');

function num(re) {
  const m = src.match(re);
  assert.ok(m, `${re} not found in mesh-health-publisher.js`);
  return Number(m[1].replace(/_/g, ''));
}

describe('mesh-health-publisher backoff', () => {
  it('the longest retry gap stays inside the health KV TTL', () => {
    const interval = num(/const PUBLISH_INTERVAL_MS = ([\d_]+)/);
    const ttl = num(/const KV_TTL_MS = ([\d_]+)/);
    const cap = num(/Math\.pow\(2, Math\.min\(consecutiveFailures, (\d+)\)\)/);
    const longestGap = (2 ** cap + 1) * interval;
    assert.ok(longestGap < ttl, `retry gap ${longestGap}ms must be shorter than the ${ttl}ms TTL`);
  });
});
