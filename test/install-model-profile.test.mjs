import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = readFileSync(join(root, 'scripts/install/config.sh'), 'utf8');
const policy = config.slice(config.indexOf('if $SKIP_LLM; then'), config.indexOf('if [ -f "$ENV_FILE" ] && [ -n "${OPENCLAW_PROVIDER:-}" ]'));

test('Linux model consumers keep the capability live while refreshing saved backend settings', () => {
  for (const unit of ['openclaw-memory-daemon.service', 'openclaw-node-watch.service']) {
    const text = readFileSync(join(root, 'services/systemd', unit), 'utf8');
    assert.match(text, /^EnvironmentFile=-\$\{HOME\}\/\.openclaw\/openclaw\.env$/m);
    assert.match(text, /^UnsetEnvironment=OPENCLAW_MODEL_ENABLED$/m);
  }
});

test('download deferral preserves provisioned models while an explicit opt-out disables them', t => {
  const dir = mkdtempSync(join(tmpdir(), 'install-model-profile-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const envFile = join(dir, 'openclaw.env');
  for (const [prior, skip, disable, expected] of [
    ['1', true, false, '1'], ['1', true, true, '0'],
    ['0', true, false, '0'], ['', true, false, '0'], ['', false, false, '1'],
  ]) {
    writeFileSync(envFile, prior ? `OPENCLAW_MODEL_ENABLED=${prior}\n` : '');
    const env = { ...process.env, ENV_FILE: envFile, DRY_RUN: 'false',
      SKIP_LLM: String(skip), DISABLE_MODELS: String(disable) };
    if (prior) env.OPENCLAW_MODEL_ENABLED = prior;
    else delete env.OPENCLAW_MODEL_ENABLED;
    const result = spawnSync('bash', ['-c', `set -euo pipefail\nsource "$1"\n${policy}\nprintf '%s' "$OPENCLAW_MODEL_ENABLED"`,
      'model-profile-test', join(root, 'scripts/install/helpers.sh')], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected, `prior=${prior}, skip=${skip}, disable=${disable}`);
    assert.equal(readFileSync(envFile, 'utf8'), `OPENCLAW_MODEL_ENABLED=${expected}\n`);
  }
});

test('wave-two setup refreshes active model consumers and preserves stopped services', t => {
  const home = mkdtempSync(join(tmpdir(), 'wave-two-profile-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const stub = join(home, 'stub');
  mkdirSync(stub);
  const envFile = join(home, 'openclaw.env');
  writeFileSync(envFile, 'OPENCLAW_MODEL_ENABLED=0\n');
  writeFileSync(join(stub, 'uname'), '#!/bin/sh\necho Linux\n', { mode: 0o755 });
  writeFileSync(join(stub, 'curl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(stub, 'systemctl'), `#!/bin/sh
if [ "$2" = is-active ]; then
  [ "$4" = openclaw-memory-daemon.service ]
else
  printf '%s\\n' "$*" >> "$TEST_RESTART_LOG"
fi
`, { mode: 0o755 });
  const restartLog = join(home, 'restarts');
  const result = spawnSync('bash', [join(root, 'scripts/install/llm-setup.sh'), '--endpoint',
    'http://127.0.0.1:1', '--model', 'owned-test-model'], {
    env: { HOME: home, ENV_FILE: envFile, OPENCLAW_ROOT: home,
      OPENCLAW_LLM_HOST: '0', REPO_DIR: root, NODE_BIN: process.execPath,
      WORKSPACE: join(home, 'workspace'), TEST_RESTART_LOG: restartLog,
      PATH: `${stub}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(envFile, 'utf8'), /^OPENCLAW_MODEL_ENABLED=1$/m);
  assert.equal(readFileSync(restartLog, 'utf8'), '--user restart openclaw-memory-daemon.service\n');
});
