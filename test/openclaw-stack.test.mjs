import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {
  scanLaunchdUnits, scanSystemdUnits, upLinux, probePort, classify, statusTable, shortId, PORTS, PERIODIC,
} from '../bin/openclaw-stack.mjs';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('unit discovery', () => {
  it('scans ai.openclaw plists, flags .disabled, ignores foreign files', () => {
    for (const f of [
      'ai.openclaw.nats.plist',
      'ai.openclaw.mesh-agent.plist.disabled',
      'com.apple.something.plist',
      'ai.openclaw.memory-daemon.plist.bak-2026-05-28',
    ]) fs.writeFileSync(path.join(tmp, f), 'x');
    const units = scanLaunchdUnits(tmp);
    assert.deepEqual(units.map(u => [u.id, u.disabled]), [
      ['mesh-agent', true],
      ['nats', false],
    ]);
  });
  it('parses systemd list-unit-files output; masked = disabled', () => {
    const exec = () => 'openclaw-mission-control.service enabled\nopenclaw-mesh-agent.service masked\nopenclaw-log-rotate.timer enabled\n';
    const units = scanSystemdUnits(exec);
    assert.deepEqual(units.map(u => [u.id, u.disabled]), [
      ['mission-control', false], ['mesh-agent', true], ['log-rotate', false],
    ]);
  });
  it('shortId strips both platform prefixes', () => {
    assert.equal(shortId('ai.openclaw.workplan-viewer.plist'), 'workplan-viewer');
    assert.equal(shortId('openclaw-node-watch.service'), 'node-watch');
  });
  it('starts only enabled units and timer handles, preserving disabled/static and timer-backed services', () => {
    const listing = [
      'openclaw-mission-control.service enabled', 'openclaw-nats-1.service disabled',
      'openclaw-gateway.service disabled', 'openclaw-log-rotate.service enabled',
      'openclaw-log-rotate.timer enabled', 'openclaw-observer.service static',
    ].join('\n');
    const units = scanSystemdUnits(() => listing);
    const started = [];
    upLinux(units, (_cmd, args) => {
      if (args[1] === 'is-active') return 'inactive';
      if (args[1] === 'start') started.push(args[2]);
      return '';
    });
    assert.deepEqual(started, ['openclaw-mission-control.service', 'openclaw-log-rotate.timer']);
  });
});

describe('probePort', () => {
  it('true for a listening port, false for a closed one', async () => {
    const srv = net.createServer().listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    const port = srv.address().port;
    assert.equal(await probePort(port), true);
    srv.close();
    await new Promise(r => srv.once('close', r));
    assert.equal(await probePort(port), false);
  });
});

describe('classify — the honesty rules', () => {
  it('disabled units are DISABLED, never resurrected as startable', () => {
    assert.equal(classify({ id: 'mesh-agent', disabled: true }, { loaded: false }), 'DISABLED');
  });
  it('port units: LIVE only on an open port; loaded-but-closed is DOWN', () => {
    assert.equal(classify({ id: 'nats' }, { loaded: true, pid: 1, portOk: true }), 'LIVE');
    assert.equal(classify({ id: 'nats' }, { loaded: true, pid: 1, portOk: false }), 'DOWN');
    assert.equal(classify({ id: 'nats' }, { loaded: false, portOk: false }), 'OFF');
  });
  it('periodic units are healthy while LOADED without a pid; daemons are not', () => {
    assert.equal(classify({ id: 'observer' }, { loaded: true, pid: null }), 'LOADED');
    assert.equal(classify({ id: 'gateway' }, { loaded: true, pid: null }), 'DOWN');
    assert.equal(classify({ id: 'gateway' }, { loaded: true, pid: 42 }), 'LIVE');
  });
  it('enabled units that failed or are restarting cannot read OFF or healthy', () => {
    assert.equal(classify({ id: 'mission-control' }, { loaded: true, active: 'failed', pid: null, portOk: false, lastExitCode: 1 }), 'UNSTABLE');
    assert.equal(classify({ id: 'memory-daemon' }, { loaded: true, active: 'activating', pid: null, restarts: 2 }), 'UNSTABLE');
    assert.equal(classify({ id: 'mesh-agent' }, { loaded: true, active: 'inactive', pid: null }), 'OFF');
    assert.equal(classify({ id: 'log-rotate', timer: true }, { loaded: true, active: 'active', pid: null }), 'LOADED');
  });
  it('every port id and periodic id uses the canonical short form', () => {
    for (const id of [...Object.keys(PORTS), ...PERIODIC]) {
      assert.equal(id, shortId(`ai.openclaw.${id}.plist`));
    }
  });
  it('an unrelated listening port cannot make a stopped unit live, and automatic restarts are visible', () => {
    assert.equal(classify({ id: 'mission-control' }, { loaded: false, pid: null, portOk: true }), 'OFF');
    assert.equal(classify({ id: 'mission-control' }, { loaded: true, pid: 42, portOk: true, restarts: 3 }), 'UNSTABLE');
  });
});

it('actual manager results distinguish intentional signals, failed units, pending restarts and invalid unit files', async () => {
  for (const [active, sub, restarts, code, status, result, load, expected] of [
    ['failed', 'failed', 0, 1, 1, 'exit-code', 'loaded', 'UNSTABLE'],
    ['failed', 'failed', 0, 0, 0, 'success', 'loaded', 'DOWN'],
    ['activating', 'auto-restart', 3, 1, 1, 'exit-code', 'loaded', 'UNSTABLE'],
    ['activating', 'start', 0, 0, 0, 'success', 'loaded', 'UNSTABLE'],
    ['deactivating', 'stop', 0, 0, 0, 'success', 'loaded', 'UNSTABLE'],
    ['inactive', 'dead', 0, 2, 15, 'success', 'loaded', 'OFF'],
    ['inactive', 'dead', 0, 2, 15, 'signal', 'loaded', 'UNSTABLE'],
    ['inactive', 'dead', 0, 2, 9, 'oom-kill', 'loaded', 'UNSTABLE'],
    ['inactive', 'dead', 0, 0, 0, 'success', 'bad-setting', 'DOWN'],
    ['inactive', 'dead', 0, 0, 0, 'success', 'error', 'DOWN'],
    ['inactive', 'dead', 0, 0, 0, 'success', 'not-found', 'DOWN'],
  ]) {
    const rows = await statusTable([{ id: 'memory-daemon', label: 'openclaw-memory-daemon.service', disabled: false }], {
      platform: 'linux', probe: async () => false,
      exec: () => `Id=openclaw-memory-daemon.service\nLoadState=${load}\nActiveState=${active}\nSubState=${sub}\nMainPID=0\nNRestarts=${restarts}\nExecMainCode=${code}\nExecMainStatus=${status}\nResult=${result}\nUnitFileState=enabled\n`,
    });
    assert.equal(rows[0].status, expected, `${active}/${sub}/${result}/${load}`);
    assert.equal(['DOWN', 'UNSTABLE', 'UNKNOWN'].includes(rows[0].status), expected !== 'OFF');
  }
});
