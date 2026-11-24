/**
 * skill-moltbook.test.mjs — moltbook.sh interpolated title/content into a
 * hand-built JSON string, so a quote or newline broke the body and content
 * could inject extra keys. curl is stubbed to capture the -d payload.
 */
import { describe, it } from 'node:test';
import { tmpDir } from './helpers/tmp-dir.cjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'moltbook-interact', 'scripts', 'moltbook.sh');

function run(args) {
  const home = tmpDir('moltbook-');
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

describe('moltbook-interact docs run the shipped script', () => {
  const doc = (f) => readFileSync(join(ROOT, 'skills', 'moltbook-interact', f), 'utf8');

  it('SKILL.md runs moltbook.sh through bash {baseDir} and logs replies inside the workspace', () => {
    const skill = doc('SKILL.md');
    const calls = skill.split('\n').filter((l) => /moltbook\.sh /.test(l));
    assert.ok(calls.length >= 4);
    for (const l of calls) assert.match(l, /^bash \{baseDir\}\/scripts\/moltbook\.sh /, l);
    assert.doesNotMatch(skill, /\/workspace\//);
    assert.match(skill, /`memory\/moltbook-replies\.txt`/);
  });

  it('README commands name a script that ships', () => {
    const readme = doc('README.md');
    assert.doesNotMatch(readme, /\.\/scripts\/moltbook\.sh|scripts\/test\.sh|export PATH|scripts\/moltbook\b(?!\.sh)/);
    assert.match(readme, /^bash skills\/moltbook-interact\/scripts\/moltbook\.sh hot 5$/m);
  });

  it('moltbook.sh is committed executable like every other skill script', () => {
    const r = spawnSync('git', ['ls-files', '-s', 'skills/moltbook-interact/scripts/moltbook.sh'], { cwd: ROOT, encoding: 'utf8' });
    assert.match(r.stdout, /^100755 /);
  });
});
