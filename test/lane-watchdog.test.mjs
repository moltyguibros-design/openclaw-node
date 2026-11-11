import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

test('only bin/lane-watchdog.js exists: the units run that copy, a workspace-bin duplicate drifts', () => {
  assert.equal(fs.existsSync(path.join(REPO, 'workspace-bin', 'lane-watchdog.js')), false, 'the service-run copy is bin/lane-watchdog.js');
  assert.match(read('services/launchd/ai.openclaw.lane-watchdog.plist'), /openclaw\/bin\/lane-watchdog\.js/);
  assert.match(read('services/systemd/openclaw-lane-watchdog.service'), /openclaw\/bin\/lane-watchdog\.js/);
});

test('shutdown closes the fs.watch watchers instead of unwatchFile, which only stops fs.watchFile pollers', () => {
  const src = read('bin/lane-watchdog.js');
  assert.match(src, /fs\.watch\(filePath/);
  assert.doesNotMatch(src, /fs\.unwatchFile/);
  assert.match(src, /if \(logWatcher\) logWatcher\.close\(\);/);
  assert.match(src, /if \(errWatcher\) errWatcher\.close\(\);/);
});
