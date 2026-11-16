import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Live pre-compression flushes own extraction (knownMemories, turn stamp, hash
// record); the session backfill CLI re-implemented that path and had drifted from it.
const RETIRED = ['bin/extract-existing-sessions.mjs'];

function* sources(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(c|m)?js$|\.sh$|\.json$/.test(e.name)) yield p;
  }
}

test('retired operator CLIs stay gone and nothing still runs them', () => {
  for (const rel of RETIRED) {
    assert.ok(!fs.existsSync(path.join(ROOT, rel)), `${rel} is retired`);
    const base = path.basename(rel);
    for (const dir of ['bin', 'lib', 'workspace-bin', 'scripts', 'services', 'test']) {
      for (const f of sources(path.join(ROOT, dir))) {
        if (f === fileURLToPath(import.meta.url)) continue;
        assert.ok(!fs.readFileSync(f, 'utf8').includes(base), `${path.relative(ROOT, f)} still references ${base}`);
      }
    }
  }
});
