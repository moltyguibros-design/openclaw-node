/**
 * mc-api-base.test.mjs — Mission Control's address had three names (MC_URL,
 * OPENCLAW_MC_TICK_URL, OPENCLAW_MC_URL) plus hardcoded :3000 probes, and
 * OPENCLAW_MC_URL was both the base of notification links (which may point at a
 * tailnet address) and the target mc-api sent the session token to. Every call
 * that carries the token now goes through mcApiBase() (OPENCLAW_MC_API_URL,
 * loopback only); OPENCLAW_MC_URL is only a link base.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcApiBase } from '../lib/mc-session-token.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('mcApiBase defaults to 127.0.0.1:3000 and follows OPENCLAW_MC_API_URL on loopback', () => {
  assert.equal(mcApiBase({}), 'http://127.0.0.1:3000');
  assert.equal(mcApiBase({ OPENCLAW_MC_API_URL: 'http://127.0.0.1:3100/' }), 'http://127.0.0.1:3100');
  assert.equal(mcApiBase({ OPENCLAW_MC_API_URL: 'http://localhost:4000' }), 'http://localhost:4000');
  assert.equal(mcApiBase({ OPENCLAW_MC_URL: 'http://100.64.0.1:3000' }), 'http://127.0.0.1:3000', 'the link base never moves token calls');
});

test('mcApiBase refuses any address the session token must not be sent to', () => {
  for (const bad of ['http://evil:3000', 'http://100.64.0.1:3000', 'https://127.0.0.1:3000', 'http://user:pw@127.0.0.1:3000', 'http://u@localhost:3000', 'http://[::1]:3000', 'not a url']) {
    assert.throws(() => mcApiBase({ OPENCLAW_MC_API_URL: bad }), /OPENCLAW_MC_API_URL/, bad);
  }
});

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

test('no caller that sends the session token reads MC_URL, OPENCLAW_MC_URL, OPENCLAW_MC_TICK_URL or a literal :3000', () => {
  const offenders = [];
  const callers = [];
  for (const dir of ['bin', 'lib', 'workspace-bin']) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file);
      const src = readFileSync(file, 'utf8');
      if (rel === 'lib/mc-session-token.mjs' || !/mc-session-token|mcAuthHeaders/.test(src)) continue;
      callers.push(rel);
      if (/\bMC_URL\b|environ\.get\("MC_URL|OPENCLAW_MC_URL|OPENCLAW_MC_TICK_URL/.test(src)) offenders.push(rel);
      // compile-boot is Python and carries mcApiBase's rule and default itself.
      else if (rel === 'workspace-bin/compile-boot') { if (!/OPENCLAW_MC_API_URL/.test(src)) offenders.push(rel); }
      else if (/:3000\b/.test(src)) offenders.push(rel);
    }
  }
  for (const expected of ['workspace-bin/memory-maintenance.mjs', 'workspace-bin/mc-health.mjs', 'lib/node-watch.mjs', 'bin/scheduler-heartbeat.mjs', 'workspace-bin/mc-api', 'workspace-bin/compile-boot']) {
    assert.ok(callers.includes(expected), `${expected} is a token caller`);
  }
  assert.deepEqual(offenders, [], `token callers outside mcApiBase:\n  ${offenders.join('\n  ')}`);
});

test('notification links keep following OPENCLAW_MC_URL, including openclaw-notify --test', () => {
  const notify = readFileSync(join(ROOT, 'bin/openclaw-notify.mjs'), 'utf8');
  assert.doesNotMatch(notify, /'http:\/\/127\.0\.0\.1:3000\/notifications'/);
  assert.match(notify, /process\.env\.OPENCLAW_MC_URL/);
  assert.doesNotMatch(notify, /OPENCLAW_MC_API_URL/);
});
