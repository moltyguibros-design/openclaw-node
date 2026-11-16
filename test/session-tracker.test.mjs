import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionTracker, STATES } from '../lib/session-tracker.mjs';

const daemonSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin/memory-daemon.mjs'), 'utf8');

const config = { intervals: { activeThresholdMs: 5 * 60_000, idleThresholdMs: 15 * 60_000 } };
const MIN = 60_000;
const seen = (...ids) => ({ activeSessions: ids.map(id => ({ sessionId: id, path: `/t/${id}.jsonl` })) });
const brief = (ts) => ts.map(t => `${t.sessionId}:${t.from}->${t.to}`);

test('two transcripts written at the same time boot once each and never flip each other to ENDED', () => {
  const tr = new SessionTracker(config);
  let now = 0;
  assert.deepEqual(brief(tr.tick(seen('a'), now)), ['a:ENDED->BOOT']);
  tr.completeBoot('a');
  now += MIN;
  assert.deepEqual(brief(tr.tick(seen('a', 'b'), now)), ['b:ENDED->BOOT']);
  tr.completeBoot('b');
  // The "newest file" alternating between a and b used to end one and boot
  // the other on every poll.
  for (let i = 0; i < 20; i++) {
    now += 30_000;
    assert.deepEqual(tr.tick(seen(i % 2 ? 'a' : 'b', 'a', 'b'), now), []);
  }
  assert.deepEqual(tr.sessions.map(s => [s.sessionId, s.state]), [['a', 'ACTIVE'], ['b', 'ACTIVE']]);
});

test('each session runs its own idle and end timers; only the last end releases shared state', () => {
  const tr = new SessionTracker(config);
  let now = 0;
  tr.tick(seen('a', 'b'), now);
  tr.completeBoot('a');
  tr.completeBoot('b');

  now += 6 * MIN;
  const idle = tr.tick(seen('b'), now);
  assert.deepEqual(brief(idle), ['a:ACTIVE->IDLE']);
  assert.equal(idle[0].jsonlPath, '/t/a.jsonl');
  assert.equal(tr.state, STATES.ACTIVE, 'the node stays ACTIVE while b is');

  now += 16 * MIN;
  const ended = tr.tick(seen('b'), now);
  assert.deepEqual(brief(ended), ['a:IDLE->ENDED']);
  assert.equal(ended[0].othersLive, true);

  now += 6 * MIN;
  assert.deepEqual(brief(tr.tick(seen(), now)), ['b:ACTIVE->IDLE']);
  now += 16 * MIN;
  const last = tr.tick(seen(), now);
  assert.deepEqual(brief(last), ['b:IDLE->ENDED']);
  assert.equal(last[0].othersLive, false);
  assert.equal(tr.state, STATES.ENDED);
});

test('an idle session written again goes back to ACTIVE, not through a new bootstrap', () => {
  const tr = new SessionTracker(config);
  tr.tick(seen('a'), 0);
  tr.completeBoot('a');
  tr.tick(seen(), 6 * MIN);
  assert.deepEqual(brief(tr.tick(seen('a'), 7 * MIN)), ['a:IDLE->ACTIVE']);
});

test('a session that boots beside a live one is told so (no MEMORY.md re-freeze)', () => {
  const tr = new SessionTracker(config);
  const [first] = tr.tick(seen('a'), 0);
  assert.equal(first.othersLive, false);
  tr.completeBoot('a');
  const [second] = tr.tick(seen('a', 'b'), MIN);
  assert.equal(second.othersLive, true);
});

test('restore reads the per-session list and the legacy single-session form', () => {
  const tr = new SessionTracker(config);
  tr.tick(seen('a', 'b'), 0);
  tr.completeBoot('a');
  const copy = new SessionTracker(config);
  copy.restore(JSON.parse(JSON.stringify(tr.toJSON())));
  assert.deepEqual(copy.sessions.map(s => [s.sessionId, s.state]), [['a', 'ACTIVE'], ['b', 'BOOT']]);

  const legacy = new SessionTracker(config);
  legacy.restore({ state: 'IDLE', sessionId: 'x', lastActivityTime: 5 });
  assert.deepEqual(legacy.sessions.map(s => [s.sessionId, s.state]), [['x', 'IDLE']]);
  legacy.restore({ state: 'ENDED', sessionId: 'x', sessions: [{ sessionId: 'x', state: 'IDLE' }] });
  assert.deepEqual(legacy.sessions, []);
});

test('the daemon drives the per-session tracker and completes every finished boot', () => {
  assert.match(daemonSrc, /const sm = new SessionTracker\(config\);/);
  assert.doesNotMatch(daemonSrc, /class SessionStateMachine/);
  assert.match(daemonSrc, /for \(const sessionId of booted\) sm\.completeBoot\(sessionId\);/);
  const idleBranch = daemonSrc.match(/if \(t\.from === STATES\.ACTIVE && t\.to === STATES\.IDLE\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(idleBranch, /findJsonlBySessionId\(sources, t\.sessionId\)/, 'the idle flush reads the idling session, not the newest file');
  const endBranch = daemonSrc.match(/if \(t\.from === STATES\.IDLE && t\.to === STATES\.ENDED\) \{[\s\S]*?\n    \}\n/)[0];
  assert.match(endBranch, /memoryBudget && !t\.othersLive/);
  assert.match(endBranch, /traceEmitter\.forget\(t\.jsonlPath\)/);
  assert.doesNotMatch(daemonSrc, /traceEmitter\.reset\(\)/);
});
