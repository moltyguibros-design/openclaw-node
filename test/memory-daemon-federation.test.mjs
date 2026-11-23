/**
 * memory-daemon-federation.test.mjs — with OPENCLAW_FEDERATION=1 the daemon
 * used to start its own in-process consolidation scheduler beside the
 * openclaw-consolidation-scheduler timer every node runs: two cycles per 30
 * minutes on one state.db and vault, half of them without events. The timer
 * owns consolidation; the daemon only sends the federation broadcast on the
 * same cadence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const daemonSrc = fs.readFileSync(path.join(repo, 'workspace-bin/memory-daemon.mjs'), 'utf8');
const init = daemonSrc.match(/async function initFederationSubsystems\(nc\) \{[\s\S]*?\n\}\n/)[0];
const shutdown = daemonSrc.match(/const shutdown = async \(signal\) => \{[\s\S]*?\n  \};/)[0];

test('the daemon runs no consolidation scheduler of its own', () => {
  assert.doesNotMatch(daemonSrc, /createConsolidationScheduler/);
  assert.doesNotMatch(daemonSrc, /federationState\.scheduler/);
});

test('federation broadcasts consolidation on the timer cadence, and teardown clears that interval', () => {
  assert.match(init, /const \{ DEFAULT_INTERVAL_MS \} = await import\('\.\.\/bin\/consolidation-scheduler\.mjs'\);/);
  const timer = init.match(/federationState\.broadcastTimer = setInterval\(\(\) => \{[\s\S]*?\}, DEFAULT_INTERVAL_MS\);/);
  assert.ok(timer, 'the broadcast runs on consolidation-scheduler DEFAULT_INTERVAL_MS');
  assert.match(timer[0], /broadcastConsolidation\(\)/);
  assert.match(shutdown, /if \(federationState\.broadcastTimer\) clearInterval\(federationState\.broadcastTimer\);/);
});

test('NODE_SPEC names the timer as the one consolidation owner', () => {
  const spec = fs.readFileSync(path.join(repo, 'docs/NODE_SPEC.md'), 'utf8');
  const row = spec.split('\n').find((l) => l.startsWith('| openclaw-consolidation-scheduler |'));
  assert.match(row, /also with federation on/);
  const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /in-process consolidation scheduler/);
});
