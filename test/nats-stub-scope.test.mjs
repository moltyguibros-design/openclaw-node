import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// nats is a declared dependency and mesh-collab/mesh-plans/circling-parser use
// only its StringCodec, so a resolver stub there just hides the real surface.
// Only suites that need a fake connect() stub it: mesh-registry, and the CLI
// suites that drive node-init's topology scan, mesh-node-remove and the mesh
// deploy/rollback paths offline (including the fleet trigger's sha and its signing).
test('only the connect() suites stub the nats module resolver', () => {
  const stubbing = fs.readdirSync(here)
    .filter(f => /\.test\.(c|m)?js$/.test(f))
    .filter(f => /require\.cache\[['"]nats['"]\]|request === ['"]nats['"]/.test(fs.readFileSync(path.join(here, f), 'utf8')));
  assert.deepEqual(stubbing, ['deploy-pinned-sha.test.mjs', 'deploy-trigger-auth.test.mjs', 'mesh-deploy-cli-options.test.js',
    'mesh-deploy-fleet-sha.test.js', 'mesh-deploy-rollback-cli.test.js', 'mesh-node-remove.test.mjs', 'mesh-registry.test.js',
    'node-init-render.test.mjs']);
});
