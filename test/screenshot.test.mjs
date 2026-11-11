import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/screenshot', import.meta.url));

test('a successful Linux capture without --clipboard prints the path and exits 0', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fakebin = path.join(root, 'fakebin');
  fs.mkdirSync(fakebin);
  fs.writeFileSync(path.join(fakebin, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakebin, 'scrot'), '#!/bin/sh\n: > "$1"\n', { mode: 0o755 });
  const out = path.join(root, 'out.png');
  const r = spawnSync('bash', [script, out], {
    env: { ...process.env, PATH: fakebin + path.delimiter + process.env.PATH, OPENCLAW_WORKSPACE: root },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), out);
  assert.ok(fs.existsSync(out));
});
