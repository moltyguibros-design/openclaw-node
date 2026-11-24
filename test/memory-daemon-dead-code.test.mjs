/**
 * memory-daemon-dead-code.test.mjs — every core-NATS subject the memory daemon
 * subscribes to has a producer in the repo, and the event-schema producer
 * notes name the real producers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('every literal subject the daemon subscribes to is published somewhere else', () => {
  const daemon = read('workspace-bin/memory-daemon.mjs');
  const subjects = [...daemon.matchAll(/natsConn\.subscribe\('([^']+)'\)/g)].map((m) => m[1]);
  const files = execFileSync('git', ['ls-files', '--', 'lib', 'bin', 'workspace-bin', 'hooks'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && f !== 'workspace-bin/memory-daemon.mjs' && /\.(m?js|cjs)$/.test(f));
  for (const subject of subjects) {
    const produced = files.some((f) => read(f).split('\n').some((line) => line.includes(subject) && /\b(publish|request)\(/.test(line)));
    assert.ok(produced, `${subject} has a subscriber and no producer`);
  }
});

test('the memory event-schema producer notes name the real producers', () => {
  assert.doesNotMatch(read('packages/event-schemas/src/memory/compaction-triggered.ts'), /mesh\.memory\.compaction_completed/);
  assert.match(read('packages/event-schemas/src/memory/session-started.ts'), /PRODUCER STATUS: lib\/memory-budget\.mjs/);
});
