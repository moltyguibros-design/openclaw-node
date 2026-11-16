import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const daemonSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin/memory-daemon.mjs'), 'utf8');

test('an OPENCLAW_SHARED config mismatch exits the daemon only when federation is on', () => {
  const block = daemonSrc.match(/await ensureSharedStream\(natsConn\);[\s\S]*?\} catch \(streamErr\)/)[0];
  const mismatch = block.match(/if \(!verification\.valid\) \{[\s\S]*?\n      \} else \{/)[0];
  const exits = mismatch.match(/process\.exit\(1\)/g) || [];
  assert.equal(exits.length, 1);
  const gate = mismatch.match(/if \(process\.env\.OPENCLAW_FEDERATION === '1'\) \{[\s\S]*?\n        \}/);
  assert.ok(gate, 'the fatal exit must sit behind the federation opt-in');
  assert.match(gate[0], /process\.exit\(1\)/);
  assert.match(mismatch, /WARNING: Shared stream config mismatch: \$\{reasons\} — federation is off, continuing/);
});

test('the federation banner no longer claims nothing federation-related runs when it is off', () => {
  assert.match(daemonSrc, /One federation piece is outside it: initNatsSubsystems ensures the\n\/\/ OPENCLAW_SHARED stream on every node/);
});
