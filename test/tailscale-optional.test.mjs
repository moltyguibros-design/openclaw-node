// Tailscale only carries a multi-machine cluster (NODE_SPEC §2): a single-node install
// must neither install it nor be refused for lacking it, on either platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

function sandbox(t, os) {
  const dir = mkdtempSync(join(tmpdir(), 'tailscale-optional-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin, join(dir, 'home')]);
  const log = join(dir, 'calls.log');
  const stub = (name, body = 'exit 0') => {
    writeFileSync(join(bin, name), `#!${BASH}\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub('id', 'echo 0');
  stub('uname', `[ "$1" = -m ] && echo x86_64 || echo ${os}`);
  stub('python3');
  stub('curl', 'exit 1');
  for (const ok of ['git', 'sqlite3', 'cc', 'jq', 'rsync', 'nats-server', 'ollama']) stub(ok);
  if (os === 'Linux') stub('apt-get');
  else {
    stub('xcode-select', 'echo /Library/Developer/CommandLineTools');
    stub('brew', '[ "$1" = --version ] && echo "Homebrew 4.0.0"; [ "$1" = --prefix ] && echo /opt/homebrew; exit 0');
  }
  const systemPath = `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`;
  for (const real of ['node', 'mkdir', 'rm', 'dirname', 'cat', 'bash', 'sh', 'head', 'ln']) {
    const p = spawnSync('bash', ['-c', `command -v ${real}`], { encoding: 'utf8', env: { PATH: systemPath } }).stdout.trim();
    symlinkSync(p, join(bin, real));
  }
  const env = (extra) => ({ PATH: bin, HOME: join(dir, 'home'), ...extra });
  const prereqs = (args, extra = {}) => spawnSync(BASH, [join(ROOT, 'scripts/install/prereqs.sh'), ...args], {
    encoding: 'utf8', timeout: 30_000, env: env(extra),
  });
  const bootstrap = (args, extra = {}) => spawnSync(BASH, [join(ROOT, 'bootstrap.sh'), ...args], {
    encoding: 'utf8', timeout: 30_000, env: env({ OPENCLAW_NO_INSTALL: '1', ...extra }),
  });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  return { prereqs, bootstrap, calls };
}

const tailscaleInstall = /tailscale\.com\/install\.sh|tailscale-app/;

for (const os of ['Linux', 'Darwin']) {
  test(`prereqs.sh on ${os} neither installs nor gates on tailscale unless asked`, (t) => {
    const { prereqs, calls } = sandbox(t, os);
    const check = prereqs(['--check']);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.doesNotMatch(check.stdout, /tailscale — MISSING/);
    const install = prereqs([]);
    assert.equal(install.status, 0, install.stdout + install.stderr);
    assert.match(install.stdout, /tailscale not installed: only a multi-machine cluster needs it/);
    assert.doesNotMatch(calls(), tailscaleInstall);
  });

  test(`prereqs.sh on ${os} installs and gates on tailscale when OPENCLAW_WITH_TAILSCALE=1`, (t) => {
    const { prereqs, calls } = sandbox(t, os);
    const check = prereqs(['--check'], { OPENCLAW_WITH_TAILSCALE: '1' });
    assert.equal(check.status, 1, check.stdout + check.stderr);
    assert.match(check.stdout, /tailscale — MISSING/);
    assert.doesNotMatch(calls(), tailscaleInstall, '--check installs nothing');
    const install = prereqs([], { OPENCLAW_WITH_TAILSCALE: '1' });
    assert.equal(install.status, 1, install.stdout + install.stderr);
    assert.match(calls(), tailscaleInstall);
  });
}

test('bootstrap.sh installs and gates on tailscale only with --with-tailscale or --cluster-peers', (t) => {
  const { bootstrap, calls } = sandbox(t, 'Linux');
  const single = bootstrap(['--skip-llm']);
  assert.equal(single.status, 0, single.stdout + single.stderr);
  assert.match(single.stdout, /baseline complete/);
  assert.doesNotMatch(calls(), tailscaleInstall);
  for (const flag of ['--with-tailscale', '--cluster-peers=10.0.0.2,10.0.0.3']) {
    const r = bootstrap(['--skip-llm', flag]);
    assert.equal(r.status, 1, `${flag}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /tailscale — MISSING/, flag);
    assert.match(calls(), /tailscale\.com\/install\.sh/, flag);
  }
});

test('install.sh asks prereqs.sh for tailscale on --with-tailscale or --cluster-peers', () => {
  const install = readFileSync(join(ROOT, 'install.sh'), 'utf8');
  assert.match(install, /^\s+--with-tailscale\)\s+WITH_TAILSCALE=true ;;$/m);
  assert.match(install, /^\s+--cluster-peers=\*\)\s+CLUSTER_PEERS="\$\{arg#--cluster-peers=\}"; WITH_TAILSCALE=true ;;$/m);
  const deps = readFileSync(join(ROOT, 'scripts/install/system-deps.sh'), 'utf8');
  const calls = deps.replace(/\\\n\s*/g, ' ').split('\n').filter((l) => l.includes('bash "$PREREQ_SCRIPT"'));
  assert.equal(calls.length, 2);
  for (const l of calls) assert.match(l, /OPENCLAW_WITH_TAILSCALE=\$\(\$WITH_TAILSCALE && echo 1 \|\| echo 0\)/, l);
});
