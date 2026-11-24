/**
 * memory-daemon-phase0.test.mjs — the node-wide boot work (forced maintenance,
 * compile-boot --all, clawvault doctor, the transcript directory import) runs
 * for the boot that opens the node session, not again for every transcript
 * that appears beside a live one (plan ticks, several conversations). Each
 * boot still gets its own recap and clawvault wake.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { daemonFixture, recordingBin, transcript, runDaemon, calls, removeFixture } from './helpers/memory-daemon-harness.mjs';

function boot(othersLive) {
  const fx = daemonFixture();
  recordingBin(fx, 'memory-maintenance.mjs', 'memory-maintenance');
  fs.writeFileSync(path.join(fx.workspace, 'bin', 'compile-boot'),
    "import json, os, sys\nopen(os.environ['TEST_CALLS'], 'a').write(json.dumps({'bin': 'compile-boot', 'args': sys.argv[1:]}) + '\\n')\n");
  const previous = transcript(fx, 'aaaa1111', 3600);
  const booting = transcript(fx, 'bbbb2222', 5);
  runDaemon(fx, `await daemon.handleTransitions([{ from: 'ENDED', to: 'BOOT', sessionId: 'bbbb2222', jsonlPath: ${JSON.stringify(booting)}, othersLive: ${othersLive}, previousJsonl: ${JSON.stringify(previous)} }], config);`);
  const throttleFile = path.join(fx.workspace, '.tmp', 'daemon-throttle.json');
  const throttle = fs.existsSync(throttleFile) ? JSON.parse(fs.readFileSync(throttleFile, 'utf8')) : {};
  return { fx, previous, ran: calls(fx).map((c) => [c.bin, ...c.args]), throttle };
}

test('the boot that opens the node session runs the node-wide steps', () => {
  const { fx, previous, ran, throttle } = boot(false);
  try {
    assert.deepEqual(ran, [
      ['session-recap', '--file', previous],
      ['clawvault', 'wake'],
      ['memory-maintenance', '--force'],
      ['compile-boot', '--all'],
      ['clawvault', 'doctor', '--fix'],
    ]);
    assert.ok(throttle.lastMaintenance > 0);
    assert.ok(throttle.lastSessionImport > 0, 'the directory import ran and stamped its throttle');
  } finally {
    removeFixture(fx);
  }
});

test('a boot beside a live session runs only its own recap and wake', () => {
  const { fx, previous, ran, throttle } = boot(true);
  try {
    assert.deepEqual(ran, [
      ['session-recap', '--file', previous],
      ['clawvault', 'wake'],
    ]);
    assert.ok(!throttle.lastMaintenance, 'no forced maintenance');
    assert.ok(!throttle.lastSessionImport, 'no directory import (Phase 2 keeps the archive current)');
  } finally {
    removeFixture(fx);
  }
});
