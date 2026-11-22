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

function compileWithBudget(t, args) {
  const ws = mkdtempSync(join(tmpdir(), 'compile-boot-budget-'));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  mkdirSync(join(ws, 'bin'));
  mkdirSync(join(ws, '.boot'));
  copyFileSync(join(ROOT, 'workspace-bin', 'compile-boot'), join(ws, 'bin', 'compile-boot'));
  writeFileSync(join(ws, 'AGENTS.md'), `# T\n\n## A\n${'word '.repeat(200)}\n`);
  writeFileSync(join(ws, '.boot', 'manifest.yaml'), [
    'sections:', '  A: { priority: boot, profile: [main, lite, heartbeat, discord, worker], compile: verbatim }',
    'model_overrides:', '  openai: { max_boot_tokens: 50 }', '  claude: { max_boot_tokens: 100000 }', '',
  ].join('\n'));
  const env = { ...process.env, HOME: ws, OPENCLAW_MC_URL: 'http://127.0.0.1:9', OPENCLAW_MC_TOKEN_FILE: join(ws, 'none') };
  return spawnSync('python3', [join(ws, 'bin', 'compile-boot'), ...args], { env, encoding: 'utf8' });
}

describe('compile-boot max_boot_tokens', { skip: !HAVE_PY_YAML && 'python3 with PyYAML not available' }, () => {
  it('warns on stderr when a --model compile exceeds that model\'s budget, and still emits it', (t) => {
    const r = compileWithBudget(t, ['--profile', 'main', '--model', 'openai']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /word word/);
    assert.match(r.stderr, /WARNING main boot is ~\d+ tokens, over the openai max_boot_tokens of 50/);
  });

  it('warns per profile under --all', (t) => {
    const r = compileWithBudget(t, ['--all', '--model', 'openai']);
    assert.equal(r.status, 0, r.stderr);
    for (const p of ['main', 'lite', 'heartbeat', 'discord', 'worker']) assert.match(r.stderr, new RegExp(`WARNING ${p} boot`));
  });

  it('is silent within budget and without --model', (t) => {
    assert.doesNotMatch(compileWithBudget(t, ['--profile', 'main', '--model', 'claude']).stderr, /WARNING/);
    assert.doesNotMatch(compileWithBudget(t, ['--all']).stderr, /WARNING/);
  });
});

function compileWithLessons(t, { vaultPath }) {
  const ws = mkdtempSync(join(tmpdir(), 'compile-boot-lessons-'));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  mkdirSync(join(ws, 'bin'));
  mkdirSync(join(ws, '.boot'));
  copyFileSync(join(ROOT, 'workspace-bin', 'compile-boot'), join(ws, 'bin', 'compile-boot'));
  writeFileSync(join(ws, 'AGENTS.md'), '# T\n\n## A\nx\n');
  writeFileSync(join(ws, '.boot', 'manifest.yaml'), 'sections: {}\n');
  const meta = join(ws, vaultPath || 'projects/arcane-vault', '00-meta');
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, 'shared-lessons.md'), '---\ntitle: t\n---\n- [error] lesson one\n');
  const env = { ...process.env, HOME: ws, OPENCLAW_MC_URL: 'http://127.0.0.1:9', OPENCLAW_MC_TOKEN_FILE: join(ws, 'none') };
  delete env.OPENCLAW_OBSIDIAN_SYNC_CONFIG;
  if (vaultPath) {
    const cfg = join(ws, 'obsidian-sync.json');
    writeFileSync(cfg, JSON.stringify({ vaultPath }));
    env.OPENCLAW_OBSIDIAN_SYNC_CONFIG = cfg;
  }
  return spawnSync('python3', [join(ws, 'bin', 'compile-boot'), '--profile', 'main'], { env, encoding: 'utf8' });
}

describe('compile-boot shared lessons', { skip: !HAVE_PY_YAML && 'python3 with PyYAML not available' }, () => {
  it('reads shared-lessons.md under the vaultPath obsidian-sync writes it to', (t) => {
    const r = compileWithLessons(t, { vaultPath: 'vaults/x' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Shared Lessons \(cross-soul\)\n- \[error\] lesson one/);
  });

  it('falls back to projects/arcane-vault without an obsidian-sync config', (t) => {
    const r = compileWithLessons(t, { vaultPath: null });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## Shared Lessons \(cross-soul\)\n- \[error\] lesson one/);
  });
});

function compileShipped(t, profile) {
  const ws = mkdtempSync(join(tmpdir(), 'compile-boot-shipped-'));
  t.after(() => rmSync(ws, { recursive: true, force: true }));
  mkdirSync(join(ws, 'bin'));
  mkdirSync(join(ws, '.boot'));
  copyFileSync(join(ROOT, 'workspace-bin', 'compile-boot'), join(ws, 'bin', 'compile-boot'));
  copyFileSync(join(ROOT, 'identity', 'AGENTS.md'), join(ws, 'AGENTS.md'));
  copyFileSync(join(ROOT, 'boot', 'manifest.yaml'), join(ws, '.boot', 'manifest.yaml'));
  const env = { ...process.env, HOME: ws, OPENCLAW_MC_URL: 'http://127.0.0.1:9', OPENCLAW_MC_TOKEN_FILE: join(ws, 'none') };
  return spawnSync('python3', [join(ws, 'bin', 'compile-boot'), '--profile', profile], { env, encoding: 'utf8' });
}

describe('compile-boot structured rules follow identity/AGENTS.md', { skip: !HAVE_PY_YAML && 'python3 with PyYAML not available' }, () => {
  for (const profile of ['main', 'lite', 'discord']) {
    it(`${profile}: a finished task goes to waiting-user, and Mission Control is reached with its token`, (t) => {
      const r = compileShipped(t, profile);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /waiting-user/);
      assert.doesNotMatch(r.stdout, /status=done/);
      assert.doesNotMatch(r.stdout, /\] done\./);
      assert.doesNotMatch(r.stdout, /localhost:3000\/api/);
    });
  }

  it('the boot list reads the session recap, checks MC through mc-health and leaves the wake to the daemon', (t) => {
    const r = compileShipped(t, 'main');
    assert.equal(r.status, 0, r.stderr);
    const boot = r.stdout.match(/boot:\n[\s\S]*?\n  lazy:/)[0];
    assert.match(boot, /- memory\/last-session-recap\.md/);
    assert.match(boot, /node bin\/mc-health\.mjs/);
    assert.match(boot, /bin\/mc-api/);
    assert.doesNotMatch(boot, /clawvault-local wake/);
  });
});
