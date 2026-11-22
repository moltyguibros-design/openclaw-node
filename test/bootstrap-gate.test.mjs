// bootstrap.sh's Linux path driven against stub binaries: the verification gate
// refused a --skip-llm box for lacking ollama (prereqs.sh already exempts it), and
// the source fetch used codeload's refs/heads/ path, so OPENCLAW_REF could only
// name a branch although it is documented as branch, tag or commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bootstrap-gate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin, join(dir, 'home')]);
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!${BASH}\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  stub('id', 'echo 0');
  stub('uname', '[ "$1" = -m ] && echo x86_64 || echo Linux');
  stub('python3', 'exit 0');
  stub('curl', `echo "$*" >> ${JSON.stringify(join(dir, 'curl.log'))}; exit 1`);
  for (const ok of ['apt-get', 'git', 'sqlite3', 'cc', 'jq', 'rsync', 'nats-server', 'tailscale', 'sh']) stub(ok, 'exit 0');
  for (const real of ['node', 'mkdir', 'rm', 'dirname', 'tar']) {
    const p = spawnSync('bash', ['-c', `command -v ${real}`], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(p, join(bin, real));
  }
  const run = (args, env = {}) => spawnSync(BASH, [join(ROOT, 'bootstrap.sh'), ...args], {
    encoding: 'utf8', timeout: 30_000,
    env: { PATH: bin, HOME: join(dir, 'home'), ...env },
  });
  return { run, bin, curlLog: () => (existsSync(join(dir, 'curl.log')) ? readFileSync(join(dir, 'curl.log'), 'utf8') : '') };
}

test('bootstrap gate passes a --skip-llm box without ollama and still refuses one that wants the LLM', (t) => {
  const { run } = sandbox(t);
  const skip = run(['--skip-llm'], { OPENCLAW_NO_INSTALL: '1' });
  assert.equal(skip.status, 0, skip.stdout + skip.stderr);
  assert.match(skip.stdout, /baseline complete/);
  assert.doesNotMatch(skip.stdout, /ollama — MISSING/);

  const full = run([], { OPENCLAW_NO_INSTALL: '1' });
  assert.equal(full.status, 1, full.stdout + full.stderr);
  assert.match(full.stdout, /ollama — MISSING/);
});

// install.sh runs rsync under set -e from Step 3 on; minimal Debian images ship without it.
test('bootstrap refuses a box without rsync before install.sh starts', (t) => {
  const { run, bin } = sandbox(t);
  rmSync(join(bin, 'rsync'));
  const r = run(['--skip-llm'], { OPENCLAW_NO_INSTALL: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /rsync — MISSING/);
});

test('bootstrap fetches OPENCLAW_REF by bare ref, so a tag or commit resolves', (t) => {
  const { run, curlLog } = sandbox(t);
  const r = run(['--skip-llm', '--role=worker'], { OPENCLAW_REF: 'v1.2.3' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /could not download/);
  const fetch = curlLog().split('\n').find((l) => l.includes('codeload.github.com'));
  assert.ok(fetch, curlLog());
  assert.match(fetch, /codeload\.github\.com\/[^/\s]+\/[^/\s]+\/tar\.gz\/v1\.2\.3(\s|$)/);
});

// install.sh refuses a first install without a role (no OS default); bootstrap
// says so before the dependency wave instead of after it.
test('bootstrap refuses up front when no node role is given or saved', (t) => {
  const { run, curlLog } = sandbox(t);
  const r = run(['--skip-llm']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /no node role: re-run as .* --role=lead/);
  assert.doesNotMatch(r.stdout, /platform:/, 'refused before anything else ran');
  assert.equal(curlLog(), '');
});
