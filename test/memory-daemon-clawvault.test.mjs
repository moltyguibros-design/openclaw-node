/**
 * memory-daemon-clawvault.test.mjs — the daemon no longer runs ClawVault's
 * observe/reflect/archive cycle. clawvault observes agents/<id>/sessions/*.jsonl,
 * which current OpenClaw no longer writes (live transcripts are rows in
 * openclaw-agent.sqlite), so the cycle observed nothing while logging "done";
 * the daemon's own extraction is the session-compression path. Wake, doctor,
 * the idle checkpoint and the end-of-session sleep handoff stay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repo, daemonFixture, transcript, runDaemon, calls, removeFixture } from './helpers/memory-daemon-harness.mjs';

const CYCLE = new Set(['observe', 'reflect', 'archive']);

test('no transition and no Phase 2 pass runs clawvault observe, reflect or archive', () => {
  const fx = daemonFixture();
  try {
    const a = transcript(fx, 'aaaa1111', 30);
    runDaemon(fx, `
      await daemon.handleTransitions([{ from: 'ENDED', to: 'BOOT', sessionId: 'aaaa1111', jsonlPath: ${JSON.stringify(a)}, othersLive: false, previousJsonl: null }], config);
      await daemon.handleTransitions([{ from: 'ACTIVE', to: 'IDLE', sessionId: 'aaaa1111', jsonlPath: ${JSON.stringify(a)} }], config);
      await daemon.handleTransitions([{ from: 'IDLE', to: 'ENDED', sessionId: 'aaaa1111', jsonlPath: ${JSON.stringify(a)}, othersLive: true }], config);
      config.intervals.sessionRecapMs = 0;
      config.intervals.maintenanceMs = 0;
      await daemon.runPhase2ThrottledWork(config, []);
    `);
    const vault = calls(fx).filter((c) => c.bin === 'clawvault').map((c) => c.args);
    assert.deepEqual(vault.filter((args) => CYCLE.has(args[0])), []);
    assert.deepEqual(vault, [['wake'], ['doctor', '--fix'], ['checkpoint', '--working-on', 'idle'], ['sleep', 'session ended']]);
  } finally {
    removeFixture(fx);
  }
});

test('the throttle state and the architecture doc no longer carry the observe cycle', () => {
  const daemon = fs.readFileSync(path.join(repo, 'workspace-bin/memory-daemon.mjs'), 'utf8');
  assert.doesNotMatch(daemon, /lastClawvault(Observe|Reflect|Archive)/);
  const arch = fs.readFileSync(path.join(repo, 'docs/ARCHITECTURE.md'), 'utf8');
  assert.doesNotMatch(arch, /clawvault(-local)? (wake \+ )?(observe|reflect|archive)/i);
  assert.match(arch, /daemon's own extraction is the session-compression path/);
});
