#!/usr/bin/env node

/**
 * llm-providers.test.js — Unit tests for LLM provider resolution.
 * Uses node:test (no external deps). Run: node test/llm-providers.test.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { tmpDir } = require('./helpers/tmp-dir.cjs');

// Built-ins only: an operator's ~/.openclaw/mesh-providers.json must not leak into PROVIDERS.
process.env.HOME = tmpDir('llm-providers-home-');
for (const k of ['CLAUDE_PATH', 'OPENAI_PATH', 'GEMINI_PATH', 'DEEPSEEK_PATH', 'KIMI_PATH', 'MINIMAX_PATH', 'OLLAMA_PATH', 'AIDER_PATH']) delete process.env[k];
const { resolveProvider, resolveModel, PROVIDERS } = require('../lib/llm-providers');

describe('resolveProvider', () => {
  it('task.llm_provider takes priority over env and CLI', () => {
    const provider = resolveProvider({ llm_provider: 'openai' }, 'claude', 'gemini');
    assert.equal(provider.name, 'openai');
  });

  it('P1-3: a task may select shell only on a node whose own provider is shell', () => {
    for (const [cli, env] of [['openai', 'gemini'], ['claude', null], [null, 'claude'], [null, null], ['shell', 'claude']]) {
      assert.throws(() => resolveProvider({ task_id: 'T-sh', llm_provider: 'shell' }, cli, env), /only on a node configured for it/, `${cli}/${env}`);
    }
    assert.equal(resolveProvider({ llm_provider: 'shell' }, null, 'shell').name, 'shell');
    assert.equal(resolveProvider({ llm_provider: 'shell' }, 'shell', null).name, 'shell');
  });

  it('env takes priority over CLI when task has no provider', () => {
    const provider = resolveProvider(null, 'openai', 'shell');
    assert.equal(provider.name, 'shell');
  });

  it('env takes priority over CLI when task.llm_provider is null', () => {
    const provider = resolveProvider({ llm_provider: null }, 'openai', 'shell');
    assert.equal(provider.name, 'shell');
  });

  it('CLI takes priority over default when task and env are null', () => {
    const provider = resolveProvider(null, 'openai', null);
    assert.equal(provider.name, 'openai');
  });

  it('refuses to pick a vendor when nothing is chosen (provider-agnostic: no silent default)', () => {
    assert.throws(() => resolveProvider(null, null, null), /No LLM provider chosen/);
    assert.throws(() => resolveProvider({}, null, null), /MESH_LLM_PROVIDER/);
  });

  it('throws on unknown provider', () => {
    assert.throws(
      () => resolveProvider({ llm_provider: 'nonexistent' }, null, null),
      /Unknown LLM provider.*nonexistent/,
    );
  });

  it('resolves all built-in providers', () => {
    for (const name of ['claude', 'openai', 'gemini', 'deepseek', 'kimi', 'minimax', 'shell', 'ollama', 'aider']) {
      const provider = resolveProvider({ llm_provider: name }, null, name);
      assert.equal(provider.name, name);
    }
  });
});

describe('resolveModel', () => {
  it('task.llm_model takes priority over CLI and default', () => {
    const provider = PROVIDERS.claude;
    const model = resolveModel({ llm_model: 'opus' }, 'sonnet', provider);
    assert.equal(model, 'opus');
  });

  it('CLI model takes priority over default when task has no model', () => {
    const provider = PROVIDERS.claude;
    const model = resolveModel(null, 'haiku', provider);
    assert.equal(model, 'haiku');
  });

  it('falls back to provider default when no model specified', () => {
    const provider = PROVIDERS.claude;
    const model = resolveModel(null, null, provider);
    assert.equal(model, 'sonnet');
  });

  it('shell provider has null default model', () => {
    const provider = PROVIDERS.shell;
    const model = resolveModel(null, null, provider);
    assert.equal(model, null);
  });

  it('task model override works with shell provider', () => {
    const provider = PROVIDERS.shell;
    const model = resolveModel({ llm_model: 'custom' }, null, provider);
    assert.equal(model, 'custom');
  });
});

describe('shell provider buildArgs', () => {
  it('uses task.description as command, not prompt', () => {
    const provider = PROVIDERS.shell;
    const task = { description: 'node --version' };
    const args = provider.buildArgs('some prompt', null, task);
    assert.deepEqual(args, ['-c', 'node --version']);
  });

  it('falls back to prompt when task.description is empty', () => {
    const provider = PROVIDERS.shell;
    const args = provider.buildArgs('echo hello', null, {});
    assert.deepEqual(args, ['-c', 'echo hello']);
  });

  it('blocks commands not in the allowlist', () => {
    const provider = PROVIDERS.shell;
    const task = { description: 'uname -a' };
    assert.throws(
      () => provider.buildArgs('some prompt', null, task),
      /blocked by security filter/
    );
  });
});

describe('claude provider --add-dir scope', () => {
  const addDirs = (scope) => {
    const args = PROVIDERS.claude.buildArgs('p', null, { scope }, '/home/u/proj');
    return args.flatMap((a, i) => (a === '--add-dir' ? [args[i + 1]] : []));
  };

  it('grants a directory inside the target', () => {
    assert.deepEqual(addDirs(['src/lib/a.js']), ['/home/u/proj', '/home/u/proj/src/lib']);
  });

  it('never grants the target\'s parent or a sibling sharing its name prefix', () => {
    assert.deepEqual(addDirs(['.', './', '../proj-secrets/x', '../../etc/passwd']), ['/home/u/proj']);
  });

  it('allows a /tmp scope but not a /tmpfoo lookalike', () => {
    assert.deepEqual(addDirs(['/tmp/work/f']), ['/home/u/proj', '/tmp/work']);
    assert.deepEqual(addDirs(['/tmpfoo/f']), ['/home/u/proj']);
  });
});

describe('llm-providers header', () => {
  it('does not document a default vendor that resolveProvider refuses to pick', () => {
    const src = require('node:fs').readFileSync(require.resolve('../lib/llm-providers'), 'utf8');
    const header = src.slice(0, src.indexOf('*/'));
    assert.doesNotMatch(header, /Default:/);
    assert.match(header, /No default: resolveProvider\(\) throws/);
  });
});

// Flags checked against each CLI's own argument parser (see the provider comments):
// codex exec (codex-rs exec/src/cli.rs + utils/cli shared_options.rs), gemini
// (packages/cli/src/config/config.ts, strict yargs), aider (aider/args.py),
// ollama (cmd/cmd.go `run MODEL [PROMPT]`, --think).
describe('non-claude provider argv', () => {
  const PROMPT = '# Task\n--not-a-flag';

  it('openai runs `codex exec` non-interactively in the target, prompt last after --', () => {
    const args = PROVIDERS.openai.buildArgs(PROMPT, 'm1', {}, '/wt', null);
    assert.deepEqual(args, ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '--model', 'm1', '--cd', '/wt', '--', PROMPT]);
    assert.ok(!args.includes('-p'), '-p is --profile in codex, not a prompt flag');
    assert.ok(!args.includes('--cwd'), 'codex has --cd, no --cwd');
  });

  it('openai grants the workspace as a writable extra dir only when it differs from the target', () => {
    assert.deepEqual(PROVIDERS.openai.buildArgs('p', 'm1', {}, '/ws', '/ws').filter((a) => a === '--add-dir'), []);
    const args = PROVIDERS.openai.buildArgs('p', 'm1', {}, '/wt', '/ws');
    assert.equal(args[args.indexOf('--add-dir') + 1], '/ws');
    assert.ok(args.indexOf('--add-dir') < args.indexOf('--'));
  });

  it('gemini runs headless with -p, auto-approves, and reaches the target through --include-directories', () => {
    assert.deepEqual(
      PROVIDERS.gemini.buildArgs(PROMPT, 'm2', {}, '/wt', null),
      ['-p', PROMPT, '--model', 'm2', '--approval-mode', 'yolo', '--include-directories', '/wt'],
    );
    assert.deepEqual(
      PROVIDERS.gemini.buildArgs('p', 'm2', {}, '/ws', '/ws').filter((a) => a === '--include-directories').length, 1,
    );
    assert.ok(!PROVIDERS.gemini.buildArgs('p', 'm2', {}, '/wt').includes('--cwd'), 'gemini parses strictly: --cwd is an error');
  });

  it('gemini trusts its work dir, or an untrusted folder forces approval back to default', () => {
    assert.equal(PROVIDERS.gemini.cleanEnv({ A: '1' }).GEMINI_CLI_TRUST_WORKSPACE, 'true');
  });

  it('aider sends one message, answers its own prompts, and leaves committing and history to the mesh', () => {
    const os = require('node:os');
    assert.deepEqual(PROVIDERS.aider.buildArgs(PROMPT, 'm3', {}, '/wt'), [
      '--message', PROMPT, '--model', 'm3',
      '--yes-always', '--no-auto-commits', '--no-gitignore', '--no-pretty',
      '--input-history-file', os.devNull, '--chat-history-file', os.devNull,
    ]);
    assert.ok(!PROVIDERS.aider.buildArgs('p', null).includes('--model'));
    assert.equal(PROVIDERS.aider.spawnCwd('/wt'), '/wt');
  });

  it('ollama runs `ollama run MODEL PROMPT`, disabling thinking only for thinking families', () => {
    assert.deepEqual(PROVIDERS.ollama.buildArgs('p', 'llama3'), ['run', 'llama3', 'p']);
    assert.deepEqual(PROVIDERS.ollama.buildArgs('p', 'qwen3:8b'), ['run', '--think=false', 'qwen3:8b', 'p']);
  });
});

// Checked against each published CLI's own parser (tarballs read, never run):
// Kimi Code CLI (npm @moonshot-ai/kimi-code, bin kimi: commander root with
// -p/--prompt, -m/--model, --add-dir, no root --cwd, and "Cannot combine --prompt
// with --yolo"; prompt mode works in process.cwd() and auto-approves), DeepSeek's
// harness (npm @deepseek-ai/dsh, bin dsh: `dsh --profile headless "job"` in the
// invoking directory, headless reads --add-dir, no model flag), and minimax-cli
// (crate minimax-cli, bin minimax: `exec [--model M] [--auto] PROMPT`, where --auto
// runs the tool agent in current_dir; root -p sends one request with no tools).
describe('deepseek, kimi and minimax argv', () => {
  const PROMPT = '# Task\n--not-a-flag';

  it('kimi runs Kimi Code prompt mode inside the target, model only when one is named', () => {
    assert.deepEqual(PROVIDERS.kimi.buildArgs(PROMPT, 'm4', {}, '/wt', null), ['-p', PROMPT, '-m', 'm4']);
    assert.deepEqual(PROVIDERS.kimi.buildArgs(PROMPT, null, {}, '/wt', null), ['-p', PROMPT]);
    assert.deepEqual(PROVIDERS.kimi.buildArgs('p', null, {}, '/wt', '/ws'), ['-p', 'p', '--add-dir', '/ws']);
    assert.deepEqual(PROVIDERS.kimi.buildArgs('p', null, {}, '/ws', '/ws'), ['-p', 'p']);
    const args = PROVIDERS.kimi.buildArgs(PROMPT, 'm4', {}, '/wt', '/ws');
    for (const flag of ['--cwd', '--model', '--yolo', '--auto']) assert.ok(!args.includes(flag), `${flag} is not in Kimi Code prompt mode`);
    assert.equal(PROVIDERS.kimi.spawnCwd('/wt'), '/wt');
    assert.equal(PROVIDERS.kimi.binary, 'kimi');
  });

  it('kimi: the legacy kimi-cli deprecation notice is a refused run, a real answer is not', () => {
    const en = 'kimi-cli is no longer maintained. Please use the new Kimi Code CLI. Install: curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash\n';
    const zh = 'kimi-cli 已停止维护，请使用新版 Kimi Code CLI。安装：curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash\n';
    for (const out of [en, zh, `kimi, version 1.52.0\n${en}`]) assert.match(PROVIDERS.kimi.parseOutput(out).refused, /legacy kimi-cli/);
    assert.equal(PROVIDERS.kimi.parseOutput('Done: edited src/a.js'), null);
    assert.equal(PROVIDERS.kimi.parseOutput(`Notes:\n${en}`), null, 'an answer that quotes the notice is still an answer');
  });

  it('deepseek runs dsh headless inside the target; dsh has no model flag', () => {
    assert.equal(PROVIDERS.deepseek.binary, 'dsh');
    assert.deepEqual(PROVIDERS.deepseek.buildArgs(PROMPT, 'm5', {}, '/wt', null), ['--profile', 'headless', PROMPT]);
    assert.deepEqual(PROVIDERS.deepseek.buildArgs('p', null, {}, '/wt', '/ws'), ['--profile', 'headless', '--add-dir', '/ws', 'p']);
    assert.deepEqual(PROVIDERS.deepseek.buildArgs('p', null, {}, '/ws', '/ws'), ['--profile', 'headless', 'p']);
    assert.equal(PROVIDERS.deepseek.spawnCwd('/wt'), '/wt');
  });

  it('minimax runs the exec tool agent (--auto) inside the target, prompt last after --', () => {
    assert.equal(PROVIDERS.minimax.binary, 'minimax');
    assert.deepEqual(PROVIDERS.minimax.buildArgs(PROMPT, 'm6', {}, '/wt', null), ['exec', '--auto', '--model', 'm6', '--', PROMPT]);
    assert.deepEqual(PROVIDERS.minimax.buildArgs(PROMPT, null, {}, '/wt', null), ['exec', '--auto', '--', PROMPT]);
    const args = PROVIDERS.minimax.buildArgs(PROMPT, 'm6', {}, '/wt', '/ws');
    for (const flag of ['-p', '--cwd']) assert.ok(!args.includes(flag), `${flag} would send a tool-less one-shot or be rejected`);
    assert.equal(PROVIDERS.minimax.spawnCwd('/wt'), '/wt');
  });

  it('an explicit *_PATH still names the binary', () => {
    const src = 'const p = require(process.argv[1]).PROVIDERS; process.stdout.write([p.deepseek.binary, p.kimi.binary, p.minimax.binary].join(" "))';
    const r = spawnSync(process.execPath, ['-e', src, require.resolve('../lib/llm-providers')], {
      encoding: 'utf8', env: { ...process.env, DEEPSEEK_PATH: '/opt/d', KIMI_PATH: '/opt/k', MINIMAX_PATH: '/opt/m' },
    });
    assert.equal(r.stdout, '/opt/d /opt/k /opt/m', r.stderr);
  });
});

describe('model defaults', () => {
  it('a CLI that has its own configured model gets no forced default', () => {
    for (const name of ['openai', 'gemini', 'deepseek', 'kimi', 'minimax', 'aider']) {
      assert.equal(resolveModel(null, null, PROVIDERS[name]), null, name);
    }
    assert.ok(!PROVIDERS.openai.buildArgs('p', null, {}, '/wt').includes('--model'));
    assert.ok(!PROVIDERS.gemini.buildArgs('p', null, {}, '/wt').includes('--model'));
    assert.equal(resolveModel({ llm_model: 'm7' }, null, PROVIDERS.openai), 'm7');
    assert.equal(resolveModel(null, 'm8', PROVIDERS.gemini), 'm8');
  });

  // dsh has no model flag: a named model reached no argv, yet runLLM returned it
  // and the agent state and HyperAgent telemetry recorded it as the run's model.
  it('a provider that takes no model resolves none, whatever the task or --model names', () => {
    assert.equal(PROVIDERS.deepseek.acceptsModel, false);
    assert.equal(resolveModel({ llm_model: 'm9' }, null, PROVIDERS.deepseek), null);
    assert.equal(resolveModel({}, 'm10', PROVIDERS.deepseek), null);
    assert.equal(resolveModel({ llm_model: 'm11' }, null, PROVIDERS.kimi), 'm11');
    assert.equal(resolveModel(null, 'm12', PROVIDERS.minimax), 'm12');
  });
});

describe('installer offers every built-in provider', () => {
  const ROOT = path.join(__dirname, '..');
  const env = fs.readFileSync(path.join(ROOT, 'scripts/install/env.sh'), 'utf8');
  const comp = fs.readFileSync(path.join(ROOT, 'scripts/install/components.sh'), 'utf8');
  const builtins = Object.keys(PROVIDERS);

  it('KNOWN_PROVIDERS, the menu and PATH detection list every provider', () => {
    const known = env.match(/^KNOWN_PROVIDERS="([^"]+)"/m)[1].split(' ');
    assert.deepEqual([...known].sort(), [...builtins].sort());
    const detected = env.match(/for p in ([\w ]+); do/)[1].split(' ');
    for (const name of builtins.filter((n) => !['shell', 'ollama'].includes(n))) {
      assert.ok(detected.includes(name), `${name} is detected on PATH`);
      assert.match(comp, new RegExp(`\\) PROVIDER=${name} ;;`), `${name} is in the install menu`);
    }
  });

  it('PATH detection looks for the binary each provider spawns', () => {
    const fn = env.match(/^provider_binary\(\) \{[\s\S]*?^\}/m)[0];
    for (const name of builtins.filter((n) => n !== 'shell')) {
      const r = spawnSync('bash', ['-c', `${fn}\nprovider_binary "$1"`, 'x', name], { encoding: 'utf8' });
      assert.equal(r.stdout.trim(), path.basename(PROVIDERS[name].binary), name);
    }
  });
});
