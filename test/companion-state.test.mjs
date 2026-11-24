// The companion file used to say `status: active` forever: a clean session end
// read as a crash to every next session, started_at kept the first install's
// time, and every tick logged "Companion state updated".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCompanionState } from '../lib/companion-state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const daemonSrc = read('workspace-bin/memory-daemon.mjs');
const tasks = { runningTasks: 'Standing by', runningCount: 0, doneCount: 2 };
const field = (text, key) => text.match(new RegExp(`^${key}: (.+)$`, 'm'))[1];

test('the companion file carries the real state and keeps started_at for one session', () => {
  let file = renderCompanionState('', { status: 'active', newSession: true, now: 'T1', ...tasks });
  assert.equal(field(file, 'status'), 'active');
  assert.equal(field(file, 'started_at'), 'T1');
  file = renderCompanionState(file, { status: 'idle', now: 'T2', ...tasks });
  assert.equal(field(file, 'status'), 'idle');
  assert.equal(field(file, 'started_at'), 'T1');
  assert.equal(field(file, 'last_flush'), 'T2');
  file = renderCompanionState(file, { status: 'ended', now: 'T3', ...tasks });
  assert.equal(field(file, 'status'), 'ended');
  assert.equal(field(file, 'started_at'), 'T1');
  file = renderCompanionState(file, { status: 'active', newSession: true, now: 'T4', ...tasks });
  assert.equal(field(file, 'started_at'), 'T4', 'a new session gets its own start time');
});

test('the daemon writes active/idle per tick, ended after the end pipeline, and resets on a fresh boot', () => {
  assert.doesNotMatch(daemonSrc, /^status: active$/m);
  assert.doesNotMatch(daemonSrc, /Companion state updated/);
  assert.match(daemonSrc, /runPhase1StatusSync\(config, sm\.state === STATES\.ACTIVE \? 'active' : 'idle'\)/);
  const bootBranch = daemonSrc.match(/if \(t\.from === STATES\.ENDED && t\.to === STATES\.BOOT\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(bootBranch, /if \(!t\.othersLive\) runPhase1StatusSync\(config, 'active', \{ newSession: true \}\);/);
  const endBranch = daemonSrc.match(/if \(t\.from === STATES\.IDLE && t\.to === STATES\.ENDED\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(endBranch, /if \(!t\.othersLive\) runPhase1StatusSync\(config, 'ended'\);\n    \}\n$/);
  const phase1 = daemonSrc.match(/function runPhase1StatusSync[\s\S]*?\n\}\n/)[0];
  assert.equal(phase1.match(/readFileSync\(companion/g).length, 1, 'the companion file is read once per sync');
});

// The installer seeded a `.companion-state.md` saying `status: inactive` that nothing
// ever rewrote, and the boot rules read it, so the crash check could never fire.
test('no installer seed for .companion-state.md; every boot reader names the daemon file', () => {
  assert.doesNotMatch(read('scripts/install/components.sh'), /companion-state/);
  for (const rel of ['identity/AGENTS.md', 'identity/CLAUDE.md', 'identity/MEMORY_SPEC.md', 'config/harness-rules.json',
    'workspace-bin/compile-boot', 'config/obsidian-sync.json.template', 'docs/ARCHITECTURE.md']) {
    assert.doesNotMatch(read(rel), /\.companion-state\.md/, rel);
  }
  for (const rel of ['identity/AGENTS.md', 'identity/MEMORY_SPEC.md', 'config/harness-rules.json', 'workspace-bin/compile-boot']) {
    assert.match(read(rel), /\.daemon-state-/, rel);
  }
  for (const rel of ['identity/AGENTS.md', 'identity/CLAUDE.md', 'workspace-bin/compile-boot']) {
    assert.doesNotMatch(read(rel), /Live Session banner|also_update/, `${rel}: only the daemon writes the state file`);
  }
});
