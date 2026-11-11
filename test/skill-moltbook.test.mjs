/**
 * skill-moltbook.test.mjs — moltbook.sh interpolated title/content into a
 * hand-built JSON string, so a quote or newline broke the body and content
 * could inject extra keys. curl is stubbed to capture the -d payload.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'moltbook-interact', 'scripts', 'moltbook.sh');

function run(args) {
  const home = mkdtempSync(join(tmpdir(), 'moltbook-'));
  mkdirSync(join(home, '.config', 'moltbook'), { recursive: true });
  writeFileSync(join(home, '.config', 'moltbook', 'credentials.json'), JSON.stringify({ api_key: 'k' }));
  const stub = join(home, 'bin');
  mkdirSync(stub);
  const curl = join(stub, 'curl');
  writeFileSync(curl, '#!/bin/sh\nwhile [ $# -gt 0 ]; do [ "$1" = -d ] && printf %s "$2" > "$CAPTURE"; shift; done\necho \'{}\'\n');
  chmodSync(curl, 0o755);
  const capture = join(home, 'body.json');
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, CAPTURE: capture, PATH: `${stub}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(readFileSync(capture, 'utf8'));
}

describe('moltbook.sh request bodies', () => {
  it('reply encodes quotes and newlines', () => {
    assert.deepEqual(run(['reply', 'abc', 'he said "hi"\nbye']), { content: 'he said "hi"\nbye' });
  });

  it('create cannot be given extra keys through content', () => {
    const body = run(['create', 'T', 'x","k":"v']);
    assert.equal(body.title, 'T');
    assert.equal(body.content, 'x","k":"v');
    assert.ok(!('k' in body), JSON.stringify(body));
    assert.equal(body.submolt_id, '29beb7ee-ca7d-4290-9c2f-09926264866f');
  });
});
