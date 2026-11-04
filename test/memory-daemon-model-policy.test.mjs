import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('scheduled indexing skips dispatch when models are off and follows profile changes', t => {
  const home = mkdtempSync(join(tmpdir(), 'daemon-model-policy-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.openclaw'));
  const profile = join(home, '.openclaw/openclaw.env');
  writeFileSync(profile, 'OPENCLAW_MODEL_ENABLED=0\n');
  writeFileSync(join(home, '.openclaw/state.db'), 'owned pending-index fixture');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const { runKnowledgeIndex } = await import('./workspace-bin/memory-daemon.mjs');
    let calls = 0;
    const run = async () => { calls++; return { stdout: '{"indexed":1,"chunks":2}\\n' }; };
    assert.equal((await runKnowledgeIndex({ run })).skipped, 'models_disabled');
    assert.equal(calls, 0);
    fs.writeFileSync(process.env.TEST_PROFILE, 'OPENCLAW_MODEL_ENABLED=1\\n');
    assert.deepEqual(await runKnowledgeIndex({ run }), { indexed: 1, chunks: 2 });
    assert.equal(calls, 1);
    fs.writeFileSync(process.env.TEST_PROFILE, 'OPENCLAW_MODEL_ENABLED=0\\n');
    assert.equal((await runKnowledgeIndex({ run })).skipped, 'models_disabled');
    assert.equal(calls, 1);
  `], { cwd: root, env: {
    HOME: home, PATH: process.env.PATH, OPENCLAW_HOME: join(home, '.openclaw'),
    OPENCLAW_WORKSPACE: join(home, 'workspace'),
    OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART: '1', TEST_PROFILE: profile,
  }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
