/**
 * llm-run.js — the one process runner for agent CLIs, whichever provider.
 *
 * runCli spawns a command in its own process group, keeps a bounded window of
 * its output (the first 256KB and the last 768KB of each stream, with the
 * dropped middle marked and `truncated` set, lib/output-window.js), and on a
 * deadline or an abort signals the whole group (SIGTERM, then SIGKILL after a
 * grace): an agent CLI's tool calls spawn children that a pid-only kill would
 * orphan.
 * Every run is classified, so callers stop reading raw exit codes:
 *
 *   ok            exited 0 with output
 *   empty         exited 0 with no output (after provider parsing)
 *   nonzero       exited with a non-zero code
 *   signaled      killed by a signal it did not get from the deadline
 *   timeout       hit the deadline (whatever it exited with afterwards)
 *   spawn_failed  could not be started (missing binary, not executable)
 *   refused       exited 0 with output its provider's parseOutput marks as no
 *                 run at all (a deprecated CLI's notice); runProvider only
 *
 * exitStatus is the shell-convention status for the run: 124 timeout,
 * 127 command not found, 126 not executable, 128+N killed by signal N,
 * 1 refused.
 *
 * runProvider builds a provider's argv (lib/llm-providers.js), runs it with
 * that provider's environment and working directory, and parses its output.
 */

const { spawn } = require('child_process');
const os = require('os');
const { stripLlmOutput } = require('./llm-providers');
const { createOutputWindow } = require('./output-window');

// Verdicts and reflections are read from the end, artifacts from the start.
const OUTPUT_HEAD = 256 * 1024;
const OUTPUT_TAIL = 768 * 1024;
const MAX_OUTPUT = OUTPUT_HEAD + OUTPUT_TAIL;
const KILL_GRACE_MS = 5000;

function classifyRun({ exitCode, signal, timedOut, spawnError, stdout }) {
  if (spawnError) return 'spawn_failed';
  if (timedOut) return 'timeout';
  if (exitCode === 0) return String(stdout || '').trim() ? 'ok' : 'empty';
  if (exitCode === null && signal) return 'signaled';
  return 'nonzero';
}

function exitStatusFor(run) {
  switch (run.outcome) {
    case 'timeout': return 124;
    case 'spawn_failed': return run.exitCode;
    case 'signaled': return 128 + (os.constants.signals[run.signal] || 0);
    default: return run.exitCode;
  }
}

/**
 * @param {object} o
 * @param {string} o.binary
 * @param {string[]} o.args
 * @param {string} [o.cwd]
 * @param {object} [o.env]
 * @param {number} o.timeoutMs
 * @param {AbortSignal} [o.signal] - aborting stops the whole process group, as the deadline does
 * @param {(child: import('child_process').ChildProcess) => void} [o.onSpawn]
 * @returns {Promise<{exitCode: number|null, signal: string|null, stdout: string, stderr: string,
 *   truncated: boolean, timedOut: boolean, spawnError: string|null, durationMs: number,
 *   outcome: string, exitStatus: number|null}>}
 */
function runCli({ binary, args, cwd, env = process.env, timeoutMs, outputHead = OUTPUT_HEAD, outputTail = OUTPUT_TAIL, killGraceMs = KILL_GRACE_MS, signal: abortSignal, onSpawn }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(binary, args, {
      cwd,
      env,
      // 'ignore', not a pipe: some CLIs wait for stdin to close before they start.
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    // Before onSpawn, so its listeners get decoded text too: a decoder holds a UTF-8
    // sequence split across pipe chunks instead of decoding each half on its own.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    if (onSpawn) onSpawn(child);

    const stdoutWin = createOutputWindow(outputHead, outputTail);
    const stderrWin = createOutputWindow(outputHead, outputTail);
    let timedOut = false;
    let settled = false;

    const signalGroup = (sig) => {
      try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
    };
    const stopGroup = () => {
      signalGroup('SIGTERM');
      // Not cleared on close: the leader can exit on SIGTERM while its children linger.
      setTimeout(() => signalGroup('SIGKILL'), killGraceMs).unref();
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      stopGroup();
    }, timeoutMs);
    if (abortSignal) {
      if (abortSignal.aborted) stopGroup();
      else abortSignal.addEventListener('abort', stopGroup, { once: true });
    }

    child.stdout.on('data', (d) => stdoutWin.push(d));
    child.stderr.on('data', (d) => stderrWin.push(d));

    const finish = (fields) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (abortSignal) abortSignal.removeEventListener('abort', stopGroup);
      const run = {
        stdout: stdoutWin.text(), stderr: stderrWin.text(), truncated: stdoutWin.truncated,
        timedOut, spawnError: null, signal: null, ...fields, durationMs: Date.now() - startedAt,
      };
      run.outcome = classifyRun(run);
      run.exitStatus = exitStatusFor(run);
      resolve(run);
    };

    child.on('close', (code, signal) => finish({ exitCode: code, signal }));
    child.on('error', (err) => {
      const exitCode = err.code === 'ENOENT' ? 127 : 126;
      finish({ exitCode, spawnError: err.message, stderr: stderrWin.text() + err.message });
    });
  });
}

/**
 * Run one prompt through a provider. `cwd` is the caller's default working
 * directory; a provider that must run inside the target (provider.spawnCwd)
 * overrides it. The returned stdout is the provider's parsed answer text,
 * sanitized; the outcome is classified on that text.
 */
async function runProvider(provider, { prompt, model, task = {}, targetDir, workspaceDir = null, cwd, env = process.env, timeoutMs, signal, onSpawn }) {
  const args = provider.buildArgs(prompt, model, task, targetDir, workspaceDir);
  const spawnCwd = provider.spawnCwd ? provider.spawnCwd(targetDir) : cwd;
  const run = await runCli({
    binary: provider.binary,
    args,
    cwd: spawnCwd,
    env: provider.cleanEnv(env),
    timeoutMs,
    signal,
    onSpawn: onSpawn && ((child) => onSpawn(child, { binary: provider.binary, args, cwd: spawnCwd })),
  });
  const parsed = !run.spawnError && provider.parseOutput ? provider.parseOutput(run.stdout) : null;
  if (parsed?.refused && run.outcome === 'ok') {
    const stderr = run.stderr ? `${run.stderr}\n${parsed.refused}` : parsed.refused;
    return { ...run, stdout: stripLlmOutput(run.stdout), stderr, outcome: 'refused', exitStatus: 1, provider: provider.name, model, cost: null };
  }
  const text = stripLlmOutput(parsed ? parsed.text : run.stdout);
  const outcome = classifyRun({ ...run, stdout: text });
  const result = { ...run, stdout: text, outcome, provider: provider.name, model, cost: parsed?.cost ?? null };
  result.exitStatus = exitStatusFor(result);
  return result;
}

module.exports = { runCli, runProvider, classifyRun, exitStatusFor, MAX_OUTPUT, OUTPUT_HEAD, OUTPUT_TAIL, KILL_GRACE_MS };
