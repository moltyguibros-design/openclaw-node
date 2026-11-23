import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {
  scanLaunchdUnits, scanSystemdUnits, probePort, classify, shortId, PORTS, PERIODIC,
  selectUnitsToStart, readNatsCohort, summarize,
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
  it('marks the oneshot .service behind a timer as its job, not a unit to start or report', () => {
    const exec = () => 'openclaw-observer.service static\nopenclaw-observer.timer enabled\nopenclaw-node-watch.service enabled\n';
    assert.deepEqual(scanSystemdUnits(exec).map(u => [u.label, u.timerJob]), [
      ['openclaw-observer.service', true], ['openclaw-observer.timer', false], ['openclaw-node-watch.service', false],
    ]);
  });
  it('shortId strips both platform prefixes', () => {
    assert.equal(shortId('ai.openclaw.workplan-viewer.plist'), 'workplan-viewer');
    assert.equal(shortId('openclaw-node-watch.service'), 'node-watch');
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
  it('every port id and periodic id uses the canonical short form', () => {
    for (const id of [...Object.keys(PORTS), ...PERIODIC]) {
      assert.equal(id, shortId(`ai.openclaw.${id}.plist`));
    }
  });
});

describe('selectUnitsToStart — up starts what the installer starts', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../services/service-manifest.json', import.meta.url), 'utf8'));
  const installed = [
    'nats', 'nats-1', 'nats-2', 'nats-3', 'gateway', 'mesh-agent', 'mesh-tool-discord',
    'memory-daemon', 'mission-control', 'node-watch', 'observer',
  ];
  const leftOff = new Set(['gateway', 'mesh-agent', 'mesh-tool-discord', 'nats-1', 'nats-2', 'nats-3']);
  const macUnits = () => {
    for (const id of installed) fs.writeFileSync(path.join(tmp, `ai.openclaw.${id}.plist`), 'x');
    return scanLaunchdUnits(tmp);
  };
  const linuxUnits = () => scanSystemdUnits(() => installed.flatMap((id) => (id === 'observer'
    ? ['openclaw-observer.service static', 'openclaw-observer.timer enabled']
    : [`openclaw-${id}.service ${leftOff.has(id) ? 'disabled' : 'enabled'}`])).join('\n'));
  const ids = (units) => [...new Set(units.map((u) => u.id))].sort();

  for (const [platform, scan] of [['darwin', macUnits], ['linux', linuxUnits]]) {
    it(`${platform}: autostart:true units plus the single bus when no cohort is declared`, () => {
      assert.deepEqual(ids(selectUnitsToStart(scan(), manifest, null)),
        ['memory-daemon', 'mission-control', 'nats', 'node-watch', 'observer']);
    });
    it(`${platform}: a three-copy cohort starts nats-1..3 and not the single bus`, () => {
      const cohort = ['ai.openclaw.nats-1', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'];
      assert.deepEqual(ids(selectUnitsToStart(scan(), manifest, cohort)),
        ['memory-daemon', 'mission-control', 'nats-1', 'nats-2', 'nats-3', 'node-watch', 'observer']);
    });
  }

  it('readNatsCohort returns the declared labels, or null when the file is absent', () => {
    assert.equal(readNatsCohort(tmp), null);
    fs.mkdirSync(path.join(tmp, 'config'));
    fs.writeFileSync(path.join(tmp, 'config', 'nats-writer-cohort.json'),
      JSON.stringify({ schema: 1, activeLabels: ['ai.openclaw.nats'] }));
    assert.deepEqual(readNatsCohort(tmp), ['ai.openclaw.nats']);
  });

  it('summarize does not list units left off on purpose as not running', () => {
    const rows = [
      { id: 'nats', status: 'LIVE' },
      { id: 'memory-daemon', status: 'OFF' },
      { id: 'gateway', status: 'OFF', manual: true },
      { id: 'nats-1', status: 'OFF', manual: true },
      { id: 'mesh-agent', status: 'LIVE', manual: true },
    ];
    assert.deepEqual(summarize(rows), { live: 2, total: 3, bad: ['memory-daemon'] });
  });
});
