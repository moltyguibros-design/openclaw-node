/**
 * llm-providers.js — LLM-agnostic provider abstraction for mesh agents.
 *
 * Each provider defines how to spawn a CLI process with a prompt.
 * The mesh agent doesn't care what LLM runs — it only cares about:
 *   1. Send prompt → get text output
 *   2. Exit code 0 = success
 *
 * Built-in providers cover the major ecosystems. Any CLI tool that
 * accepts a prompt and returns text can be registered at runtime
 * or loaded from ~/.openclaw/mesh-providers.json.
 *
 * Resolution order for LLM_PROVIDER:
 *   1. Task-level: task.llm_provider field ('shell' only on a shell node)
 *   2. Environment: MESH_LLM_PROVIDER env var
 *   3. CLI: --provider flag
 *   No default: resolveProvider() throws when none of the three is set.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { createTracer } = require('./tracer');
const tracer = createTracer('llm-providers');

// ── Shell Command Security ─────────────────────────
// The regexes are owned by lib/exec-safety.js; this module used to carry its
// own copies that lagged behind (no destructive-pattern, git, make or python
// checks, and no bare `&`).
const execSafety = require('./exec-safety');

const SHELL_PROVIDER_ALLOWED_PREFIXES = [
  'npm test', 'npm run', 'node ', 'python ', 'pytest', 'cargo test',
  'go test', 'make', 'jest', 'vitest', 'mocha',
  'bash openclaw/', 'bash ~/openclaw/', 'bash ./bin/',
  'sh openclaw/', 'sh ~/openclaw/', 'sh ./bin/',
  'cat ', 'echo ', 'ls ', 'grep ', 'find ', 'git '
];

function validateShellCommand(cmd) {
  const trimmed = (cmd || '').trim();
  if (!trimmed) return false;
  if (execSafety.containsShellChaining(trimmed)) return false;
  if (execSafety.checkDangerousFlags(trimmed).blocked) return false;
  if (execSafety.checkDestructivePatterns(trimmed).blocked) return false;
  return SHELL_PROVIDER_ALLOWED_PREFIXES.some(p => trimmed.startsWith(p));
}

// ── Generic Provider Factory ────────────────────────
// Most agentic coding CLIs follow a similar pattern:
//   binary [prompt-flag] "prompt" [model-flag] model [cwd-flag] dir
// This factory builds a provider from a simple config.

function makeGenericProvider({ name, binary, promptFlag = '-p', modelFlag = '--model', cwdFlag = '--cwd', defaultModel, extraArgs = [], envStrip = [] }) {
  return {
    name,
    binary,
    buildArgs(prompt, model, task, targetDir) {
      const args = [];
      if (promptFlag) args.push(promptFlag, prompt);
      else args.push(prompt); // bare positional prompt
      if (modelFlag && (model || defaultModel)) args.push(modelFlag, model || defaultModel);
      if (cwdFlag && targetDir) args.push(cwdFlag, targetDir);
      args.push(...extraArgs);
      return args;
    },
    cleanEnv(env) {
      if (envStrip.length === 0) return { ...env };
      const clean = { ...env };
      for (const prefix of envStrip) {
        for (const key of Object.keys(clean)) {
          if (key.startsWith(prefix) || key === prefix) delete clean[key];
        }
      }
      return clean;
    },
    defaultModel,
  };
}

// ── Built-in Provider Definitions ───────────────────

/**
 * Read `claude -p --output-format json` output: the answer text plus the CLI's
 * own cost and usage. Returns null when stdout is not that record (a crash
 * before the result, or output truncated at the capture cap), so the caller
 * keeps the raw text and falls back to the session-log estimate.
 */
function parseClaudeJsonResult(raw) {
  let parsed;
  try { parsed = JSON.parse(String(raw || '').trim()); } catch { return null; }
  const record = Array.isArray(parsed)
    ? [...parsed].reverse().find((r) => r && r.type === 'result')
    : parsed;
  if (!record || typeof record !== 'object' || record.type !== 'result') return null;
  const text = typeof record.result === 'string' ? record.result : '';
  const u = record.usage || {};
  const inputTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const outputTokens = u.output_tokens ?? 0;
  const cost = typeof record.total_cost_usd === 'number'
    ? { inputTokens, outputTokens, estimatedCostUsd: record.total_cost_usd }
    : null;
  return { text, cost };
}

const PROVIDERS = {
  // ─── Anthropic ───
  claude: {
    name: 'claude',
    binary: process.env.CLAUDE_PATH || 'claude',
    buildArgs(prompt, model, task, targetDir, workspaceDir) {
      const args = [
        '-p', prompt,
        // json, not text: the result record carries the CLI's own total_cost_usd,
        // which never goes stale the way a local price table does.
        '--output-format', 'json',
        '--model', model || 'sonnet',
        '--permission-mode', 'bypassPermissions',
      ];

      if (targetDir) args.push('--add-dir', targetDir);
      if (workspaceDir && workspaceDir !== targetDir) args.push('--add-dir', workspaceDir);

      // Add scope directories
      if (task.scope && task.scope.length > 0) {
        const addedDirs = new Set([targetDir, workspaceDir].filter(Boolean));
        const within = (dir, root) => dir === root || dir.startsWith(root + path.sep);
        for (const s of task.scope) {
          for (const base of [targetDir, workspaceDir].filter(Boolean)) {
            const resolved = path.resolve(base, s);
            const resolvedDir = path.dirname(resolved);
            if (!within(resolvedDir, path.resolve(base)) && !within(resolvedDir, '/tmp')) continue;
            if (addedDirs.has(resolvedDir)) continue;
            addedDirs.add(resolvedDir);
            args.push('--add-dir', resolvedDir);
          }
        }
      }

      return args;
    },
    cleanEnv(env) {
      const clean = { ...env };
      for (const key of Object.keys(clean)) {
        if (key.startsWith('CLAUDE_CODE') || key === 'CLAUDECODE') delete clean[key];
      }
      return clean;
    },
    parseOutput: parseClaudeJsonResult,
    defaultModel: 'sonnet',
  },

  // ─── OpenAI (Codex CLI) ───
  // `codex exec` is the non-interactive entry point; top-level `codex -p` names
  // a config profile, and there is no --cwd (it is --cd). exec never asks for
  // approval; workspace-write lets it edit --cd and every --add-dir. The prompt
  // goes after `--` so one starting with "-" or naming a subcommand stays a prompt.
  openai: {
    name: 'openai',
    binary: process.env.OPENAI_PATH || 'codex',
    buildArgs(prompt, model, task, targetDir, workspaceDir) {
      const args = ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
      if (model) args.push('--model', model);
      if (targetDir) args.push('--cd', targetDir);
      if (workspaceDir && workspaceDir !== targetDir) args.push('--add-dir', workspaceDir);
      args.push('--', prompt);
      return args;
    },
    cleanEnv(env) {
      return { ...env };
    },
    defaultModel: null,
  },

  // ─── Google Gemini CLI ───
  // -p is headless mode. The parser is strict, so the generic --cwd made every
  // run exit 1; the CLI's workspace is its process cwd plus --include-directories.
  // In an untrusted folder it forces approval back to "default", which approves
  // nothing headless: GEMINI_CLI_TRUST_WORKSPACE trusts the agent's own work dir,
  // and an older CLI ignores an unknown variable where its strict parser would
  // reject the newer --skip-trust flag.
  gemini: {
    name: 'gemini',
    binary: process.env.GEMINI_PATH || 'gemini',
    buildArgs(prompt, model, task, targetDir, workspaceDir) {
      const args = ['-p', prompt];
      if (model) args.push('--model', model);
      args.push('--approval-mode', 'yolo');
      for (const dir of new Set([targetDir, workspaceDir].filter(Boolean))) args.push('--include-directories', dir);
      return args;
    },
    cleanEnv(env) {
      return { ...env, GEMINI_CLI_TRUST_WORKSPACE: 'true' };
    },
    defaultModel: null,
  },

  // ─── DeepSeek (dsh, DeepSeek's own harness) ───
  // `dsh --profile headless JOB` runs one session in the invoking directory and
  // prints the final answer; the launcher hands every argument after its own
  // flags to the headless app, which reads --add-dir. There is no model flag: the
  // model is the profile's configured default, so none is resolved for it.
  deepseek: {
    name: 'deepseek',
    binary: process.env.DEEPSEEK_PATH || 'dsh',
    acceptsModel: false,
    spawnCwd: (targetDir) => targetDir,
    buildArgs(prompt, model, task, targetDir, workspaceDir) {
      const args = ['--profile', 'headless'];
      if (workspaceDir && workspaceDir !== targetDir) args.push('--add-dir', workspaceDir);
      args.push(prompt);
      return args;
    },
    cleanEnv(env) {
      return { ...env };
    },
    defaultModel: null,
  },

  // ─── Kimi (Kimi Code CLI) ───
  // -p is prompt mode: it works in its cwd and auto-approves by itself, and it
  // refuses --yolo/--auto; there is no root --cwd. The legacy PyPI kimi-cli also
  // installs a `kimi`, whose last release prints a deprecation notice and exits 0
  // for any argv, so that notice must read as a refused run, not a finished task.
  kimi: {
    name: 'kimi',
    binary: process.env.KIMI_PATH || 'kimi',
    spawnCwd: (targetDir) => targetDir,
    buildArgs(prompt, model, task, targetDir, workspaceDir) {
      const args = ['-p', prompt];
      if (model) args.push('-m', model);
      if (workspaceDir && workspaceDir !== targetDir) args.push('--add-dir', workspaceDir);
      return args;
    },
    cleanEnv(env) {
      return { ...env };
    },
    parseOutput(raw) {
      const lines = String(raw || '').trim().split('\n');
      const notice = /^kimi-cli (is no longer maintained|已停止维护)/;
      const deprecated = notice.test(lines[lines.length - 1]) && (lines.length === 1 || (lines.length === 2 && /^kimi, version /.test(lines[0])));
      return deprecated ? { refused: 'the legacy kimi-cli only printed its deprecation notice; install the Kimi Code CLI' } : null;
    },
    defaultModel: null,
  },

  // ─── MiniMax (Rust crate minimax-cli >=0.7.0; the npm minimax-cli and @hmbown/minimax-cli have no exec) ───
  // `exec --auto` runs the tool agent in its cwd with every tool auto-approved;
  // the root -p sends one tool-less request that can edit nothing. The prompt
  // goes after `--` so one starting with "-" stays a prompt.
  minimax: {
    name: 'minimax',
    binary: process.env.MINIMAX_PATH || 'minimax',
    spawnCwd: (targetDir) => targetDir,
    buildArgs(prompt, model) {
      const args = ['exec', '--auto'];
      if (model) args.push('--model', model);
      args.push('--', prompt);
      return args;
    },
    cleanEnv(env) {
      return { ...env };
    },
    defaultModel: null,
  },

  // ─── Meta Llama (via Ollama) ───
  ollama: makeGenericProvider({
    name: 'ollama',
    binary: process.env.OLLAMA_PATH || 'ollama',
    promptFlag: null, // ollama run <model> "prompt"
    modelFlag: null,
    cwdFlag: null,
    defaultModel: 'llama3',
  }),

  // ─── Aider (multi-provider CLI — works with OpenAI, Anthropic, Gemini, DeepSeek, etc.) ───
  // Aider has no directory flag: it works on the repository of its cwd, so it runs
  // inside the target (spawnCwd); from the agent's empty work dir it saw no
  // repository at all. --message runs one turn and exits, --yes-always answers its
  // confirmations. The mesh commits the worktree itself, so aider must not commit,
  // edit .gitignore, or leave its history files in the tree.
  aider: {
    name: 'aider',
    binary: process.env.AIDER_PATH || 'aider',
    spawnCwd: (targetDir) => targetDir,
    buildArgs(prompt, model) {
      const args = ['--message', prompt];
      if (model) args.push('--model', model);
      args.push(
        '--yes-always', '--no-auto-commits', '--no-gitignore', '--no-pretty',
        '--input-history-file', os.devNull, '--chat-history-file', os.devNull,
      );
      return args;
    },
    cleanEnv(env) {
      return { ...env };
    },
    defaultModel: null,
  },

  // ─── Shell (no LLM — raw command execution) ───
  // Shell provider ignores the formatted prompt and runs task.description
  // as a raw shell command. The prompt from buildInitialPrompt() is markdown
  // with headers, bullet points, and retry context — bash can't execute that.
  // acceptsPrompt: false — so no prompt-driven pass (Foreman's verifier) is ever
  // routed here; it would only re-run the task's command.
  shell: {
    name: 'shell',
    binary: '/bin/bash',
    acceptsPrompt: false,
    buildArgs(prompt, model, task) {
      // Use task.description (the raw command) if available, fall back to prompt
      const cmd = (task && task.description) ? task.description : prompt;
      if (!validateShellCommand(cmd)) {
        throw new Error(`Shell provider: command blocked by security filter: ${cmd.slice(0, 80)}`);
      }
      return ['-c', cmd];
    },
    cleanEnv(env) {
      return { ...env };
    },
    defaultModel: null,
  },
};

// Thinking-capable ollama families: their reasoning stream contaminates captured
// artifacts and burns minutes per inference (2.4 finding 6). Disable at generation
// unless the operator opts back in with MESH_OLLAMA_THINK=true.
const OLLAMA_THINKING_FAMILIES = /^(qwen3|deepseek-r1|magistral|gpt-oss)/i;

function buildOllamaArgs(prompt, model) {
  const m = model || 'llama3';
  const args = ['run'];
  if (OLLAMA_THINKING_FAMILIES.test(m) && process.env.MESH_OLLAMA_THINK !== 'true') {
    args.push('--think=false');
  }
  args.push(m, prompt);
  return args;
}

/**
 * Sanitize raw CLI output before parsing: terminal control sequences (ollama's
 * spinner leaks CSI/erase codes into captures) and any thinking block that made
 * it into stdout ("Thinking...\n…\n...done thinking."). Output that still starts
 * with an UNTERMINATED thinking block (generation cut mid-reasoning) returns '' so
 * the caller's parse-failure path fires instead of a thinking trace masquerading
 * as an artifact.
 */
function stripLlmOutput(text) {
  if (!text) return text;
  let out = String(text)
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')            // CSI (incl. private modes)
    .replace(/\u001b\][^]*(?:|\u001b\\)/g, '') // OSC
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const hadThinking = /(^|\n)Thinking\.\.\./.test(out);
  out = out.replace(/(^|\n)Thinking\.\.\.[\s\S]*?\.\.\.done thinking\.?/g, '$1');
  // Only a leading block is a cut-off trace; a later line that begins "Thinking..." is prose.
  if (hadThinking && /^\s*Thinking\.\.\./.test(out)) return '';
  return out.trim();
}

// Fix: ollama needs custom buildArgs that the factory can't do, override it
PROVIDERS.ollama.buildArgs = function(prompt, model) {
  return buildOllamaArgs(prompt, model);
};

// ── Provider Resolution ──────────────────────────────

/**
 * Resolve which LLM provider to use.
 * Priority: task.llm_provider > MESH_LLM_PROVIDER env > --provider CLI flag.
 * There is deliberately NO default vendor: the project is provider-agnostic,
 * and a node whose operator never chose a mind must say so, not quietly
 * become a Claude node.
 */
function resolveProvider(task, cliProvider, envProvider) {
  const refusal = taskProviderRefusal(task, cliProvider, envProvider);
  if (refusal) throw new Error(refusal);
  const name = (task && task.llm_provider)
    || envProvider
    || cliProvider;
  if (!name) {
    throw new Error(`No LLM provider chosen. Set MESH_LLM_PROVIDER (one of: ${Object.keys(PROVIDERS).join(', ')}) — install.sh --provider=NAME, or the install prompt.`);
  }

  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown LLM provider: "${name}". Available: ${Object.keys(PROVIDERS).join(', ')}. Register custom providers via registerProvider() or ~/.openclaw/mesh-providers.json`);
  }
  return provider;
}

/**
 * Resolve the model to use.
 * Priority: task.llm_model > --model CLI flag > provider default. A provider
 * that takes no model resolves none: its CLI's own configuration picks it.
 */
function resolveModel(task, cliModel, provider) {
  if (provider.acceptsModel === false) return null;
  return (task && task.llm_model)
    || cliModel
    || provider.defaultModel;
}

// ── Grappe-worker provider guard (D11) ──────────────
// A grappe/cluster worker (circling / cooperative / collaborative) is the node's
// OpenClaw agent driven by an ADVANCED LLM — never a raw local model. Providers that
// wrap a local model are refused for grappe workers; extraction and other non-grappe
// tasks may still use them. This is the mechanical enforcement of D11.
//
// P1 #8: the guard was a denylist of the single string 'ollama' — any future local
// provider walked through, and `shell` (raw bash, NO LLM) was a full worker. Local
// providers are enumerated; mock providers are allowed ONLY when the operator sets
// MESH_ALLOW_MOCK_WORKERS=1 (chaos harness / choreography repros — never silently).
// An operator who has vetted a node's local model for grappe work names its provider
// in MESH_ALLOW_LOCAL_WORKERS (comma-separated, e.g. "ollama"); unset keeps D11.
const LOCAL_MODEL_PROVIDERS = new Set(['ollama', 'llamacpp', 'llama-cpp', 'lmstudio', 'vllm', 'mlx']);
const MOCK_PROVIDERS = new Set(['shell']);

function allowedLocalWorkers(env) {
  return new Set(String(env.MESH_ALLOW_LOCAL_WORKERS || '').split(',').map((s) => s.trim()).filter(Boolean));
}

// P1-3: 'shell' runs the task's command as raw bash behind a bypassable prefix
// filter, so any bus submitter could pick it on a node whose operator chose an
// LLM. A task may name it only on a node whose own provider is already shell.
function taskProviderRefusal(task, cliProvider, envProvider) {
  const requested = task && task.llm_provider;
  if (!requested || !MOCK_PROVIDERS.has(requested)) return null;
  const own = envProvider || cliProvider;
  if (own === requested) return null;
  return `llm_provider "${requested}" refused: this node's provider is "${own || 'unset'}", and a task may select "${requested}" only on a node configured for it (MESH_LLM_PROVIDER/--provider=${requested}).`;
}

function isOpenClawWorkerProvider(name, env = process.env) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (LOCAL_MODEL_PROVIDERS.has(name)) return allowedLocalWorkers(env).has(name);
  if (MOCK_PROVIDERS.has(name)) return env.MESH_ALLOW_MOCK_WORKERS === '1';
  return true;
}

/**
 * Register a custom provider at runtime.
 * Can be a full config object (with buildArgs function) or
 * a simple config (binary, defaultModel, etc.) for the generic factory.
 */
function registerProvider(name, config) {
  if (config.buildArgs && typeof config.buildArgs === 'function') {
    // Full provider object
    PROVIDERS[name] = { name, cleanEnv: (env) => ({ ...env }), defaultModel: null, ...config };
  } else if (config.binary) {
    // Simple config → use generic factory
    PROVIDERS[name] = makeGenericProvider({ name, ...config });
  } else {
    throw new Error('Provider must have binary (and optionally buildArgs)');
  }
}

/**
 * Load custom providers from ~/.openclaw/mesh-providers.json if it exists.
 * Format: { "provider-name": { "binary": "/path/to/cli", "defaultModel": "model-name", ... } }
 */
function loadCustomProviders() {
  const configPath = path.join(os.homedir(), '.openclaw', 'mesh-providers.json');
  try {
    if (!fs.existsSync(configPath)) return 0;
    const configs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let count = 0;
    for (const [name, config] of Object.entries(configs)) {
      if (PROVIDERS[name]) continue; // don't override built-ins
      registerProvider(name, config);
      count++;
    }
    return count;
  } catch (e) {
    // Silent fail — bad config shouldn't crash the agent
    return 0;
  }
}

// Auto-load custom providers on require()
loadCustomProviders();

module.exports = {
  PROVIDERS,
  resolveProvider: tracer.wrap('resolveProvider', resolveProvider, { tier: 2 }),
  resolveModel: tracer.wrap('resolveModel', resolveModel, { tier: 2 }),
  registerProvider,
  loadCustomProviders,
  makeGenericProvider,
  buildOllamaArgs,
  stripLlmOutput,
  parseClaudeJsonResult,
  isOpenClawWorkerProvider,
  taskProviderRefusal,
  LOCAL_MODEL_PROVIDERS,
};
