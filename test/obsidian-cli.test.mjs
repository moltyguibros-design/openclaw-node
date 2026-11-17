import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'workspace-bin', 'obsidian');

// Fake curl mirrors real curl's exit codes for an HTTP 4xx: 22 with --fail/-f, 0 without.
function fakeBin(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'curl'), [
    '#!/usr/bin/env bash',
    'printf "%s\\n" "$@" >> "$FAKE_LOG"',
    'for a in "$@"; do',
    '  if [ "$a" = "-f" ] && [ "${FAKE_HTTP_ERROR:-}" = 1 ]; then exit 22; fi',
    'done',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'open'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$OPEN_LOG"\n', { mode: 0o755 });
  const env = {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, OBSIDIAN_API_KEY: 'k',
    FAKE_LOG: path.join(dir, 'curl.log'), OPEN_LOG: path.join(dir, 'open.log'),
  };
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  return { env, curlArgs: () => read(env.FAKE_LOG).split('\n'), openLog: () => read(env.OPEN_LOG) };
}

test('search sends the query URL-encoded as ?query=, which is the only place Local REST API reads it', (t) => {
  const { env, curlArgs } = fakeBin(t);
  const query = 'say "hi" & more';
  const r = spawnSync('bash', [CLI, 'search', query], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const args = curlArgs();
  assert.ok(args.includes('-G'), args.join(' '));
  assert.ok(args.includes('--data-urlencode'), args.join(' '));
  assert.ok(args.includes(`query=${query}`), args.join(' '));
  assert.ok(!args.includes('-d'), 'no JSON body: the plugin ignores it');
});

test('open falls back to the obsidian:// URI when the API answers with an HTTP error', (t) => {
  const { env, openLog } = fakeBin(t);
  const r = spawnSync('bash', [CLI, 'open', 'notes/a.md'], { env: { ...env, FAKE_HTTP_ERROR: '1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Opened via URI: notes\/a\.md/);
  assert.equal(openLog().trim(), 'obsidian://open?vault=arcane-vault&file=notes/a.md');
});
