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

test('--display N reaches screencapture as -DN on macOS', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fakebin = path.join(root, 'fakebin');
  fs.mkdirSync(fakebin);
  const argsFile = path.join(root, 'args.txt');
  fs.writeFileSync(path.join(fakebin, 'uname'), '#!/bin/sh\necho Darwin\n', { mode: 0o755 });
  fs.writeFileSync(
    path.join(fakebin, 'screencapture'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nfor a; do last="$a"; done\n: > "$last"\n`,
    { mode: 0o755 },
  );
  const out = path.join(root, 'out.png');
  const r = spawnSync('bash', [script, '--display', '2', out], {
    env: { ...process.env, PATH: fakebin + path.delimiter + process.env.PATH, OPENCLAW_WORKSPACE: root },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), out);
  assert.deepEqual(fs.readFileSync(argsFile, 'utf8').split('\n').filter(Boolean), ['-x', '-D2', out]);
});

test('has no unused DELAY variable', () => {
  assert.doesNotMatch(fs.readFileSync(script, 'utf8'), /^DELAY=""/m);
});
