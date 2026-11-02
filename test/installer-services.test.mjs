import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, unlinkSync, symlinkSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'scripts/install/services.sh'), 'utf8');
const unitsOnly = source.slice(0, source.indexOf('# Step 16.5:'));

function fixture(t, { masked = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'installer-services-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, 'repo'), templates = join(repo, 'services/systemd');
  const dest = join(home, 'units'), stub = join(home, 'stub'), actions = join(home, 'actions');
  for (const dir of [templates, dest, stub]) mkdirSync(dir, { recursive: true });
  const manifest = [
    { name: 'openclaw-mission-control', role: 'both', autostart: true },
    { name: 'openclaw-memory-daemon', role: 'both', autostart: true },
    { name: 'openclaw-nats-1', role: 'both', autostart: false },
    { name: 'openclaw-log-rotate', role: 'both', autostart: true, timer: true },
  ];
  writeFileSync(join(repo, 'services/service-manifest.json'), JSON.stringify(manifest));
  for (const service of manifest) {
    for (const ext of service.timer ? ['service', 'timer'] : ['service']) {
      const name = `${service.name}.${ext}`;
      copyFileSync(join(root, 'services/systemd', name), join(templates, name));
      writeFileSync(join(dest, name), '# prior installed unit\n');
    }
  }
  if (masked) {
    unlinkSync(join(dest, 'openclaw-mission-control.service'));
    symlinkSync('/dev/null', join(dest, 'openclaw-mission-control.service'));
  }
  writeFileSync(join(stub, 'systemctl'), `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_ACTIONS"
if [ "$2" = is-enabled ]; then
  case "$3" in
    openclaw-mission-control.service) echo ${masked ? 'masked' : 'enabled'}; exit ${masked ? 1 : 0} ;;
    openclaw-log-rotate.timer) echo enabled; exit 0 ;;
    *) echo disabled; exit 1 ;;
  esac
fi
if [ "$2" = is-active ]; then
  [ "$4" = openclaw-memory-daemon.service ]; exit $?
fi
exit 0
`, { mode: 0o755 });
  writeFileSync(join(stub, 'loginctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  function run() {
    return spawnSync('bash', ['-c', `set -euo pipefail\nsource "$1"\nOS=linux\n${unitsOnly}`,
      'service-fixture', join(root, 'scripts/install/helpers.sh')], { encoding: 'utf8', timeout: 20_000,
      env: { HOME: home, PATH: `${stub}:${process.env.PATH}`, REPO_DIR: repo,
        OPENCLAW_ROOT: join(home, '.openclaw'), WORKSPACE: join(home, 'workspace'),
        OPENCLAW_WORKSPACE: join(home, 'workspace'), OPENCLAW_REPO_DIR: repo,
        OPENCLAW_SYSTEMD_DIR: dest, NODE_BIN: process.execPath, NPM_BIN: '/usr/bin/npm',
        NATS_SERVER_BIN: '/usr/bin/nats-server', OPENCLAW_NATS: 'nats://127.0.0.1:1',
        OPENCLAW_NATS_TOKEN: 'owned-fixture', OPENCLAW_NODE_ID: 'owned', OPENCLAW_NODE_ROLE: 'lead',
        NODE_ROLE: 'lead', MESH_LLM_PROVIDER: '', LLM_MODEL: 'owned', LLM_BASE_URL: 'http://127.0.0.1:1',
        DRY_RUN: 'false', UPDATE_ONLY: 'true', ENABLE_SERVICES: 'true', TEST_ACTIONS: actions },
    });
  }
  return { run, templates, actions, dest };
}

test('unit update reloads first, restarts current processes, and preserves disabled/timer semantics', t => {
  const f = fixture(t), result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const actions = readFileSync(f.actions, 'utf8').trim().split('\n');
  const activated = actions.filter(line => /--user (?:start|restart|enable) /.test(line));
  assert.deepEqual(activated, [
    '--user enable openclaw-mission-control.service', '--user restart openclaw-mission-control.service',
    '--user restart openclaw-memory-daemon.service',
    '--user enable openclaw-log-rotate.timer', '--user restart openclaw-log-rotate.timer',
  ]);
  assert.ok(actions.indexOf('--user daemon-reload') < actions.indexOf(activated[0]));
});

test('missing required unit templates prevent all activation of a partial render', t => {
  const f = fixture(t);
  unlinkSync(join(f.templates, 'openclaw-mission-control.service'));
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(readFileSync(f.actions, 'utf8'), /--user (?:start|restart|enable|daemon-reload)(?: |\n)/);
});

test('persistent masks survive update without rendering through or activating the mask', t => {
  const f = fixture(t, { masked: true }), result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readlinkSync(join(f.dest, 'openclaw-mission-control.service')), '/dev/null');
  assert.doesNotMatch(readFileSync(f.actions, 'utf8'), /--user (?:enable|start|restart) openclaw-mission-control/);
});
