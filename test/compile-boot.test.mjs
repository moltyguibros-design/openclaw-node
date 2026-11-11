/**
 * compile-boot.test.mjs — the boot entity block comes from Mission Control,
 * which denies every /api method without its session token (review C-4).
 * compile-boot sent no token and swallowed the 401, so main/lite boot profiles
 * silently never carried the entity block.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HAVE_PY_YAML = spawnSync('python3', ['-c', 'import yaml']).status === 0;
const TOKEN = 'tok123';

async function compileMain(t, { withToken }) {
  const root = mkdtempSync(join(tmpdir(), 'compile-boot-'));
  const ws = join(root, 'ws');
  mkdirSync(join(ws, 'bin'), { recursive: true });
  mkdirSync(join(ws, '.boot'));
  copyFileSync(join(ROOT, 'workspace-bin', 'compile-boot'), join(ws, 'bin', 'compile-boot'));
  writeFileSync(join(ws, 'AGENTS.md'), '# T\n\n## A\nx\n');
  writeFileSync(join(ws, '.boot', 'manifest.yaml'), 'sections: {}\n');
  const tokenFile = join(root, 'token');
  if (withToken) writeFileSync(tokenFile, TOKEN, { mode: 0o600 });

  const seen = { authorization: undefined };
  const server = http.createServer((req, res) => {
    seen.authorization = req.headers.authorization;
    const ok = req.headers.authorization === `Bearer ${TOKEN}`;
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { block: '## ENTITY-MARKER' } : { error: 'token' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });

  const env = { ...process.env, HOME: root, OPENCLAW_MC_URL: `http://127.0.0.1:${server.address().port}`,
    OPENCLAW_MC_TOKEN_FILE: tokenFile };
  delete env.http_proxy;
  delete env.HTTP_PROXY;
  const child = spawn('python3', [join(ws, 'bin', 'compile-boot'), '--profile', 'main'], { env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const code = await new Promise(resolve => child.on('close', resolve));
  return { code, stdout, stderr, authorization: seen.authorization };
}

describe('compile-boot entity block', { skip: !HAVE_PY_YAML && 'python3 with PyYAML not available' }, () => {
  it('sends the MC session token and injects the block into the main profile', async (t) => {
    const r = await compileMain(t, { withToken: true });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.authorization, `Bearer ${TOKEN}`);
    assert.match(r.stdout, /ENTITY-MARKER/);
  });

  it('reports a skipped block on stderr instead of failing silently', async (t) => {
    const r = await compileMain(t, { withToken: false });
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /ENTITY-MARKER/);
    assert.match(r.stderr, /entity block skipped/);
  });
});
