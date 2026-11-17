/**
 * cli-node-id.test.js — the mesh CLIs derive this node's id with
 * lib/node-id.js, the rule every daemon registers under. They used the full
 * hostname with dash substitution and ignored OPENCLAW_NODE_ID/MESH_NODE_ID, so
 * `mesh deploy --node self` targeted an id no listener answers to,
 * `mesh-node-remove` released tasks for an id that owns nothing, and
 * fleetDeploy did not exclude the lead itself.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-node-id-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function env(extra) {
  const e = {
    ...process.env,
    HOME: tmp,
    OPENCLAW_OBS_DB: path.join(tmp, 'obs.db'),
    OPENCLAW_NATS: 'nats://127.0.0.1:1',
    OPENCLAW_REPO_DIR: ROOT,
    ...extra,
  };
  for (const k of ['OPENCLAW_NODE_ID', 'MESH_NODE_ID']) if (!(k in extra)) delete e[k];
  return e;
}
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('mesh CLIs use lib/node-id.js', () => {
  it('mesh deploy --node self targets OPENCLAW_NODE_ID', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh.js'), 'deploy', '--node', 'self'], {
      encoding: 'utf8', env: env({ OPENCLAW_NODE_ID: 'node-x' }),
    });
    assert.match(r.stdout, /Targets: node-x\n/, r.stdout + r.stderr);
  });

  it('mesh-node-remove (local mode) names OPENCLAW_NODE_ID', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mesh-node-remove.js')], {
      encoding: 'utf8', input: 'n\n', env: env({ OPENCLAW_NODE_ID: 'node-x' }),
    });
    const out = strip(r.stdout);
    assert.match(out, /Target node: node-x\n/, out + r.stderr);
    assert.match(out, /Cancelled/);
  });

  it('fleetDeploy excludes this node when its id comes from MESH_NODE_ID', () => {
    const script = `
      const { StringCodec } = require('nats');
      const sc = StringCodec();
      const now = new Date().toISOString();
      const nodes = { 'lead-x': { nodeId: 'lead-x', role: 'lead', lastSeen: now }, w1: { nodeId: 'w1', role: 'worker', lastSeen: now } };
      const kv = { async keys() { return (async function* () { yield* Object.keys(nodes); })(); },
                   async get(k) { return { value: sc.encode(JSON.stringify(nodes[k])) }; } };
      const nc = { jetstream: () => ({ views: { kv: async () => kv } }) };
      require(${JSON.stringify(path.join(ROOT, 'bin', 'fleet-deploy.js'))})
        .fleetDeploy(nc, { dryRun: true }).then(() => process.exit(0), e => { console.error(e); process.exit(1); });
    `;
    const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: env({ MESH_NODE_ID: 'lead-x' }) });
    const out = strip(r.stdout);
    assert.equal(r.status, 0, out + r.stderr);
    assert.match(out, /→ 1 node\(s\)/, out);
    assert.match(out, /● w1 \(worker\)/);
    assert.doesNotMatch(out, /● lead-x/);
  });
});
