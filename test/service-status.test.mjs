/**
 * service-status.test.mjs — mesh-health-publisher must report a dead service
 * as 'down', the only word (with 'error') Mission Control's degraded check
 * reads. It used to publish 'idle' for a loaded launchd job with no PID and
 * 'unknown' for any systemd unit that was not active, so no remote node ever
 * turned degraded.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { launchdServiceStatus, systemdServiceStatus } = require('../lib/service-status.js');

const mcDegraded = (s) => s.status === 'down' || s.status === 'error';

describe('service status vocabulary', () => {
  it('launchd: running → active, loaded without a PID → down, not loaded → not-found', () => {
    assert.deepEqual(launchdServiceStatus('{\n\t"PID" = 4242;\n\t"Label" = "ai.openclaw.gateway";\n};'), { status: 'active', pid: 4242 });
    const dead = launchdServiceStatus('{\n\t"LastExitStatus" = 256;\n\t"Label" = "ai.openclaw.gateway";\n};');
    assert.equal(dead.status, 'down');
    assert.ok(mcDegraded(dead));
    assert.deepEqual(launchdServiceStatus(null), { status: 'not-found' });
    assert.ok(!mcDegraded(launchdServiceStatus(null)));
  });

  it('systemd: failed, inactive and crash-looping units are down; a missing unit is not-found', () => {
    assert.deepEqual(systemdServiceStatus('LoadState=loaded\nActiveState=active\nMainPID=812'), { status: 'active', pid: 812 });
    for (const state of ['failed', 'inactive', 'activating']) {
      const s = systemdServiceStatus(`LoadState=loaded\nActiveState=${state}\nMainPID=0`);
      assert.deepEqual(s, { status: 'down', pid: undefined }, state);
      assert.ok(mcDegraded(s), state);
    }
    assert.deepEqual(systemdServiceStatus('LoadState=not-found\nActiveState=inactive\nMainPID=0'), { status: 'not-found' });
    assert.deepEqual(systemdServiceStatus(null), { status: 'unknown' });
  });

  it('the publisher uses the shared vocabulary and never `systemctl is-active`', () => {
    const src = readFileSync(join(ROOT, 'bin', 'mesh-health-publisher.js'), 'utf8');
    assert.match(src, /require\('\.\.\/lib\/service-status'\)/);
    assert.doesNotMatch(src, /is-active/);
    assert.doesNotMatch(src, /\? "active" : "idle"/);
  });
});
