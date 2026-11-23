/**
 * session-recap-floor.test.mjs — session-recap kept a bare 50KB floor after
 * repair 4.6 moved the memory daemon to 1KB, so short real sessions never got
 * a recap and `--previous` could pick a different session than the daemon's
 * subagent-audit. Both now read MIN_SESSION_BYTES from lib/session-floor.js.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { MIN_SESSION_BYTES } = createRequire(import.meta.url)('../lib/session-floor.js');
const home = mkdtempSync(join(tmpdir(), 'session-recap-floor-'));
after(() => rmSync(home, { recursive: true, force: true }));

const sessions = join(home, 'sessions');
const ws = join(home, 'ws');
mkdirSync(sessions);
mkdirSync(ws);
mkdirSync(join(home, '.openclaw/config'), { recursive: true });
writeFileSync(join(home, '.openclaw/config/transcript-sources.json'), JSON.stringify({ sources: [{ path: sessions }] }));

function session(name, marker, ageMin) {
  const lines = [];
  for (let i = 0; lines.join('\n').length < 2048; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    lines.push(JSON.stringify({ type: role, timestamp: '2026-11-17T00:00:00Z', message: { role, content: `${marker} turn ${i} about the plan` } }));
  }
  const p = join(sessions, `${name}.jsonl`);
  writeFileSync(p, lines.join('\n') + '\n');
  const t = Date.now() / 1000 - ageMin * 60;
  utimesSync(p, t, t);
}
session('aaaa1111', 'CURRENT', 1);
session('bbbb2222', 'PREV', 2);
session('cccc3333', 'THIRD', 3);
session('dddd4444', 'FOURTH', 4);
session('eeee5555', 'FIFTH', 5);
writeFileSync(join(sessions, 'ffff6666.jsonl'), '{"type":"session"}\n');

// The fixture is the default node root ~/.openclaw; an inherited OPENCLAW_HOME (CI exports one) would replace it.
const { OPENCLAW_HOME: _inheritedRoot, ...baseEnv } = process.env;
const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'workspace-bin/session-recap'), ...args], {
  encoding: 'utf8', env: { ...baseEnv, HOME: home, OPENCLAW_WORKSPACE: ws },
});

test('the floor is the daemon\'s 1KB, so short real sessions are candidates and header-only files are not', () => {
  assert.equal(MIN_SESSION_BYTES, 1024);
  const r = run('--list');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Found 5 JSONL transcripts/);
  assert.match(r.stdout, /\[0\] aaaa1111.*← current/);
  assert.doesNotMatch(r.stdout, /ffff6666/);
});

test('--previous digests the session before the current one', () => {
  const r = run('--previous');
  assert.equal(r.status, 0, r.stderr);
  const recap = readFileSync(join(ws, 'memory/last-session-recap.md'), 'utf8');
  assert.match(recap, /### Session bbbb2222/);
  assert.match(recap, /PREV turn/);
  assert.doesNotMatch(recap, /CURRENT turn/);
});

test('--all-recent digests the three sessions after the current one', () => {
  const r = run('--all-recent');
  assert.equal(r.status, 0, r.stderr);
  const digested = [...r.stdout.matchAll(/→ session (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(digested, ['bbbb2222', 'cccc3333', 'dddd4444']);
});
