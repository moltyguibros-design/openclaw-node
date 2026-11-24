import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Every traced module writes to the obs DB, whose default is the node's real Mission
// Control database; `npm test` on an operator's node (plan-tick's close check) must not
// fill it with test activity.
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('npm test runs the suite against an in-memory obs DB', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test.startsWith('OPENCLAW_OBS_DB=:memory: '), pkg.scripts.test);
});

test('OPENCLAW_OBS_DB=:memory: writes nothing under HOME or the working directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-iso-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-iso-cwd-'));
  try {
    const obsDb = path.join(ROOT, 'lib', 'obs-db.js');
    const r = spawnSync(process.execPath, ['-e',
      `require(${JSON.stringify(obsDb)}).insertEvent({ event_type: 'x', module: 'm', function_name: 'f', node_id: 'n' })`,
    ], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, OPENCLAW_OBS_DB: ':memory:', OPENCLAW_WORKSPACE: '' } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(home, '.openclaw')), false);
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
