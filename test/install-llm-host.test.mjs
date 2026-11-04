/**
 * install-llm-host.test.mjs — a VM uses its host's Ollama (scripts/install/llm-host.sh).
 *
 * Every probe the helper makes (uname, sysctl, route, ip, systemd-detect-virt, curl) is stubbed
 * on PATH, so each case describes one machine: hardware or a VM, which gateway, and what the
 * host's Ollama answers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPERS = join(ROOT, 'scripts/install/helpers.sh');
const LLM_HOST = join(ROOT, 'scripts/install/llm-host.sh');
const LLM_SETUP = join(ROOT, 'scripts/install/llm-setup.sh');

const TAGS_WITH = (model) => JSON.stringify({ models: [{ name: model, model }] });

const STUBS = {
  uname: 'echo "$STUB_OS"',
  sysctl: `case "$2" in
  kern.hv_vmm_present) echo "\${STUB_VMM:-0}" ;;
  hw.model) echo "\${STUB_MODEL:-Mac14,2}" ;;
  hw.memsize) echo 19327352832 ;;
esac`,
  route: '[ -n "$STUB_GW" ] && printf "   route to: default\\n    gateway: %s\\n" "$STUB_GW"',
  ip: '[ -n "$STUB_GW" ] && echo "default via $STUB_GW dev eth0 proto dhcp"',
  'systemd-detect-virt': '[ -n "$STUB_VIRT" ] && { echo "$STUB_VIRT"; exit 0; }; echo none; exit 1',
  curl: `for a in "$@"; do case "$a" in http*) url="$a" ;; esac; done
[ -n "$STUB_TAGS" ] && [ "$url" = "http://$STUB_GW:11434/api/tags" ] && { printf '%s' "$STUB_TAGS"; exit 0; }
exit 7`,
};

function machine(vars = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'llm-host-'));
  for (const [name, body] of Object.entries(STUBS)) {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/bash\n${body}\n`);
    chmodSync(file, 0o755);
  }
  const envFile = join(dir, 'openclaw.env');
  writeFileSync(envFile, 'LLM_MODEL=qwen3:8b\nLLM_BASE_URL=http://localhost:11434\nOTHER=kept\n');
  const env = { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, STUB_OS: 'Darwin', ...vars };
  return { dir, envFile, env };
}

/** Source the installer helpers and llm-host.sh as install.sh does, then run `body`. */
function installerShell(m, body, extra = {}) {
  const script = `set -euo pipefail
DRY_RUN=\${DRY_RUN:-false}
ENV_FILE='${m.envFile}'
source '${HELPERS}'
source '${LLM_HOST}'
${body}`;
  return spawnSync('bash', ['-c', script], { env: { ...m.env, ...extra }, encoding: 'utf8' });
}

const BRIDGE = `export LLM_MODEL=qwen3:8b LLM_BASE_URL="\${LLM_BASE_URL:-http://localhost:11434}"
if bridge_llm_to_host; then echo "BRIDGED=$LLM_BASE_URL"; else echo "KEPT=$LLM_BASE_URL"; fi`;

const UTM_VM = { STUB_VMM: '1', STUB_MODEL: 'VirtualMac2,1', STUB_GW: '192.168.64.1', STUB_TAGS: TAGS_WITH('qwen3:8b') };

test('llm_url_is_local names this machine and nothing else', () => {
  const m = machine();
  const cases = {
    'http://localhost:11434': true, 'http://localhost': true, 'http://127.0.0.1:11434': true,
    'http://[::1]:11434': true, 'https://localhost/v1': true,
    'http://192.168.64.1:11434': false, 'http://gpu-box:8000': false, 'http://localhost.example.com:11434': false,
  };
  for (const [url, local] of Object.entries(cases)) {
    const r = installerShell(m, `llm_url_is_local '${url}' && echo local || echo remote`);
    assert.equal(r.stdout.trim(), local ? 'local' : 'remote', `${url}: ${r.stderr}`);
  }
});

test('a macOS VM (UTM) whose host serves the model points LLM_BASE_URL at the host', () => {
  const m = machine(UTM_VM);
  const r = installerShell(m, BRIDGE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BRIDGED=http:\/\/192\.168\.64\.1:11434/);
  assert.match(r.stdout, /VM detected \(VirtualMac2,1\)/);
  const env = readFileSync(m.envFile, 'utf8');
  assert.match(env, /^LLM_BASE_URL=http:\/\/192\.168\.64\.1:11434$/m);
  assert.match(env, /^OTHER=kept$/m, 'every other key is untouched');
});

test('a Linux VM bridges through the route systemd-detect-virt and ip report', () => {
  const m = machine({ STUB_OS: 'Linux', STUB_VIRT: 'kvm', STUB_GW: '10.0.2.2', STUB_TAGS: TAGS_WITH('qwen3:8b') });
  const r = installerShell(m, BRIDGE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BRIDGED=http:\/\/10\.0\.2\.2:11434/);
  assert.match(r.stdout, /VM detected \(kvm\)/);
});

test('hardware keeps its local Ollama and says nothing', () => {
  const m = machine({ STUB_VMM: '0', STUB_GW: '192.168.1.1', STUB_TAGS: TAGS_WITH('qwen3:8b') });
  const r = installerShell(m, BRIDGE);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'KEPT=http://localhost:11434');
  assert.match(readFileSync(m.envFile, 'utf8'), /^LLM_BASE_URL=http:\/\/localhost:11434$/m);
});

test('a VM whose host serves no Ollama keeps a local one and says how to bridge', () => {
  const m = machine({ ...UTM_VM, STUB_TAGS: '' });
  const r = installerShell(m, BRIDGE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /KEPT=http:\/\/localhost:11434/);
  assert.match(r.stdout, /no Ollama answers on the host at http:\/\/192\.168\.64\.1:11434/);
  assert.match(r.stdout, /OLLAMA_HOST=0\.0\.0\.0/);
});

test('a VM whose host lacks the model keeps a local one and names the pull to run on the host', () => {
  const m = machine({ ...UTM_VM, STUB_TAGS: TAGS_WITH('llama3.3:70b') });
  const r = installerShell(m, BRIDGE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /KEPT=http:\/\/localhost:11434/);
  assert.match(r.stdout, /lacks qwen3:8b/);
  assert.match(r.stdout, /ollama pull qwen3:8b/);
  assert.match(readFileSync(m.envFile, 'utf8'), /^LLM_BASE_URL=http:\/\/localhost:11434$/m);
});

test('an operator endpoint and OPENCLAW_LLM_HOST=0 are never replaced', () => {
  const endpoint = machine(UTM_VM);
  const r1 = installerShell(endpoint, BRIDGE, { LLM_BASE_URL: 'http://gpu-box:8000' });
  assert.equal(r1.stdout.trim(), 'KEPT=http://gpu-box:8000');
  const optOut = machine(UTM_VM);
  const r2 = installerShell(optOut, BRIDGE, { OPENCLAW_LLM_HOST: '0' });
  assert.equal(r2.stdout.trim(), 'KEPT=http://localhost:11434');
  assert.match(readFileSync(optOut.envFile, 'utf8'), /^LLM_BASE_URL=http:\/\/localhost:11434$/m);
});

test('--dry-run reports the bridge and writes nothing', () => {
  const m = machine(UTM_VM);
  const before = readFileSync(m.envFile, 'utf8');
  const r = installerShell(m, BRIDGE, { DRY_RUN: 'true' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\]/);
  assert.equal(readFileSync(m.envFile, 'utf8'), before);
});

test('wave 2 in a VM uses the host and downloads nothing, without ollama installed', () => {
  const m = machine(UTM_VM);
  const r = spawnSync('bash', [LLM_SETUP, '--check'], {
    env: { ...m.env, ENV_FILE: m.envFile, OPENCLAW_ROOT: m.dir, REPO_DIR: ROOT, NODE_BIN: process.execPath },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /the host's Ollama at http:\/\/192\.168\.64\.1:11434 serves qwen3:8b/);
  assert.match(r.stdout, /LLM endpoint\s+: http:\/\/192\.168\.64\.1:11434\s+\(qwen3:8b — no model download\)/);
  assert.doesNotMatch(r.stdout, /Recommended/);
});

test('wave 2 treats an already-recorded remote endpoint the same way', () => {
  const m = machine({ STUB_VMM: '0' });
  writeFileSync(m.envFile, 'LLM_MODEL=qwen3:8b\nLLM_BASE_URL=http://192.168.64.1:11434\n');
  const r = spawnSync('bash', [LLM_SETUP, '--check'], {
    env: { ...m.env, ENV_FILE: m.envFile, OPENCLAW_ROOT: m.dir, REPO_DIR: ROOT, NODE_BIN: process.execPath },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /LLM endpoint\s+: http:\/\/192\.168\.64\.1:11434/);
});

test('the install wiring: config.sh bridges before rendering; only a local URL starts or pulls ollama', () => {
  const config = readFileSync(join(ROOT, 'scripts/install/config.sh'), 'utf8');
  const bridge = config.indexOf('bridge_llm_to_host');
  assert.ok(bridge > config.indexOf('export LLM_BASE_URL='), 'bridges after the defaults are exported');
  assert.ok(bridge < config.indexOf('Step 8: Generate Configs'), 'bridges before any template renders');
  const components = readFileSync(join(ROOT, 'scripts/install/components.sh'), 'utf8');
  const localGate = components.indexOf('if ! $SKIP_LLM && ! $DRY_RUN && llm_url_is_local "$LLM_BASE_URL"; then');
  assert.ok(localGate > 0, 'the local ollama block is gated on a local URL');
  for (const call of ['brew services start ollama', 'ollama serve', 'ollama pull "$LLM_MODEL"']) {
    assert.ok(components.indexOf(call) > localGate, `${call} sits inside the local-only block`);
  }
  assert.ok(components.indexOf('Prefetching embedder') > components.indexOf('if ! $SKIP_LLM && ! $DRY_RUN; then'),
    'the embedder prefetch runs for remote LLMs too');
});

test('every LLM-consuming unit renders LLM_MODEL and LLM_BASE_URL', () => {
  for (const unit of [
    'launchd/ai.openclaw.memory-daemon.plist', 'launchd/ai.openclaw.node-watch.plist',
    'launchd/ai.openclaw.health-watch.plist', 'launchd/ai.openclaw.consolidation-scheduler.plist',
    'launchd/ai.openclaw.mesh-agent.plist', 'systemd/openclaw-memory-daemon.service',
    'systemd/openclaw-node-watch.service', 'systemd/openclaw-consolidation-scheduler.service',
    'systemd/openclaw-mesh-agent.service',
  ]) {
    const text = readFileSync(join(ROOT, 'services', unit), 'utf8');
    assert.match(text, /\$\{LLM_BASE_URL\}/, `${unit} lacks LLM_BASE_URL`);
    assert.match(text, /\$\{LLM_MODEL\}/, `${unit} lacks LLM_MODEL`);
  }
});

function ownedWave2(t) {
  const m = machine({ STUB_OS: 'Darwin', STUB_VMM: '0' });
  t.after(() => rmSync(m.dir, { recursive: true, force: true }));
  const trace = join(m.dir, 'commands.data');
  const curlArgs = join(m.dir, 'curl-args.data');
  const stub = (name, body) => {
    const file = join(m.dir, name);
    writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
    return file;
  };
  stub('curl', 'printf "curl\\n" >> "$OWNED_TRACE"\nprintf "%s\\n" "$@" >> "$OWNED_CURL_ARGS"\nexit 0');
  stub('ollama', 'if [ "$1" = list ]; then printf "ollama-list\\n" >> "$OWNED_TRACE"; printf "NAME ID SIZE\\nqwen3:8b owned 1\\n"; exit 0; fi\nprintf "blocked-ollama\\n" >> "$OWNED_TRACE"\nexit 99');
  for (const name of ['node', 'systemctl', 'sudo', 'brew', 'launchctl']) {
    stub(name, `printf 'blocked-${name}\\n' >> "$OWNED_TRACE"\nexit 99`);
  }
  stub('sed', 'if [ -n "${OWNED_FAIL_KEY:-}" ]; then\n  case "$2" in *"^${OWNED_FAIL_KEY}="*) printf "owned write refused\\n" >&2; exit 73 ;; esac\nfi\nexec /usr/bin/sed "$@"');
  const initial = 'LLM_MODEL=before\nLLM_BASE_URL=http://localhost:11434\nOPENCLAW_MODEL_ENABLED=0\nOTHER=kept\n';
  writeFileSync(m.envFile, initial);
  const run = (args, changes = {}) => spawnSync('bash', [LLM_SETUP, ...args], {
    env: { ...m.env, REPO_DIR: ROOT, ENV_FILE: m.envFile, OPENCLAW_ROOT: m.dir,
      WORKSPACE: join(m.dir, 'absent-workspace'), NODE_BIN: join(m.dir, 'node'), OPENCLAW_LLM_HOST: '0',
      OWNED_TRACE: trace, OWNED_CURL_ARGS: curlArgs, ...changes },
    encoding: 'utf8', timeout: 10_000,
  });
  return { ...m, initial, run, commands: () => existsSync(trace) ? readFileSync(trace, 'utf8') : '',
    curlArguments: () => existsSync(curlArgs) ? readFileSync(curlArgs, 'utf8') : '' };
}

const ownedEndpoint = String.raw`http://owned.invalid:1234/v1?first=1&second=2|literal\path`;
const ownedModel = `modèle&part|"quoted"\\tail`;

test('wave2 saves existing endpoint and model metacharacters literally through its full path', t => {
  const f = ownedWave2(t), r = f.run(['--endpoint', ownedEndpoint, '--model', ownedModel]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(f.envFile, 'utf8'), `LLM_MODEL=${ownedModel}\nLLM_BASE_URL=${ownedEndpoint}\nOPENCLAW_MODEL_ENABLED=1\nOTHER=kept\n`);
  assert.equal(f.commands(), 'curl\n');
  assert.ok(f.curlArguments().includes(`${ownedEndpoint}/v1/models\n`));
  assert.match(r.stdout, /Model setup complete/);
});

test('wave2 appends missing settings without merging an unterminated unrelated line', t => {
  const f = ownedWave2(t);
  writeFileSync(f.envFile, 'OTHER=kept');
  const r = f.run(['--endpoint', ownedEndpoint, '--model', ownedModel]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(f.envFile, 'utf8'), `OTHER=kept\nLLM_BASE_URL=${ownedEndpoint}\nLLM_MODEL=${ownedModel}\nOPENCLAW_MODEL_ENABLED=1\n`);
  assert.equal(f.commands(), 'curl\n');
});

for (const key of ['LLM_BASE_URL', 'LLM_MODEL', 'OPENCLAW_MODEL_ENABLED']) {
  test(`wave2 stops on a refused ${key} write without completing setup`, t => {
    const f = ownedWave2(t);
    const r = f.run(['--endpoint', ownedEndpoint, '--model', ownedModel], { OWNED_FAIL_KEY: key });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /owned write refused/);
    assert.doesNotMatch(r.stdout, /Model setup complete/);
    const expected = key === 'LLM_BASE_URL' ? f.initial
      : key === 'LLM_MODEL' ? `LLM_MODEL=before\nLLM_BASE_URL=${ownedEndpoint}\nOPENCLAW_MODEL_ENABLED=0\nOTHER=kept\n`
        : `LLM_MODEL=${ownedModel}\nLLM_BASE_URL=${ownedEndpoint}\nOPENCLAW_MODEL_ENABLED=0\nOTHER=kept\n`;
    assert.equal(readFileSync(f.envFile, 'utf8'), expected);
    assert.equal(f.commands(), key === 'OPENCLAW_MODEL_ENABLED' ? 'curl\n' : '');
    if (key !== 'OPENCLAW_MODEL_ENABLED') assert.doesNotMatch(r.stdout, /recorded in/);
  });
}

for (const [label, value] of [['LF', 'http://owned.invalid\nOTHER=corrupt'], ['CR', 'http://owned.invalid\rOTHER=corrupt']]) {
  test(`wave2 refuses an endpoint containing ${label} before probing or changing settings`, t => {
    const f = ownedWave2(t), r = f.run(['--endpoint', value, '--model', ownedModel]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /env values must fit on one line/);
    assert.equal(readFileSync(f.envFile, 'utf8'), f.initial);
    assert.equal(f.commands(), '');
    assert.doesNotMatch(r.stdout, /recorded in|Model setup complete/);
  });
}

test('wave2 retains the prior successful URL write when a later multiline model is refused', t => {
  const f = ownedWave2(t), r = f.run(['--endpoint', ownedEndpoint, '--model', 'first\nOTHER=corrupt']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /env values must fit on one line/);
  assert.equal(readFileSync(f.envFile, 'utf8'), `LLM_MODEL=before\nLLM_BASE_URL=${ownedEndpoint}\nOPENCLAW_MODEL_ENABLED=0\nOTHER=kept\n`);
  assert.equal(f.commands(), '');
  assert.doesNotMatch(r.stdout, /recorded in|Model setup complete/);
});

for (const refuse of [false, true]) {
  test(`wave2 ${refuse ? 'refuses' : 'records'} the already-present local-model setting without a download`, t => {
    const f = ownedWave2(t), r = f.run(['--yes'], { OWNED_FAIL_KEY: refuse ? 'LLM_MODEL' : '' });
    assert.equal(r.status, refuse ? 1 : 0, r.stdout + r.stderr);
    assert.equal(readFileSync(f.envFile, 'utf8'), refuse ? f.initial
      : 'LLM_MODEL=qwen3:8b\nLLM_BASE_URL=http://localhost:11434\nOPENCLAW_MODEL_ENABLED=1\nOTHER=kept\n');
    assert.equal(f.commands(), 'curl\ncurl\nollama-list\n');
    assert.deepEqual(f.curlArguments().split('\n').filter(arg => arg.startsWith('http')), [
      'http://localhost:11434/api/tags', 'http://localhost:11434/api/tags',
    ]);
    assert.doesNotMatch(f.commands(), /blocked-/);
    assert.ok(f.commands().includes('ollama-list\n'));
    if (refuse) assert.doesNotMatch(r.stdout, /recorded in|Model setup complete/);
    else assert.match(r.stdout, /Model setup complete/);
  });
}
