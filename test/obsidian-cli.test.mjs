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
  for (const opener of ['open', 'xdg-open']) {
    fs.writeFileSync(path.join(dir, opener), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" >> "$OPEN_LOG"\n', { mode: 0o755 });
  }
  const env = {
    ...process.env, PATH: `${dir}:${process.env.PATH}`, OBSIDIAN_API_KEY: 'k',
    FAKE_LOG: path.join(dir, 'curl.log'), OPEN_LOG: path.join(dir, 'open.log'),
    OPENCLAW_OBSIDIAN_SYNC_CONFIG: path.join(dir, 'no-config.json'),
  };
  delete env.OBSIDIAN_API_PORT;
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
  return { dir, env, curlArgs: () => read(env.FAKE_LOG).split('\n'), openLog: () => read(env.OPEN_LOG) };
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

test('open uses the configured vault and API port, and falls back to the obsidian:// path URI on an HTTP error', (t) => {
  const { dir, env, curlArgs, openLog } = fakeBin(t);
  const vault = path.join(dir, 'my vault');
  const config = path.join(dir, 'obsidian-sync.json');
  fs.writeFileSync(config, JSON.stringify({ vaultPath: vault, apiPort: 28000 }));
  const r = spawnSync('bash', [CLI, 'open', 'notes/a.md'], {
    env: { ...env, OPENCLAW_OBSIDIAN_SYNC_CONFIG: config, FAKE_HTTP_ERROR: '1' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Opened via URI: notes\/a\.md/);
  assert.ok(curlArgs().includes('https://127.0.0.1:28000/open/notes/a.md'), curlArgs().join(' '));
  const quoted = `${vault}/notes/a.md`.split('/').map(encodeURIComponent).join('/');
  assert.equal(openLog().trim(), `obsidian://open?path=${quoted}`);

  spawnSync('bash', [CLI, 'status'], {
    env: { ...env, OPENCLAW_OBSIDIAN_SYNC_CONFIG: config, OBSIDIAN_API_PORT: '29000' }, encoding: 'utf8',
  });
  assert.ok(curlArgs().includes('https://127.0.0.1:29000/'), 'OBSIDIAN_API_PORT still overrides the config');
});
