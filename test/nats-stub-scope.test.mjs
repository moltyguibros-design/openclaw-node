import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// nats is a declared dependency and mesh-collab/mesh-plans/circling-parser use
// only its StringCodec, so a resolver stub there just hides the real surface.
// mesh-registry.test.js is the one suite that stubs it, for connect().
test('only mesh-registry.test.js stubs the nats module resolver', () => {
  const stubbing = fs.readdirSync(here)
    .filter(f => /\.test\.(c|m)?js$/.test(f))
    .filter(f => /require\.cache\[['"]nats['"]\]|request === ['"]nats['"]/.test(fs.readFileSync(path.join(here, f), 'utf8')));
  assert.deepEqual(stubbing, ['mesh-registry.test.js']);
});
