/**
 * exec-safety.js — Shared command safety filtering for the commands mesh runs.
 *
 * Consumers:
 *   - validateExecCommand: the harness post_validate command (lib/mesh-harness.js)
 *   - validateMetricCommand: the metric gate (bin/mesh-agent.js, bin/mesh-task-daemon.js)
 *   - containsShellChaining / checkDangerousFlags / checkDestructivePatterns:
 *     the llm-providers shell provider
 *
 * Two layers:
 *   1. DESTRUCTIVE_PATTERNS — blocklist of known-dangerous patterns
 *   2. ALLOWED_EXEC_PREFIXES — allowlist for validateExecCommand
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { createTracer } = require('./tracer');
const tracer = createTracer('exec-safety');

// Shell metacharacter detection — blocks command chaining/injection.
// Safe pipes to common read-only utilities are allowed.
// `&`, `<` and `>` sit in the leading character class so a bare background
// operator (`a & b`) and a space-less redirect (`a>file`) are rejected — the
// previous `&&` / `>\s` alternatives let both through to a `bash -c` sink.
const SHELL_CHAIN_PATTERNS = /[\n\r\0;`&<>]|\$\(|\|\||<\(|>\(|<<|>>|\|(?!\s*grep\b|\s*head\b|\s*tail\b|\s*wc\b|\s*sort\b)/;

function containsShellChaining(cmd) {
  // Allow safe pipes to common read-only utilities
  return SHELL_CHAIN_PATTERNS.test(cmd);
}

// Dangerous flags that allow arbitrary code execution via node
const DANGEROUS_NODE_FLAGS = /\bnode\s+(-e\b|--eval\b|-p\b|--print\b|-r\b|--require\b|--import\b|--loader\b|--experimental-loader\b)/;

// Dangerous git flags that allow arbitrary config / code execution
const DANGEROUS_GIT_FLAGS = /\bgit\s+(-c\s|--config\s)/;

// Dangerous find flags that allow arbitrary command execution
const DANGEROUS_FIND_FLAGS = /\bfind\b.*\s(-exec\b|-execdir\b|-delete\b|-ok\b|-okdir\b)/;

// Dangerous make variable overrides (SHELL=, CC=, etc.)
const DANGEROUS_MAKE_FLAGS = /\bmake\b.*\b(SHELL|CC|CXX|LD|AR)=/;

// Dangerous python flags that allow arbitrary code execution
const DANGEROUS_PYTHON_FLAGS = /\bpython3?\s+(-c\b|-m\s+http)/;

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f/,      // rm -rf, rm -fr, rm --recursive --force
  /\brm\s+(-[a-zA-Z]*)?f[a-zA-Z]*r/,       // rm -fr variants
  /\bmkfs\b/,                                // format filesystem
  /\bdd\s+.*of=/,                            // raw disk write
  /\b>\s*\/dev\/[sh]d/,                      // write to raw device
  /\bcurl\b.*\|\s*(ba)?sh/,                  // curl pipe to shell
  /\bwget\b.*\|\s*(ba)?sh/,                  // wget pipe to shell
  /\bchmod\s+(-[a-zA-Z]*\s+)?777\s+\//,     // chmod 777 on root paths
  /\bsudo\b/,                                // sudo escalation
  /\bsu\s+-?\s/,                             // su user switch
  /\bpasswd\b/,                              // password change
  /\buseradd\b|\buserdel\b/,                 // user management
  /\biptables\b|\bnft\b/,                    // firewall modification
  /\bsystemctl\s+(stop|disable|mask)/,       // service disruption
  /\blaunchctl\s+(unload|remove)/,           // macOS service disruption
  /\bkill\s+-9\s+1\b/,                       // kill init/launchd
  />\s*\/etc\//,                             // overwrite system config
  /\beval\b.*\$\(/,                          // eval with command substitution
];

/**
 * Allowed command prefixes for validateExecCommand (harness post_validate).
 * Commands must also pass the shell-chaining, dangerous-flag and destructive checks.
 */
const ALLOWED_EXEC_PREFIXES = [
  'git ', 'node ', 'python ', 'python3 ',
  'npm test', 'npm run test', 'npm run lint', 'npm run build', 'npm run dev',
  'npm run start', 'npm install', 'npm ci', 'npm ls', 'npm outdated',
  'npm audit', 'npm version', 'npm pack', 'npm run check',
  'npx vitest', 'npx jest', 'npx eslint', 'npx prettier', 'npx tsc',
  'cat ', 'ls ', 'head ', 'tail ', 'grep ', 'find ', 'wc ',
  'echo ', 'date ', 'uptime ', 'df ', 'free ', 'ps ',
  'bash openclaw/', 'bash ~/openclaw/', 'bash ./bin/',
  'pwd', 'which ',
  'cargo ', 'go ', 'make ', 'pytest ', 'jest ', 'vitest ',
];

/**
 * Check if a command matches any destructive pattern.
 * @param {string} command
 * @returns {{ blocked: boolean, pattern?: RegExp }}
 */
function checkDestructivePatterns(command) {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { blocked: true, pattern };
    }
  }
  return { blocked: false };
}

/**
 * Run every dangerous-flag regex against a command.
 * @param {string} command
 * @returns {{ blocked: boolean, reason?: string }}
 */
function checkDangerousFlags(command) {
  if (DANGEROUS_NODE_FLAGS.test(command)) return { blocked: true, reason: 'Dangerous node flag detected' };
  if (DANGEROUS_GIT_FLAGS.test(command)) return { blocked: true, reason: 'Dangerous git flag detected' };
  if (DANGEROUS_FIND_FLAGS.test(command)) return { blocked: true, reason: 'Dangerous find flag detected' };
  if (DANGEROUS_MAKE_FLAGS.test(command)) return { blocked: true, reason: 'Dangerous make variable override detected' };
  if (DANGEROUS_PYTHON_FLAGS.test(command)) return { blocked: true, reason: 'Dangerous python flag detected' };
  return { blocked: false };
}

/**
 * A task's `metric` (the verification command a worker runs after finishing a
 * task) is tokenized and run as argv with no shell, so quoting, `${...}`
 * expansion, pipes and redirects mean nothing. A string filter in front of
 * `bash -c` could be walked past (`node -pe …`, `node --no-warnings -e …`,
 * `node ${x:--pe} …`). Shared by the worker (bin/mesh-agent.js) and the task
 * daemon's submit gate (bin/mesh-task-daemon.js) so the two cannot drift apart.
 *
 * Only test runners run. Every argument that names a path must stay inside the
 * worktree, and the options that load or evaluate code from elsewhere are refused.
 */
const METRIC_PROGRAMS = {
  npm: { subcommands: ['test', 'run'] },
  node: {},
  pytest: {},
  cargo: { subcommands: ['test'] },
  go: { subcommands: ['test'] },
  make: { subcommands: ['test'] },
  jest: {},
  vitest: {},
  mocha: {},
};

// node options before the script. Anything else (-e, -pe, --eval, --print,
// -r, --require, --import, --loader, --inspect, --input-type, ...) is refused.
const NODE_OPTION_ALLOW = /^(--test|--test-only|--no-warnings|--enable-source-maps|--experimental-test-coverage|--test-(name|skip)-pattern=.*|--test-(concurrency|timeout)=\d+|--test-reporter=(spec|tap|dot|junit|lcov))$/;

// Options that make a runner load or run code named on the command line, or
// change how it spawns things. Checked up to a `--` separator.
const flag = (re) => (arg) => re.test(arg);
const METRIC_OPTION_DENY = {
  // npm config flags (script-shell, node-options, prefix, userconfig, ...)
  npm: (arg) => arg.startsWith('-') && !['-s', '--silent', '--if-present'].includes(arg),
  cargo: flag(/^(--config|-Z)/),
  go: flag(/^-(exec|toolexec|ldflags|gcflags|asmflags|overlay|modfile|pkgdir|C)(=|$)/),
  make: flag(/^-|=/),
  mocha: flag(/^(-n|--node-option|-r|--require|--import|--loader)(=|$)/),
  jest: flag(/^(--testRunner|--runner|--testEnvironment|--env|--resolver|--globalSetup|--globalTeardown|--setupFiles|--transform)(=|$)/),
  vitest: flag(/^(--environment|--globalSetup|--setupFiles|--pool)(=|$)/),
  pytest: flag(/^(-p|--pyargs|-o|--override-ini)(=|$)/),
};

const NO_SHELL_CHARS = /[|;&<>`$\\\n\r\0]/;

/** Split a metric into argv: whitespace separates words, '…' and "…" group. Nothing else is interpreted. */
function tokenizeMetric(command) {
  const argv = [];
  let cur = null;
  let quote = null;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur = cur ?? '';
    } else if (/\s/.test(ch)) {
      if (cur !== null) { argv.push(cur); cur = null; }
    } else {
      cur = (cur ?? '') + ch;
    }
  }
  if (quote) return null;
  if (cur !== null) argv.push(cur);
  return argv;
}

/** True when `arg`, or any `=`/`,`-separated piece of it, names a path outside the worktree. */
function escapesWorktree(arg, cwd) {
  for (const piece of arg.split(/[=,]/)) {
    if (piece.startsWith('/') || piece.startsWith('~')) return true;
    if (piece.split('/').includes('..')) return true;
    if (!cwd || !piece) continue;
    let real;
    try { real = fs.realpathSync(path.join(cwd, piece)); } catch { continue; }
    const root = fs.realpathSync(cwd);
    if (real !== root && !real.startsWith(root + path.sep)) return true; // a symlink out
  }
  return false;
}

/**
 * Validate a task metric and return the argv to run with no shell. Fail-closed.
 * With `cwd` (the worker's worktree), paths are also resolved through symlinks.
 * @param {string} command
 * @param {{ cwd?: string }} [opts]
 * @returns {{ allowed: boolean, reason?: string, argv?: string[] }}
 */
function validateMetricCommand(command, { cwd } = {}) {
  const trimmed = (command || '').trim();
  if (!trimmed) return { allowed: false, reason: 'Empty metric' };
  const short = trimmed.slice(0, 80);
  if (NO_SHELL_CHARS.test(trimmed)) {
    return { allowed: false, reason: `Metric runs without a shell (no pipes, redirects, chaining, $ or backslashes): ${short}` };
  }
  const argv = tokenizeMetric(trimmed);
  if (!argv || !argv.length) return { allowed: false, reason: `Metric has unbalanced quotes: ${short}` };

  const [program, ...args] = argv;
  const spec = METRIC_PROGRAMS[program];
  if (!spec) return { allowed: false, reason: `Metric not in allowlist: ${short}` };
  if (spec.subcommands && !spec.subcommands.includes(args[0])) {
    return { allowed: false, reason: `Metric not in allowlist: ${short}` };
  }
  if (program === 'npm' && args[0] === 'run' && (!args[1] || args[1].startsWith('-'))) {
    return { allowed: false, reason: `npm run needs a script name: ${short}` };
  }

  const deny = METRIC_OPTION_DENY[program];
  const endOfOptions = args.includes('--') ? args.indexOf('--') : args.length;
  for (const [i, arg] of args.entries()) {
    if (/^--inspect/.test(arg)) return { allowed: false, reason: `Metric opens an inspector: ${short}` };
    if (escapesWorktree(arg, cwd)) return { allowed: false, reason: `Metric names a path outside the worktree (${arg}): ${short}` };
    if (deny && i < endOfOptions && deny(arg)) {
      return { allowed: false, reason: `Metric option ${arg} is not allowed for ${program}: ${short}` };
    }
  }

  if (program === 'node') {
    let script = -1;
    for (const [i, arg] of args.entries()) {
      if (!arg.startsWith('-')) { script = i; break; }
      if (!NODE_OPTION_ALLOW.test(arg)) return { allowed: false, reason: `node option ${arg} is not allowed in a metric: ${short}` };
    }
    if (script === -1 && !args.includes('--test')) return { allowed: false, reason: `node metric names no script: ${short}` };
  }

  const destructive = checkDestructivePatterns(trimmed);
  if (destructive.blocked) return { allowed: false, reason: `Blocked by destructive pattern: ${destructive.pattern}` };
  return { allowed: true, argv };
}

/**
 * Check if a command starts with an ALLOWED_EXEC_PREFIXES entry.
 * @param {string} command
 * @returns {boolean}
 */
function isAllowedExecCommand(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) return false;
  return ALLOWED_EXEC_PREFIXES.some(p => trimmed.startsWith(p));
}

/**
 * Full validation: blocklist + allowlist.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 * @param {string} command
 * @returns {{ allowed: boolean, reason?: string }}
 */
function validateExecCommand(command) {
  const trimmed = (command || '').trim();
  if (!trimmed) {
    return { allowed: false, reason: 'Empty command' };
  }

  if (containsShellChaining(trimmed)) {
    return { allowed: false, reason: `Command contains shell chaining operators: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_NODE_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous node flag detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_GIT_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous git flag detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_FIND_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous find flag detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_MAKE_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous make variable override detected: ${trimmed.slice(0, 80)}` };
  }

  if (DANGEROUS_PYTHON_FLAGS.test(trimmed)) {
    return { allowed: false, reason: `Dangerous python flag detected: ${trimmed.slice(0, 80)}` };
  }

  const destructive = checkDestructivePatterns(trimmed);
  if (destructive.blocked) {
    return { allowed: false, reason: `Blocked by destructive pattern: ${destructive.pattern}` };
  }

  if (!isAllowedExecCommand(trimmed)) {
    return { allowed: false, reason: `Command not in server-side allowlist: ${trimmed.slice(0, 80)}` };
  }

  return { allowed: true };
}

module.exports = {
  SHELL_CHAIN_PATTERNS,
  DESTRUCTIVE_PATTERNS,
  ALLOWED_EXEC_PREFIXES,
  checkDangerousFlags: tracer.wrap('checkDangerousFlags', checkDangerousFlags, { tier: 2, category: 'compute' }),
  validateMetricCommand: tracer.wrap('validateMetricCommand', validateMetricCommand, { tier: 2, category: 'compute' }),
  tokenizeMetric,
  DANGEROUS_NODE_FLAGS,
  DANGEROUS_GIT_FLAGS,
  DANGEROUS_FIND_FLAGS,
  DANGEROUS_MAKE_FLAGS,
  DANGEROUS_PYTHON_FLAGS,
  checkDestructivePatterns: tracer.wrap('checkDestructivePatterns', checkDestructivePatterns, { tier: 2, category: 'compute' }),
  isAllowedExecCommand: tracer.wrap('isAllowedExecCommand', isAllowedExecCommand, { tier: 2, category: 'compute' }),
  validateExecCommand: tracer.wrap('validateExecCommand', validateExecCommand, { tier: 2, category: 'compute' }),
  containsShellChaining: tracer.wrap('containsShellChaining', containsShellChaining, { tier: 2, category: 'compute' }),
};
