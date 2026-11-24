import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('timer transition source fences block the launchd label and keep manual entry', () => {
  const result = spawnSync('python3', ['-m', 'unittest', '-v', 'timer_transition_test.SourceFenceTest'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    timeout: 120_000,
    encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 4 tests/);
  assert.doesNotMatch(result.stderr, /skipped/);
});
