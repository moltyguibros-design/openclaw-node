#!/usr/bin/env node

/**
 * mesh-agent.js — Mesh worker agent for OpenClaw.
 *
 * LLM-agnostic architecture: external wrapper around any LLM CLI.
 * The outer loop is mechanical Node.js code. The inner loop is the LLM.
 * The LLM has no awareness of the mesh — it gets a clean task prompt.
 *
 * Supported LLM backends (via lib/llm-providers.js):
 *   claude  — Anthropic Claude Code CLI
 *   openai  — OpenAI Codex/GPT CLI
 *   shell   — Raw shell execution (no LLM)
 *   (custom providers can be registered at runtime)
 *
 * Flow:
 *   1. Connect to NATS
 *   2. Claim next available task from mesh-task-daemon
 *   3. Construct prompt from task schema
 *   4. Run LLM CLI (non-interactive)
 *   5. Evaluate metric (if defined)
 *   6. If metric fails → log attempt, retry with failure context
 *   7. If metric passes or no metric → report completion
 *   8. If budget exhausted → report failure
 *   9. Loop back to step 2
 *
 * The Karpathy pattern: try → measure → keep/discard → retry.
 * The outer loop is deterministic. The LLM owns the problem-solving.
 *
 * Usage:
 *   node mesh-agent.js                        # run worker (default provider)
 *   node mesh-agent.js --once                 # claim one task, execute, exit
 *   node mesh-agent.js --model sonnet         # override model
 *   node mesh-agent.js --provider openai      # use OpenAI backend
 *   node mesh-agent.js --dry-run              # claim + build prompt, don't execute
 */

const { connect, StringCodec } = require('nats');
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-agent');
const { execSync, execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getSessionInfo } = require('../lib/agent-activity');
const { loadAllRules, matchRules, formatRulesForPrompt, detectFrameworks, activateFrameworkRules } = require('../lib/rule-loader');
const { loadHarnessRules, runMeshHarness, runPostCommitValidation, runPreChecks, formatHarnessForPrompt, preCommitSecretScan } = require('../lib/mesh-harness');
const { validateMetricCommand } = require('../lib/exec-safety');
const { TASK_TERMINAL, TERMINAL_STATES } = require('../lib/mesh-tasks');
const { findRole, formatRoleForPrompt, validateRequiredOutputs } = require('../lib/role-loader');

const sc = StringCodec();
const { NATS_URL, natsConnectOpts, resolveEnvKey } = require('../lib/nats-resolve');
const { PROVIDERS, resolveProvider, resolveModel, isOpenClawWorkerProvider, taskProviderRefusal } = require('../lib/llm-providers');
const { runCli, runProvider } = require('../lib/llm-run');
// One derivation for every daemon (lib/node-id) — the agent must claim tasks
// under the same node_id the task daemon authorizes, or ownership checks fail.
const NODE_ID = require('../lib/node-id').resolveNodeId();
const POLL_INTERVAL = parseInt(process.env.MESH_POLL_INTERVAL || '15000'); // 15s between polls
const MAX_ATTEMPTS = parseInt(process.env.MESH_MAX_ATTEMPTS || '3');
const HEARTBEAT_INTERVAL = parseInt(process.env.MESH_HEARTBEAT_INTERVAL || '60000'); // 60s heartbeat
// Per-agent work dir (cwd for LLM CLIs + home of their session JSONLs) —
// shared across agents it caused cross-attributed cost readings.
const AGENT_WORK_DIR = path.join(os.tmpdir(), `mesh-agent-work-${NODE_ID}`);
const WORKSPACE = process.env.MESH_WORKSPACE || path.join(process.env.HOME, '.openclaw', 'workspace');

// ── Rule loading (cached at startup, framework-filtered) ─────────────────
const RULES_DIR = process.env.OPENCLAW_RULES_DIR || path.join(process.env.HOME, '.openclaw', 'rules');
const HARNESS_PATH = process.env.OPENCLAW_HARNESS_RULES || path.join(process.env.HOME, '.openclaw', 'harness-rules.json');
let cachedRules = null;
let cachedHarnessRules = null;

function getRules() {
  if (!cachedRules) {
    const allRules = loadAllRules(RULES_DIR);
    const detected = detectFrameworks(WORKSPACE);
    cachedRules = activateFrameworkRules(allRules, detected);
  }
  return cachedRules;
}

function getHarnessRules() {
  if (!cachedHarnessRules) {
    cachedHarnessRules = loadHarnessRules(HARNESS_PATH, 'mesh');
  }
  return cachedHarnessRules;
}

// Probes for the harness pre_check stage (no-assume-running): a flush is a
// round trip to the server, so it proves the bus answers, not just that a
// socket object exists.
const PRE_CHECK_PROBES = {
  async nats() {
    if (!nc || nc.isClosed()) throw new Error('connection closed');
    await nc.flush();
  },
};

/**
 * Inject matching coding rules into a prompt parts array based on task scope.
 */
function injectRules(parts, scope, activationText = '') {
  // Path-scoped coding standards
  const matched = matchRules(getRules(), scope || []);
  if (matched.length > 0) {
    debug(`Rules: ${matched.length} matched for scope`);
    parts.push(formatRulesForPrompt(matched));
    parts.push('');
  } else {
    debug(`Rules: 0 matched for scope`);
  }

  // Harness behavioral rules (soft enforcement — LLM-agnostic prompt injection)
  const harnessText = formatHarnessForPrompt(getHarnessRules(), activationText);
  if (harnessText) {
    parts.push(harnessText);
    parts.push('');
  }
}

function taskActivationText(task) {
  return ['task start', 'status: running', task.title, task.description].filter(Boolean).join('\n');
}

function taskTaxonomy(task) {
  return {
    domain: task.domain || task.role || (task.collaboration ? 'collaboration' : 'mesh-task'),
    subdomain: task.subdomain || (task.collaboration ? 'collaboration' : 'solo'),
  };
}

async function prepareHyperagentStrategy(task) {
  try {
    const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
    const store = createHyperAgentStore({ dbPath: process.env.OPENCLAW_STATE_DB || path.join(os.homedir(), '.openclaw', 'state.db') });
    try {
      const { domain, subdomain } = taskTaxonomy(task);
      const strategy = store.getStrategy(domain, subdomain, NODE_ID);
      if (!strategy) return null;
      Object.defineProperty(task, '_hyperagentStrategy', {
        value: strategy,
        configurable: true,
        writable: true,
      });
      log(`HyperAgent strategy selected: id=${strategy.id} domain=${strategy.domain}`);
      return strategy;
    } finally {
      store.close();
    }
  } catch (err) {
    warn(`HyperAgent strategy consultation failed for ${task.task_id}: ${err.message}`);
    return null;
  }
}

function injectHyperagentStrategy(parts, task) {
  const strategy = task?._hyperagentStrategy;
  if (!strategy) return;
  parts.push(`## Approved Strategy (HyperAgent #${strategy.id})`);
  parts.push(strategy.content);
  parts.push('Use this as the starting approach, adapting it when the task evidence requires.');
  parts.push('');
}

function injectSuccessCriteria(parts, task) {
  if (!task.success_criteria?.length) return;
  parts.push('## Success Criteria');
  for (const c of task.success_criteria) parts.push(`- ${c}`);
  parts.push('');
}

function injectRejection(parts, task) {
  if (!task?.rejection_reason) return;
  parts.push('## Previous Review');
  parts.push(`A reviewer rejected an earlier run of this task (rejection ${task.rejection_count || 1}): ${task.rejection_reason}`);
  parts.push('Address this feedback; do not resubmit the same work.');
  parts.push('');
}

// ── Role loading (cached per role ID) ─────────────────
const ROLE_DIRS = [
  path.join(process.env.HOME, '.openclaw', 'roles'),
  path.join(__dirname, '..', 'config', 'roles'),
];
const roleCache = new Map();

function getRole(roleId) {
  if (!roleId) return null;
  if (roleCache.has(roleId)) return roleCache.get(roleId);
  const role = findRole(roleId, ROLE_DIRS);
  if (role) roleCache.set(roleId, role);
  return role;
}

/**
 * Paths the attempt created or modified in its worktree (deletions excluded),
 * read before the commit so MESH_NO_MERGE runs report them too.
 */
function changedFiles(worktreePath) {
  if (!worktreePath) return [];
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain', '-uall', '-z'], { cwd: worktreePath, timeout: 5000, encoding: 'utf-8' });
  } catch (err) {
    warn(`changedFiles: ${err.message}`);
    return [];
  }
  const entries = out.split('\0');
  const files = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2);
    // With -z a rename or copy is followed by its source path as its own entry.
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    if (xy.includes('D')) continue;
    files.push(entry.slice(3));
  }
  return files;
}

/**
 * A role's required_outputs, checked here because the worktree (and so the
 * file contents a content_check reads) exists only on this node. The daemon
 * acts on the verdict. Null when the task's role requires no outputs.
 */
function checkRoleOutputs(task, files, worktreePath) {
  const role = getRole(task.role);
  if (!role?.required_outputs?.length) return null;
  const { passed, failures } = validateRequiredOutputs(role, files, worktreePath);
  return {
    role: role.id,
    passed,
    issues: failures.map(f => `[required_output] ${f.description}: ${f.detail}`),
  };
}

/**
 * Inject role profile into prompt parts array.
 */
function injectRole(parts, roleId) {
  const role = getRole(roleId);
  if (!role) {
    debug(`Role not found: ${roleId}`);
    return;
  }
  debug(`Role injected: ${roleId}`);
  const roleText = formatRoleForPrompt(role);
  if (roleText) {
    parts.push(roleText);
    parts.push('');
  }
}

// 2.4 / D11 / P1: a grappe worker is a harness-loaded OpenClaw, not a bare LLM call, so
// it carries the node's memory into every task. Two tiers:
//   1. Task-relevant recall — query the loopback memory-inject-server (BGE-M3 resident
//      there; no per-call model reload) with the task text, get a query-ranked, budgeted
//      [memory:] block. This is what the main agent already gets.
//   2. Fallback — the node's long-term index (MEMORY.md), mtime-guarded so a long-lived
//      worker never injects a superseded snapshot. Bounded; MESH_MEMORY_INJECT_CHARS=0
//      disables memory entirely.
const MEMORY_INJECT_CAP = Number(process.env.MESH_MEMORY_INJECT_CHARS ?? 4000);
const MEMORY_INJECT_PORT = Number(process.env.MEMORY_INJECT_PORT || 7893);
const MEMORY_INJECT_TOKEN_PATH = path.join(process.env.HOME || '', '.openclaw', 'config', 'memory-injection-token');

// Async with an abort timeout: a synchronous curl here froze the agent's event loop
// (alive checks, heartbeats, NATS) for as long as the inject-server took to answer.
async function recallForTask(task) {
  if (process.env.MESH_MEMORY_RECALL === 'off' || !task) return null;
  const query = [task.title, task.description].filter(Boolean).join('\n').trim().slice(0, 4000);
  if (!query) return null;
  let token;
  try { token = (await fs.promises.readFile(MEMORY_INJECT_TOKEN_PATH, 'utf8')).trim(); } catch { return null; }
  if (!token) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${MEMORY_INJECT_PORT}/memory/inject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt: query }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const { block } = await res.json();
    return (typeof block === 'string' && block.trim()) ? block.trim() : null;
  } catch { return null; }
}

/**
 * Fetch the task-relevant recall before a prompt is built; the builders stay
 * synchronous and read it from the task (like _hyperagentStrategy).
 */
async function prepareMemoryRecall(task) {
  const recalled = MEMORY_INJECT_CAP > 0 ? await recallForTask(task) : null;
  Object.defineProperty(task, '_memoryRecall', { value: recalled, configurable: true, writable: true });
  return recalled;
}

let memCache = { mtime: -1, content: '' };
function readNodeMemory() {
  try {
    const p = path.join(WORKSPACE, 'MEMORY.md');
    const st = fs.statSync(p);
    if (st.mtimeMs !== memCache.mtime) memCache = { mtime: st.mtimeMs, content: fs.readFileSync(p, 'utf8').trim() };
    return memCache.content;
  } catch { return ''; }
}

function injectMemory(parts, task) {
  if (!(MEMORY_INJECT_CAP > 0)) return;
  const recalled = task?._memoryRecall;
  if (recalled) {
    parts.push('## Node memory (task-relevant recall)');
    parts.push('');
    parts.push(recalled.length > MEMORY_INJECT_CAP ? recalled.slice(0, MEMORY_INJECT_CAP) + '\n…(truncated)' : recalled);
    parts.push('');
    return;
  }
  const mem = readNodeMemory();
  if (!mem) return;
  parts.push("## Node memory (long-term index — this OpenClaw's durable context)");
  parts.push('');
  parts.push(mem.length > MEMORY_INJECT_CAP ? mem.slice(0, MEMORY_INJECT_CAP) + '\n…(truncated)' : mem);
  parts.push('');
}

// ── CLI args ──────────────────────────────────────────

const args = process.argv.slice(2);
const ONCE = args.includes('--once');
const DRY_RUN = args.includes('--dry-run');
const CLI_MODEL = (() => {
  const idx = args.indexOf('--model');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();
const CLI_PROVIDER = (() => {
  const idx = args.indexOf('--provider');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
})();
const ENV_PROVIDER = process.env.MESH_LLM_PROVIDER || null;

let nc;
let running = true;
let currentTaskId = null; // tracks active task for alive-check responses
// One task at a time: the claim loop, the recruit broadcast and the recruiting poll
// each take this slot synchronously before their first await. Checking
// currentTaskId and setting it after an await let two of them start a task at once.
let taskSlotHeld = false;

function acquireTaskSlot() {
  if (taskSlotHeld) return false;
  taskSlotHeld = true;
  return true;
}

function releaseTaskSlot() {
  taskSlotHeld = false;
  currentTaskId = null;
  stopRequest = null;
}

// ── Stop notices ──────────────────────────────────────
// mesh.agent.<node>.stall / .budget_exceeded: the daemon's stall sweep and budget
// enforcer, and Mission Control's remove_node, tell this node to stop a task. They
// are signed with the lead's identity because anyone holding the shared bus token
// could otherwise stop any node's work.
const STOP_NOTICES = ['stall', 'budget_exceeded'];
let stopRequest = null; // { task_id, reason } for the task this node holds
let activeWorker = null; // { taskId, stop } while a worker process runs
const stopHooks = new Map(); // task_id → ends a collab round loop waiting between rounds

let _operatorAuth = null;
async function operatorAuth() {
  if (!_operatorAuth) _operatorAuth = await import('../lib/operator-auth.mjs');
  return _operatorAuth;
}

function stoppedFor(taskId) {
  return stopRequest && stopRequest.task_id === taskId ? stopRequest : null;
}

// Path (a): a notice signed by a trusted operator key naming this node and the task it holds.
async function signedStop(notice) {
  const { verifyOperatorRequest, trustedOperatorKeys, stripOperatorEnvelope } = await operatorAuth();
  const trustedKeys = trustedOperatorKeys({ env: resolveEnvKey('OPENCLAW_OPERATOR_TRUSTED_KEYS') || '' });
  const verdict = verifyOperatorRequest(notice, { trustedKeys });
  if (!verdict.ok) return { ok: false, why: verdict.reason };
  const { task_id, target_node_id, reason } = stripOperatorEnvelope(notice);
  // The signature covers the target, so a notice signed for another node cannot be replayed here.
  if (target_node_id !== NODE_ID) return { ok: false, why: `signed for ${target_node_id}, not ${NODE_ID}` };
  if (!task_id || task_id !== currentTaskId) return { ok: false, why: `${task_id} is not the current task (${currentTaskId})` };
  return { ok: true, task_id, reason };
}

const runningHere = (taskId) => !!taskId && (taskId === currentTaskId || activeWorker?.taskId === taskId);

/**
 * One stop notice off the bus. Acts on (a) a valid trusted-operator signature, or
 * (b) the daemon confirming the task is no longer this node's (taskWithdrawn).
 * Anything else is logged and ignored. Returns true when it stopped the task.
 */
async function onStopNotice(kind, notice) {
  let stop = await signedStop(notice);
  if (!stop.ok) {
    const taskId = notice?.task_id;
    if (!runningHere(taskId)) {
      log(`STOP ${kind} ignored: ${stop.why}; ${taskId} is not running here`);
      return false;
    }
    if (!(await taskWithdrawn(taskId))) {
      warn(`STOP ${kind} ${taskId} ignored: ${stop.why}, and the daemon still has it running on this node`);
      return false;
    }
    if (!runningHere(taskId)) return false;
    stop = { ok: true, task_id: taskId, reason: 'the daemon ended this node\'s run' };
  }
  const { task_id } = stop;
  const request = { task_id, kind, reason: `${kind}: ${stop.reason || 'stopped by the daemon'}` };
  if (task_id === currentTaskId) stopRequest = request;
  log(`STOP ${kind}: ${task_id} — ${request.reason}`);
  if (activeWorker?.taskId === task_id) activeWorker.stop();
  const hook = stopHooks.get(task_id);
  if (hook) hook();
  return true;
}

function listenForStops() {
  return STOP_NOTICES.map((kind) => {
    const sub = nc.subscribe(`mesh.agent.${NODE_ID}.${kind}`);
    (async () => {
      for await (const msg of sub) {
        try {
          await onStopNotice(kind, JSON.parse(sc.decode(msg.data)));
        } catch (err) {
          warn(`${kind} notice: ${err.message}`);
        }
      }
    })();
    return sub;
  });
}

// ── Agent State File (read by mesh-health-publisher) ──
const AGENT_STATE_PATH = path.join(os.homedir(), '.openclaw', '.tmp', 'agent-state.json');

function writeAgentState(status, taskId, provider, model) {
  try {
    fs.writeFileSync(AGENT_STATE_PATH, JSON.stringify({
      status, taskId: taskId || null,
      llm: status === 'working' ? (provider || 'unknown') : null,
      model: status === 'working' ? (model || null) : null,
    }));
  } catch { /* best-effort */ }
}

// Cohort provenance (hyperagent-evidence 0.2): derived MECHANICALLY here, the
// single funnel every telemetry write flows through. Priority: an explicit
// valid task.execution_class (cohort/chaos envelopes) → 'shell' provider =
// mock → env OPENCLAW_EXECUTION_CLASS (the 3.5 feeder's blanket) → 'real'.
const EXEC_CLASSES = new Set(['real', 'mock', 'chaos', 'synthetic']);
function deriveExecutionClass(task, providerName) {
  if (EXEC_CLASSES.has(task?.execution_class)) return task.execution_class;
  if (providerName === 'shell') return 'mock';
  if (EXEC_CLASSES.has(process.env.OPENCLAW_EXECUTION_CLASS)) return process.env.OPENCLAW_EXECUTION_CLASS;
  return 'real';
}

async function recordHyperagentTask(task, { outcome, iterations, startedAt, notes, sessionId = null }) {
  try {
    const { createHyperAgentStore } = await import('../lib/hyperagent-store.mjs');
    const store = createHyperAgentStore({ dbPath: process.env.OPENCLAW_STATE_DB || path.join(os.homedir(), '.openclaw', 'state.db') });
    try {
      const { domain, subdomain } = taskTaxonomy(task);
      // Deterministic per task — recomputed here rather than threaded through
      // six call sites. A refused provider override is still what the task
      // asked for: the refusal governs running it, not describing it.
      const workerProvider = taskProviderRefusal(task, CLI_PROVIDER, ENV_PROVIDER)
        ? PROVIDERS[task.llm_provider]
        : resolveProvider(task, CLI_PROVIDER, ENV_PROVIDER);
      const providerName = workerProvider?.name ?? null;
      const model = resolveModel(task, CLI_MODEL, workerProvider) ?? null;
      const row = store.logTelemetry({
        node_id: NODE_ID,
        soul_id: process.env.OPENCLAW_SOUL_ID || NODE_ID,
        task_id: task.task_id,
        domain,
        subdomain,
        strategy_id: task._hyperagentStrategy?.id,
        outcome,
        iterations: Math.max(1, iterations || 1),
        duration_minutes: Math.max(0, (Date.now() - startedAt) / 60000),
        meta_notes: notes,
        run_id: task.run_id ?? process.env.OPENCLAW_HA_RUN_ID ?? null,
        logical_task_id: task.logical_task_id ?? task.parent_task_id ?? task.plan_id ?? task.task_id,
        session_id: sessionId ?? task.collab_session_id ?? null,
        execution_class: deriveExecutionClass(task, providerName),
        collaboration_mode: task.collaboration?.mode ?? null,
        provider: providerName,
        model,
      });
      log(`HyperAgent telemetry: id=${row.id} outcome=${row.outcome} iterations=${row.iterations}`);
    } finally {
      store.close();
    }
  } catch (err) {
    warn(`HyperAgent telemetry failed for ${task.task_id}: ${err.message}`);
  }
}

// ── Logging ───────────────────────────────────────────

const _logger = require('../lib/logger').createLogger('mesh-agent');
_logger.attachTracer(tracer);
const { info: log, warn, error: logError, debug } = _logger;

// ── Foreman supervision (lib/foreman) ─────────────────
// Shadow by default: the supervisor watches the worker as it streams, asks the
// local model the ten fixed questions, runs the deterministic policy, and
// records what it saw and would have done — it never blocks a task. Anything
// failing here degrades to today's behaviour (foreman plan, DECISIONS D1).
// MESH_FOREMAN_ENFORCE=1 lets STOP/ESCALATE act and gates no-metric completion
// on the verifier (D3).

const FOREMAN_ENABLED = process.env.MESH_FOREMAN !== '0';

async function createTaskSupervisor(task, worktreePath) {
  if (!FOREMAN_ENABLED) return null;
  try {
    const foreman = await import('../lib/foreman/index.mjs');
    const config = foreman.foremanConfigFromEnv(process.env);
    const assessor = await foreman.createDefaultAssessor({ model: config.model, timeoutMs: config.assess_timeout_ms });
    const supervisor = foreman.createSupervisor({
      task, nodeId: NODE_ID, worktreePath, assessor, config,
      log: (message) => log(`FOREMAN ${task.task_id}: ${message}`),
      publish: (subject, payload) => nc.publish(subject, sc.encode(JSON.stringify(payload))),
      timelinePath: config.dir ? path.join(config.dir, `${task.task_id}.jsonl`) : null,
    });
    supervisor.start();
    log(`FOREMAN ${task.task_id}: supervising in ${config.enforce ? 'enforce' : 'shadow'} mode (assessor ${assessor.name}, timeline ${config.dir || 'off'})`);
    return supervisor;
  } catch (err) {
    warn(`FOREMAN ${task.task_id}: supervision unavailable — ${err.message}`);
    return null;
  }
}

/**
 * The no-metric completion gate, called after a coding worker exits cleanly and
 * passes the harness. Without enforcement (shadow, or no supervisor) the attempt
 * completes as it always did. Enforcing (D3), it completes only on exactly one
 * well-formed FOREMAN_VERDICT: PASS from an independent verifier that ran to its
 * end unstopped, within the task's remaining budget, and left the worktree and
 * HEAD as it found them — whatever the post-exit assessment says, and whether
 * or not the assessor answered; ESCALATE releases instead. A provider that
 * ignores its prompt (shell) cannot host a verifier: its exit status is the
 * verification, as a metric's would be. Tasks with a metric never come here.
 */
async function foremanVerify(supervisor, task, worktreePath, attempt, llmResult) {
  const complete = { escalate: false, attemptRecord: null };
  if (!supervisor || !supervisor.enforce) return complete;
  const record = (approach, result, escalate = false) => ({
    escalate,
    attemptRecord: { approach: `Attempt ${attempt}: ${approach}`, result: String(result || 'no findings').slice(-500), keep: false },
  });
  let decision = null;
  try {
    decision = await supervisor.assessNow();
  } catch (err) {
    warn(`FOREMAN ${task.task_id}: post-exit assessment failed — ${err.message}`);
  }
  if (decision?.action === 'ESCALATE') {
    return record(`escalated by Foreman after the worker finished — ${decision.reason}`, decision.reason, true);
  }

  const provider = resolveProvider(task, CLI_PROVIDER, ENV_PROVIDER);
  if (provider.acceptsPrompt === false) {
    supervisor.recordVerification({ passed: true, summary: `${provider.name} exited 0; no verifier can take its prompt, so the exit status is the verification`, source: 'exit-code' });
    log(`FOREMAN ${task.task_id}: no verifier for provider ${provider.name} — exit status 0 is the verification`);
    return complete;
  }

  const foreman = await import('../lib/foreman/index.mjs');
  // The tree hash is content only, so a verifier that commits leaves it equal: HEAD is held too.
  const head = () => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath, timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trim();
    } catch {
      return null;
    }
  };
  const before = await foreman.treeSnapshot(worktreePath, { timeoutMs: 60_000 });
  const headBefore = before ? head() : null;
  if (!before || !headBefore) return record('Foreman verifier not run', 'the worktree could not be snapshotted, so a verifier could not be held read-only');
  const { changed_files: changedFiles } = await foreman.gitEvidence(worktreePath);
  // The verifier spends what is left of the task's budget, not a fresh one (F14.5). With none
  // left it is not started: the failed attempt meets the attempt loop's own budget check, which
  // releases the task exactly as it does before an attempt. No deadline: the budget_minutes timeout.
  const deadline = Date.parse(task.budget_deadline);
  const remainingMs = Number.isFinite(deadline) ? deadline - Date.now() : null;
  if (remainingMs !== null && remainingMs <= 0) {
    log(`FOREMAN ${task.task_id}: budget exhausted before the verification pass (attempt ${attempt})`);
    return record('Foreman verifier not run', 'the task budget was exhausted before the verification pass could start');
  }
  log(`FOREMAN ${task.task_id}: independent verification pass (attempt ${attempt})`);
  const verifier = supervisor.workerStarted({ attempt, kind: 'verifier' });
  const result = await runLLM(foreman.buildVerifierPrompt(task, { workerOutput: llmResult.stdout, changedFiles }), task, worktreePath, supervisor, remainingMs);

  // Read-only is checked, not trusted: a changed tree voids the verdict and is put back,
  // so nothing the verifier wrote reaches the commit or the next attempt.
  let tampered = null;
  let movedHead = null;
  const headAfter = head();
  if (headAfter !== headBefore) {
    // Left in place, the verifier's commit makes the status clean: commitWorktree reads that as
    // "no changes" and cleanup deletes the task branch. A soft reset drops the commit and keeps
    // the worker's content for the commit this gate exists to allow.
    try {
      execFileSync('git', ['reset', '--soft', headBefore], { cwd: worktreePath, timeout: 10_000, stdio: 'pipe' });
      movedHead = `the verifier moved HEAD (${headBefore.slice(0, 12)} -> ${headAfter ? headAfter.slice(0, 12) : 'unreadable'}); HEAD was reset, the worker's changes kept`;
    } catch (err) {
      movedHead = `the verifier moved HEAD and resetting it to ${headBefore.slice(0, 12)} failed: ${err.message}`;
    }
  }
  const after = await foreman.treeSnapshot(worktreePath, { timeoutMs: 60_000 });
  if (after !== before) {
    tampered = 'the worktree could not be re-read after the verifier ran';
    if (after) {
      try {
        const touched = await foreman.restoreTree(worktreePath, before, after);
        const reverted = (await foreman.treeSnapshot(worktreePath, { timeoutMs: 60_000 })) === before;
        tampered = `the verifier modified the worktree (${touched.slice(0, 10).join(', ')}${touched.length > 10 ? `, +${touched.length - 10} more` : ''}); ${reverted ? 'its changes were reverted' : 'the revert was incomplete'}`;
      } catch (err) {
        tampered = `the verifier modified the worktree and the revert failed: ${err.message}`;
      }
    }
  }
  if (movedHead) tampered = tampered ? `${movedHead}; ${tampered}` : movedHead;
  const verdict = foreman.parseVerdict(result.stdout, { truncated: result.truncated });
  // Any Foreman stop of the verifier voids its verdict (F14.2): it was cut off mid-check, and
  // a PASS printed before the signal, or the 0 a CLI that traps SIGTERM exits with, proves
  // nothing. ESCALATE releases below; STOP is a failed attempt, retried like any other.
  const stop = supervisor.state.last_stop?.worker_id === verifier.worker_id ? supervisor.state.last_stop : null;
  const passed = !tampered && !stop && verdict.passed === true && result.exitCode === 0;
  const findings = tampered
    || (stop && `Foreman stopped the verification pass before it finished (${stop.reason}); its verdict does not count`)
    || (verdict.verdict ? verdict.summary : `${verdict.reason}. ${verdict.summary || result.stderr.slice(-500)}`);
  supervisor.recordVerification({ passed, summary: findings, source: 'verifier', workerId: verifier.worker_id });
  const outcome = tampered ? 'modified the worktree' : stop ? `stopped — ${stop.reason}` : verdict.verdict ? `${verdict.verdict} (exit ${result.exitCode})` : `returned ${verdict.reason}`;
  log(`FOREMAN ${task.task_id}: verifier ${outcome}`);

  const { cost } = result;
  if (stop?.action === 'ESCALATE') {
    return { ...record(`escalated by Foreman during verification — ${stop.reason}`, stop.reason, true), cost };
  }
  if (passed) return { ...complete, cost };
  return { ...record(`Foreman verifier ${outcome}`, findings), cost };
}

async function closeSupervision(supervisor, outcome) {
  if (!supervisor) return '';
  try {
    await supervisor.close({ outcome });
    const line = supervisor.summaryLine(outcome);
    log(`FOREMAN ${supervisor.state.task_id}: ${line}`);
    return ` ${line}`;
  } catch (err) {
    warn(`FOREMAN close failed: ${err.message}`);
    return '';
  }
}

// ── NATS Helpers ──────────────────────────────────────

async function natsRequest(subject, payload, timeoutMs = 10000) {
  try {
    const msg = await nc.request(subject, sc.encode(JSON.stringify(payload)), { timeout: timeoutMs });
    const response = JSON.parse(sc.decode(msg.data));
    if (!response.ok) {
      warn(`natsRequest ${subject}: ${response.error}`);
      // A TASK_TERMINAL refusal carries the task's status so the caller can stop.
      throw Object.assign(new Error(response.error), { code: response.code, taskStatus: response.status });
    }
    return response.data;
  } catch (err) {
    if (!err.message?.includes(subject)) warn(`natsRequest ${subject}: ${err.message}`);
    throw err;
  }
}

// ── Prompt Construction ───────────────────────────────

/**
 * Build the initial prompt from a task.
 * The LLM gets: what to do, what files to touch, how to verify success.
 * It does NOT get: NATS subjects, mesh protocol, budget deadlines.
 */
function buildInitialPrompt(task) {
  log(`Building initial prompt for ${task.task_id}`);
  const parts = [];

  parts.push(`# Task: ${task.title}`);
  parts.push('');

  if (task.description) {
    parts.push(task.description);
    parts.push('');
  }

  injectSuccessCriteria(parts, task);

  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`## Verification`);
    parts.push(`Run this command to check your work: \`${safeMetric}\``);
    parts.push(`Your changes are only accepted if this command exits with code 0.`);
    parts.push('');
  }

  if (task.scope && task.scope.length > 0) {
    parts.push('## Scope');
    parts.push('Only modify these files/paths:');
    for (const s of task.scope) {
      parts.push(`- ${s}`);
    }
    parts.push('');
  }

  // Inject path-scoped coding rules matching task scope
  injectRules(parts, task.scope, taskActivationText(task));

  // Inject role profile (responsibilities, boundaries, framework)
  injectRole(parts, task.role);
  injectMemory(parts, task);
  injectHyperagentStrategy(parts, task);
  injectRejection(parts, task);

  parts.push('## Instructions');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes. Do not add scope beyond what is asked.');
  parts.push('- If you hit a blocker you cannot resolve, explain what is blocking you clearly.');
  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`- After making changes, run \`${safeMetric}\` to verify.`);
    parts.push('- If verification fails, analyze the failure and iterate on your approach.');
  }

  const prompt = parts.join('\n');
  debug(`Initial prompt: ${prompt.length} chars`);
  return prompt;
}

/**
 * Build a retry prompt after a failed attempt.
 * Includes: what was tried, why it failed, what to try differently.
 */
function buildRetryPrompt(task, previousAttempts, attemptNumber) {
  log(`Building retry prompt for ${task.task_id} (attempt ${previousAttempts.length + 1})`);
  const parts = [];

  parts.push(`# Task: ${task.title} (Attempt ${attemptNumber}/${MAX_ATTEMPTS})`);
  parts.push('');
  parts.push('Previous attempts have not passed verification. Review what was tried and take a different approach.');
  if (attemptNumber >= 3) {
    parts.push('');
    parts.push('**This is attempt 3+. Previous approaches did not work. Try a fundamentally different strategy.**');
    parts.push('Do not iterate on the same idea — rethink the problem from scratch.');
  }
  parts.push('');

  if (task.description) {
    parts.push(task.description);
    parts.push('');
  }

  injectSuccessCriteria(parts, task);

  parts.push('## Previous Attempts');
  for (let i = 0; i < previousAttempts.length; i++) {
    const a = previousAttempts[i];
    parts.push(`### Attempt ${i + 1}`);
    parts.push(`- Approach: ${a.approach || 'unknown'}`);
    parts.push(`- Result: ${a.result || 'unknown'}`);
    // Only a secrets block resets the tree; any other failed attempt's edits are still there.
    parts.push(`- Kept: ${a.keep ? 'yes' : a.reset ? 'no (the worktree was reset to HEAD; its changes are gone)' : 'no (its changes are still in the worktree)'}`);
    parts.push('');
  }

  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`## Verification`);
    parts.push(`Run: \`${safeMetric}\``);
    parts.push(`Must exit code 0.`);
    parts.push('');
  }

  if (task.scope && task.scope.length > 0) {
    parts.push('## Scope');
    parts.push('Only modify these files/paths:');
    for (const s of task.scope) {
      parts.push(`- ${s}`);
    }
    parts.push('');
  }

  // Inject path-scoped coding rules matching task scope
  injectRules(parts, task.scope, taskActivationText(task));

  // Inject role profile (responsibilities, boundaries, framework)
  injectRole(parts, task.role);
  injectMemory(parts, task);
  injectHyperagentStrategy(parts, task);
  injectRejection(parts, task);

  parts.push('## Instructions');
  parts.push('- Do NOT repeat a failed approach. Try something different.');
  parts.push('- Read the relevant files before making changes.');
  parts.push('- Make minimal, focused changes.');
  if (task.metric) {
    const safeMetric = isAllowedMetric(task.metric) ? task.metric : '[metric command filtered for security]';
    parts.push(`- Run \`${safeMetric}\` to verify before finishing.`);
  }

  return parts.join('\n');
}

// ── Worktree Isolation ────────────────────────────────

const WORKTREE_BASE = process.env.MESH_WORKTREE_BASE || path.join(process.env.HOME, '.openclaw', 'worktrees');
const LEASE_DIR = process.env.MESH_LEASE_DIR || path.join(process.env.HOME, '.openclaw', 'mesh-leases');

/**
 * Create a git worktree for a task. Returns the worktree path.
 * Each task gets an isolated branch and working directory.
 * On failure, returns null (falls back to shared workspace).
 */
function createWorktree(taskId) {
  if (!/^[\w][\w.-]{0,127}$/.test(taskId)) {
    throw new Error(`Invalid taskId: contains unsafe characters`);
  }
  const worktreePath = path.join(WORKTREE_BASE, taskId);
  const branch = `mesh/${taskId}`;

  try {
    fs.mkdirSync(WORKTREE_BASE, { recursive: true });

    // Clean up stale worktree if it exists from a previous crashed attempt
    if (fs.existsSync(worktreePath)) {
      log(`Cleaning stale worktree: ${worktreePath}`);
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: WORKSPACE, timeout: 10000 });
      } catch (err) {
        warn(`git worktree remove failed for ${worktreePath}: ${err.message} — cleaning up manually`);
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }
    // A branch kept without its directory (pending_review keep, then a rejection
    // notice missed while offline) would make `worktree add -b` refuse.
    forgetLease(taskId);
    try {
      execFileSync('git', ['branch', '-D', branch], { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' });
    } catch { /* Intentional: no such branch */ }

    // Create new worktree branched off HEAD
    execFileSync('git', ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], {
      cwd: WORKSPACE,
      timeout: 30000,
      stdio: 'pipe',
    });

    log(`Worktree created: ${worktreePath} (branch: ${branch})`);
    return worktreePath;
  } catch (err) {
    // Callers are fail-closed (D14 rerun): null means the task/member must
    // fail or withdraw, never run in the shared tree.
    log(`WORKTREE FAILED: ${err.message} — isolation unavailable`);
    return null;
  }
}

/**
 * Commit any changes in the worktree onto its `mesh/<taskId>` branch.
 * Returns { committed, sha, branch } or null if nothing to commit.
 *
 * Merge-after-review (P4-4): this used to commit AND merge into main before
 * the daemon had decided whether the task needs human review — a rejected
 * task had already landed on main. Now the commit stays on its branch; the
 * merge is a separate step (mergeTaskBranch) that runs only once the daemon
 * reports the task `completed` (auto-approved or human-approved).
 */
function commitWorktree(worktreePath, taskId, summary) {
  if (!worktreePath) return null;
  // Benchmark isolation (D14): bench agents run with MESH_NO_MERGE=1 — the
  // deliverable is the artifact text; incidental worktree writes must never
  // land on main.
  if (process.env.MESH_NO_MERGE === '1') {
    log(`MESH_NO_MERGE: skipping commit/merge for ${taskId} (benchmark isolation)`);
    return { committed: false, merged: false, skipped: 'MESH_NO_MERGE' };
  }
  const branch = `mesh/${taskId}`;

  try {
    // Check for changes
    const status = execSync('git status --porcelain', {
      cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
    }).trim();

    if (!status) {
      log(`Worktree has no changes to commit (${taskId})`);
      return null;
    }

    // Stage and commit all changes
    execSync('git add -A', { cwd: worktreePath, timeout: 10000, stdio: 'pipe' });
    const commitMsg = `mesh(${taskId}): ${(summary || 'task completed').slice(0, 72)}`;

    // Pre-commit validation: check conventional commit format before committing
    const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf|revert|mesh)(\(.+\))?: .+/;
    if (!conventionalPattern.test(commitMsg)) {
      log(`WARNING: commit message doesn't follow conventional format: "${commitMsg}"`);
    }

    execFileSync('git', ['commit', '-m', commitMsg], {
      cwd: worktreePath, timeout: 10000, stdio: 'pipe',
    });

    const sha = execSync('git rev-parse --short HEAD', {
      cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
    }).trim();

    log(`Committed ${sha} on ${branch}: ${commitMsg}`);
    return { committed: true, merged: false, sha, branch };
  } catch (err) {
    log(`Commit warning: ${err.message}`);
    return null;
  }
}

/**
 * Commit leftover work for post-mortem. Unlike a completion, it never went through the
 * harness, so it gets the harness's secret scan here; a finding skips the commit and
 * returns { blocked: true }, and the caller drops the branch with the worktree.
 */
function commitPartialWork(worktreePath, taskId, summary) {
  const scan = preCommitSecretScan(worktreePath);
  if (scan.blocked) {
    warn(`${taskId}: partial work not committed, secret scan found: ${scan.findings.join('; ')}`);
    return { committed: false, blocked: true };
  }
  return commitWorktree(worktreePath, taskId, summary);
}

/** Put the task worktree back to its HEAD, untracked files included. Returns whether it worked. */
function resetWorktree(worktreePath) {
  try {
    execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: worktreePath, timeout: 10000, stdio: 'pipe' });
    execFileSync('git', ['clean', '-fd'], { cwd: worktreePath, timeout: 10000, stdio: 'pipe' });
    return true;
  } catch (err) {
    warn(`worktree reset failed (${worktreePath}): ${err.message}`);
    return false;
  }
}

/**
 * Merge `mesh/<taskId>` into main (from the workspace). Called only after the
 * daemon reports the task completed. Returns { merged, sha, conflict }.
 * Parallel collab: multiple nodes may merge concurrently. If the first attempt
 * fails (e.g., another node merged first), retry once after pulling.
 */
function mergeTaskBranch(taskId) {
  const branch = `mesh/${taskId}`;
  let sha = null;
  try {
    sha = execFileSync('git', ['rev-parse', '--short', branch], {
      cwd: WORKSPACE, timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
    }).trim();
  } catch {
    log(`mergeTaskBranch: branch ${branch} does not exist — nothing to merge`);
    return { merged: false, sha: null, missing: true };
  }
  const mergeMsg = `Merge ${branch}: ${taskId}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      execFileSync('git', ['merge', '--no-ff', branch, '-m', mergeMsg], {
        cwd: WORKSPACE, timeout: 30000, stdio: 'pipe',
      });
      log(`Merged ${branch} into main${attempt > 0 ? ' (retry succeeded)' : ''}`);
      return { merged: true, sha };
    } catch (mergeErr) {
      try { execSync('git merge --abort', { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' }); } catch { /* no merge in progress */ }
      if (attempt === 0) {
        // First failure: pull and retry (handles race with parallel merge)
        try {
          log(`Merge attempt 1 failed for ${branch} — fast-forward pulling and retrying`);
          execSync('git pull --ff-only', { cwd: WORKSPACE, timeout: 15000, stdio: 'pipe' });
        } catch { /* best effort pull */ }
      } else {
        // Second failure: real conflict — keep branch for human resolution
        log(`MERGE CONFLICT on ${branch} — branch kept for manual resolution`);
        return { merged: false, sha, conflict: true };
      }
    }
  }
  return { merged: false, sha };
}

/**
 * Post-completion merge step shared by the completion paths. `completedTask`
 * is the daemon's reply to mesh.tasks.complete: `completed` means the task
 * was auto-approved (metric passed, no review) and may merge now;
 * `pending_review` means the branch stays put until approve/reject arrives.
 * Returns true when the branch must be KEPT (unmerged) after cleanup.
 */
async function mergeIfApproved(task, commit, completedTask) {
  if (!commit?.committed) return false;
  rememberLease(task.task_id, task.lease_token);
  if (completedTask?.status !== 'completed') {
    log(`Branch ${commit.branch} kept unmerged — task ${task.task_id} is ${completedTask?.status || 'unknown'} (merge after review)`);
    return true;
  }
  const merge = mergeTaskBranch(task.task_id);
  await reportMerge(task.task_id, { ...merge, branch: commit.branch, lease_token: task.lease_token });
  return !merge.merged;
}

async function reportMerge(taskId, merge) {
  try {
    await natsRequest('mesh.tasks.merged', {
      task_id: taskId, node_id: NODE_ID, lease_token: merge.lease_token || null,
      sha: merge.sha || null, merged: !!merge.merged, conflict: !!merge.conflict, branch: merge.branch || `mesh/${taskId}`,
    });
  } catch (err) {
    warn(`reportMerge ${taskId}: ${err.message}`);
  }
}

function deleteTaskBranch(taskId) {
  forgetLease(taskId);
  try {
    execFileSync('git', ['branch', '-D', `mesh/${taskId}`], { cwd: WORKSPACE, timeout: 5000, stdio: 'ignore' });
    log(`Deleted branch mesh/${taskId}`);
  } catch { /* already gone */ }
}

// mesh.tasks.merged is an owner action fenced by the claim-time lease token,
// and the daemon no longer returns that token on mesh.tasks.get (review
// 2026-09-15 F1/R1). So the agent keeps the lease of each committed task branch
// itself, in a 0600 file written with fs (a git argv would show it in ps),
// dropped wherever the branch is deleted. The file name is a hash: task ids
// on review notices come off the bus.
function leaseFile(taskId) {
  return path.join(LEASE_DIR, crypto.createHash('sha256').update(String(taskId)).digest('hex'));
}

function rememberLease(taskId, leaseToken) {
  if (!leaseToken) return;
  try {
    fs.mkdirSync(LEASE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(leaseFile(taskId), leaseToken, { mode: 0o600 });
  } catch (err) {
    warn(`rememberLease ${taskId}: ${err.message} — a post-review merge report will be refused`);
  }
}

function keptLease(taskId) {
  try {
    return fs.readFileSync(leaseFile(taskId), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function forgetLease(taskId) {
  try { fs.unlinkSync(leaseFile(taskId)); } catch { /* none kept */ }
}

function describeReviewState(task) {
  return task ? `${task.status}, owner ${task.owner || 'none'}` : 'no such task, or the daemon did not answer';
}

// The review notices below arrive as plain core publishes that any bus peer can
// send. Acting on the notice alone let a forged `.approved` merge unreviewed
// work onto main, and a forged `.rejected` destroy work awaiting review (review
// 2026-09-15 F1). Each one now acts only after the daemon itself reports the
// matching state for a task this node owns.
// A collab member's contribution sits on mesh/<task>-<node> whoever claimed the
// parent, so membership, not ownership, decides which branch is this node's.
function collabBranchId(taskId) {
  return `${taskId}-${NODE_ID}`;
}

function isCollabTask(task) {
  return !!(task && (task.collab_session_id || task.collaboration));
}

function collabRejected(task) {
  return task.rejection_count > 0 && (task.status === 'queued' || task.status === 'failed');
}

function mergeCollabContribution(taskId) {
  const id = collabBranchId(taskId);
  const merge = mergeTaskBranch(id);
  if (merge.missing) return false;
  log(`APPROVED ${taskId} — collab contribution mesh/${id} ${merge.merged ? 'merged' : 'kept (merge failed)'}`);
  if (merge.merged) deleteTaskBranch(id);
  return true;
}

async function onReviewApproved(taskId) {
  const task = await natsRequest('mesh.tasks.get', { task_id: taskId }, 5000).catch(() => null);
  if (isCollabTask(task) && task.status === 'completed') return mergeCollabContribution(taskId);
  if (!task || task.owner !== NODE_ID || task.status !== 'completed') {
    warn(`APPROVED ${taskId} ignored — daemon reports ${describeReviewState(task)}`);
    return false;
  }
  log(`APPROVED ${taskId} — merging kept branch`);
  const merge = mergeTaskBranch(taskId);
  await reportMerge(taskId, { ...merge, lease_token: keptLease(taskId) });
  if (merge.merged) deleteTaskBranch(taskId);
  return true;
}

// A review rejection re-queues the task, or fails it at the rejection cap. In
// both cases the daemon keeps the owner and counts the rejection.
async function onReviewRejected(taskId) {
  const task = await natsRequest('mesh.tasks.get', { task_id: taskId }, 5000).catch(() => null);
  if (isCollabTask(task) && collabRejected(task)) {
    log(`REJECTED ${taskId} — dropping kept collab contribution`);
    deleteTaskBranch(collabBranchId(taskId));
    return true;
  }
  const rejected = task && task.owner === NODE_ID && task.rejection_count > 0
    && (task.status === 'queued' || task.status === 'failed');
  if (!rejected) {
    warn(`REJECTED ${taskId} ignored — daemon reports ${describeReviewState(task)}`);
    return false;
  }
  log(`REJECTED ${taskId} — dropping kept branch`);
  deleteTaskBranch(taskId);
  return true;
}

// An unsigned (or not-for-us) stop notice is still acted on when the daemon
// itself confirms it: the task ended, or is no longer this node's (another
// owner, or, for a collab member, no live seat in its session). A forged notice
// therefore cannot kill a healthy worker.
async function taskWithdrawn(taskId) {
  const task = await natsRequest('mesh.tasks.get', { task_id: taskId }, 5000).catch(() => null);
  if (!task) return false;
  if (TERMINAL_STATES.has(task.status)) return true;
  if (task.owner === NODE_ID) return false;
  if (!isCollabTask(task)) return true;
  if (!task.collab_session_id) return false;
  const session = await natsRequest('mesh.collab.status', { session_id: task.collab_session_id }, 5000).catch(() => null);
  if (!session) return false;
  if (session.status === 'completed' || session.status === 'aborted') return true;
  const seat = (session.nodes || []).find(n => n.id === NODE_ID);
  return !seat || seat.status === 'dead';
}

// Partial-work branches of released and budget/stall-failed tasks are kept for
// post-mortem until an operator deletes them or their tip is older than this
// (0 keeps them indefinitely).
const KEPT_BRANCH_MAX_DAYS = Number(process.env.MESH_KEPT_BRANCH_MAX_DAYS ?? 30);

function branchAgeDays(branch) {
  try {
    const committed = Number(execFileSync('git', ['log', '-1', '--format=%ct', branch], {
      cwd: WORKSPACE, timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
    }).trim());
    return (Date.now() / 1000 - committed) / 86400;
  } catch { return 0; }
}

/**
 * Startup reconciliation: an approval published while this agent was offline
 * is lost (core NATS publish), so every kept `mesh/<taskId>` branch is checked
 * against the daemon — completed → merge now; cancelled or review-rejected →
 * drop; released or otherwise failed → keep for post-mortem until the age cap;
 * pending_review → leave for the reviewer.
 */
async function reconcileKeptBranches() {
  let branches = [];
  try {
    // execFile, not a shell: an unquoted %(refname:short) is a sh syntax error,
    // so this listing always threw and startup reconcile never ran.
    branches = execFileSync('git', ['branch', '--list', 'mesh/*', '--format=%(refname:short)'], {
      cwd: WORKSPACE, timeout: 5000, encoding: 'utf-8', stdio: 'pipe',
    }).split('\n').map(b => b.trim()).filter(Boolean);
  } catch (err) {
    debug(`reconcileKeptBranches: ${err.message}`);
    return;
  }
  for (const branch of branches) {
    const taskId = branch.slice('mesh/'.length);
    if (await reconcileCollabBranch(branch, taskId)) continue;
    let task;
    try { task = await natsRequest('mesh.tasks.get', { task_id: taskId }, 5000); } catch { continue; }
    if (!task || task.owner !== NODE_ID) continue;
    if (task.status === 'completed' && task.result?.merged !== true) {
      log(`RECONCILE: ${branch} approved while offline — merging`);
      const merge = mergeTaskBranch(taskId);
      await reportMerge(taskId, { ...merge, branch, lease_token: keptLease(taskId) });
      if (merge.merged) deleteTaskBranch(taskId);
    } else if (task.status === 'cancelled' || (task.status === 'failed' && task.rejection_count > 0)) {
      deleteTaskBranch(taskId);
    } else if (['failed', 'released'].includes(task.status) && KEPT_BRANCH_MAX_DAYS > 0
        && branchAgeDays(branch) > KEPT_BRANCH_MAX_DAYS) {
      log(`RECONCILE: ${branch} kept for post-mortem over ${KEPT_BRANCH_MAX_DAYS}d — dropping`);
      deleteTaskBranch(taskId);
    }
  }
}

// A kept collab contribution (mesh/<task>-<this node>) follows its parent's
// review: approved → merge, rejected or ended → drop, pending → leave.
async function reconcileCollabBranch(branch, branchId) {
  const suffix = `-${NODE_ID}`;
  if (!branchId.endsWith(suffix)) return false;
  const parentId = branchId.slice(0, -suffix.length);
  let parent;
  try { parent = await natsRequest('mesh.tasks.get', { task_id: parentId }, 5000); } catch { return false; }
  if (!isCollabTask(parent)) return false;
  if (parent.status === 'completed') {
    log(`RECONCILE: ${branch} approved while offline — merging`);
    mergeCollabContribution(parentId);
  } else if (collabRejected(parent) || ['failed', 'released', 'cancelled'].includes(parent.status)) {
    deleteTaskBranch(branchId);
  }
  return true;
}

/**
 * Clean up a worktree after task completion or failure.
 * @param {string} worktreePath
 * @param {boolean} keep - If true, leave the branch for manual review
 */
function cleanupWorktree(worktreePath, keep = false) {
  if (!worktreePath || !worktreePath.startsWith(WORKTREE_BASE)) return;

  const taskId = path.basename(worktreePath);
  const branch = `mesh/${taskId}`;

  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: WORKSPACE,
      timeout: 10000,
      stdio: 'pipe',
    });
    if (!keep) {
      forgetLease(taskId);
      execFileSync('git', ['branch', '-D', branch], {
        cwd: WORKSPACE,
        timeout: 5000,
        stdio: 'ignore',
      });
    }
    log(`Worktree cleaned: ${worktreePath} (branch ${keep ? 'kept' : 'deleted'})`);
  } catch (err) {
    log(`Worktree cleanup warning: ${err.message}`);
  }
}

// ── LLM Execution ────────────────────────────────────

/**
 * Run an LLM CLI with a prompt through the shared runner (lib/llm-run.js).
 * Returns { exitCode, stdout, stderr, truncated, provider, model, cost, outcome }.
 * LLM-agnostic: provider is resolved per-task from task.llm_provider, env, or CLI flag.
 * Sends heartbeats to the daemon every HEARTBEAT_INTERVAL to prevent stall detection.
 *
 * @param {string} prompt
 * @param {object} task
 * @param {string|null} worktreePath - If set, LLM accesses this worktree instead of WORKSPACE
 */
async function runLLM(prompt, task, worktreePath, supervisor = null, timeoutMs = null) {
  const provider = resolveProvider(task, CLI_PROVIDER, ENV_PROVIDER);
  const model = resolveModel(task, CLI_MODEL, provider);
  const targetDir = worktreePath || WORKSPACE;

  // Clean per-agent temp cwd: avoids loading workspace config files AND
  // keeps each agent's Claude session JSONLs private — with a shared dir,
  // concurrent agents misattribute each other's cost (getSessionInfo reads
  // the latest session file in this cwd's project dir).
  const cleanCwd = AGENT_WORK_DIR;
  if (!fs.existsSync(cleanCwd)) fs.mkdirSync(cleanCwd, { recursive: true });

  // Heartbeat: renews the lease and keeps the daemon's stall detector quiet.
  let lastHeartbeatWarn = 0;
  const heartbeatTimer = setInterval(async () => {
    try {
      await natsRequest('mesh.tasks.heartbeat', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token });
    } catch (err) {
      if (!lastHeartbeatWarn || Date.now() - lastHeartbeatWarn > 60000) {
        warn(`heartbeat: ${err.message}`);
        lastHeartbeatWarn = Date.now();
      }
    }
  }, HEARTBEAT_INTERVAL);

  // A confirmed stop notice (onStopNotice) aborts the run: the runner stops the whole process group.
  const stop = new AbortController();
  const worker = { taskId: task.task_id, stop: () => stop.abort() };
  activeWorker = worker;
  if (stoppedFor(task.task_id)) stop.abort();

  let run;
  try {
    run = await runProvider(provider, {
      prompt, model, task, targetDir,
      // D14: an isolated task sees ONLY its worktree — passing WORKSPACE too
      // gave every worker read access to the dirty parent checkout (uncommitted
      // edits leaked into artifacts, and reproducibility died with them).
      workspaceDir: worktreePath ? null : WORKSPACE,
      cwd: cleanCwd,
      // The verifier passes what is left of the task deadline (F14.5).
      timeoutMs: timeoutMs ?? (task.budget_minutes || 30) * 60 * 1000,
      signal: stop.signal,
      onSpawn(child, { binary, args }) {
        log(`Spawning [${provider.name}]: ${binary} ${args.slice(0, 6).join(' ')} ... (target: ${worktreePath ? 'worktree' : 'workspace'})`);
        if (supervisor) supervisor.attach(child);
      },
    });
  } finally {
    clearInterval(heartbeatTimer);
    if (activeWorker === worker) activeWorker = null;
  }
  if (supervisor) supervisor.workerExited({ exitCode: run.exitCode, signal: run.signal });
  if (run.outcome !== 'ok') log(`[${provider.name}] run outcome: ${run.outcome} (exit status ${run.exitStatus})`);
  if (run.truncated) warn(`${task.task_id}: ${provider.name} output exceeded the 1MB capture cap; its middle was dropped and it carries no verdict`);
  return { exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr, truncated: run.truncated, provider: provider.name, model, cost: run.cost, outcome: run.outcome };
}

// ── Metric Evaluation ─────────────────────────────────

// The metric filter lives in lib/exec-safety.js (validateMetricCommand) so the
// worker and the task daemon's submit gate share one hardened definition. The
// previous inline copy did not block a bare `&` or a space-less `>file`.
function isAllowedMetric(cmd) {
  return validateMetricCommand(cmd).allowed;
}

/**
 * Run the task's metric command. Returns { passed, output }.
 */
async function evaluateMetric(metric, cwd, { timeoutMs = 60000 } = {}) {
  const dir = cwd || WORKSPACE;
  const check = validateMetricCommand(metric, { cwd: dir });
  if (!check.allowed) {
    log(`WARNING: Metric command blocked by security filter: ${metric} (${check.reason})`);
    return { passed: false, output: `Metric command blocked by security filter: ${check.reason}` };
  }
  const [program, ...args] = check.argv;
  const run = await runCli({ binary: program, args, cwd: dir, timeoutMs });
  const output = run.stdout + (run.stderr ? (run.stdout ? '\n' : '') + run.stderr : '');
  // Not outcome === 'ok': a metric that exits 0 without printing classifies as 'empty' and passes.
  return { passed: run.exitCode === 0 && !run.timedOut && !run.spawnError, output: output.slice(-2000) };
}

// ── Collab Prompt Construction ────────────────────────

/**
 * Build a prompt for a collaborative round.
 * Includes: task description, round number, shared intel from previous round, scope.
 */
function buildCollabPrompt(task, roundNumber, sharedIntel, myScope, myRole, roundRole) {
  log(`Building collab prompt: round=${roundNumber || 0} mode=${task.collaboration?.mode}`);
  const parts = [];

  parts.push(`# Task: ${task.title} (Collaborative Round ${roundNumber})`);
  parts.push('');
  parts.push(`You are working on this task as part of a **${task.collaboration.mode}** collaboration with other nodes.`);
  parts.push(`Your role: **${myRole}**`);
  parts.push('');

  if (task.description) {
    parts.push(task.description);
    parts.push('');
  }

  if (roundNumber > 1 && sharedIntel) {
    parts.push('## Shared Intelligence from Previous Round');
    parts.push('Other nodes shared the following reflections. Use this to inform your work:');
    parts.push('');
    parts.push(sharedIntel);
    parts.push('');
  }

  if (myScope && myScope !== '*' && Array.isArray(myScope) && myScope[0] !== '*') {
    const isReviewOnly = isReviewOnlyScope(myScope);
    if (isReviewOnly) {
      parts.push('## Your Scope (REVIEW ONLY)');
      parts.push('You are a **reviewer**. Read and analyze these files but do NOT modify them:');
      for (const s of myScope) {
        parts.push(`- ${s.replace('[REVIEW-ONLY] ', '')}`);
      }
      parts.push('');
      parts.push('Your job is to review the leader\'s changes, identify issues, and report findings in your reflection.');
      parts.push('Do NOT write or edit any files. Focus on code review, correctness, and security analysis.');
      parts.push('');
    } else {
      parts.push('## Your Scope');
      parts.push('Only modify these files/paths:');
      for (const s of myScope) {
        parts.push(`- ${s}`);
      }
      parts.push('');
    }
  }

  // Inject path-scoped coding rules matching task scope
  const collabScope = Array.isArray(myScope) ? myScope.map(s => s.replace('[REVIEW-ONLY] ', '')) : task.scope;
  injectRules(parts, collabScope, taskActivationText(task));
  injectRole(parts, task.role);
  injectMemory(parts, task);
  injectHyperagentStrategy(parts, task);
  injectRejection(parts, task);
  injectSuccessCriteria(parts, task);

  parts.push('## Instructions');
  if (roundRole === 'integrator') {
    // Cooperative (3.2): this round's integrator synthesizes the proposals.
    parts.push('- You are THIS ROUND\'S INTEGRATOR. Read the other nodes\' proposals in the shared intelligence above.');
    parts.push('- Synthesize them into ONE coherent integrated artifact — merge the best of each, resolve conflicts, do not just concatenate.');
    parts.push('- Your reflection `summary` is the integrated result other rounds build on.');
  } else if (roundRole === 'proposer') {
    parts.push('- You are a PROPOSER this round. Contribute your own distinct proposal/approach to the shared goal.');
    parts.push('- Differentiate from what other nodes are likely to propose; the integrator will merge all proposals.');
  } else if (roundRole === 'subtask_worker') {
    // Collaborative (3.3): work your partitioned slice in parallel.
    parts.push('- You own ONE SUBTASK of a decomposed task (your scope above is your slice). Complete only your slice, fully.');
    parts.push('- Work independently and in parallel with the other nodes; do not touch their slices.');
    parts.push('- Your reflection `summary` is your subtask result — the merger will assemble all subtasks.');
  } else if (roundRole === 'merger') {
    parts.push('- You are the MERGER. The shared intelligence above holds every node\'s subtask result.');
    parts.push('- Assemble them into ONE coherent merged artifact — reconcile seams, remove overlap, ensure the whole is consistent.');
    parts.push('- Your reflection `summary` is the merged deliverable.');
  } else if (roundRole === 'merge_reviewer') {
    parts.push('- You are a MERGE-REVIEWER. Review the assembled subtasks for coherence, gaps, and conflicts.');
    parts.push('- Vote `converged` if the merge is sound, `continue` if it needs another pass, `blocked` on a critical defect.');
  } else {
    parts.push('- Read the relevant files before making changes.');
    parts.push('- Make minimal, focused changes within your scope.');
    parts.push('- Focus on YOUR contribution — other nodes handle their parts.');
  }
  if (roundNumber > 1) {
    parts.push('- Incorporate learnings from the shared intelligence above.');
  }
  parts.push('');

  parts.push('## After You Finish');
  parts.push('At the very end of your response, output ONLY a JSON reflection block.');
  parts.push('This block MUST be the last thing in your output, wrapped in triple backticks with `json` language tag.');
  parts.push('Do NOT add any text after this block.');
  parts.push('');
  parts.push('```json');
  parts.push('{');
  parts.push('  "reflection": {');
  parts.push('    "summary": "1-2 sentences: what you did this round",');
  parts.push('    "learnings": "what you discovered that other nodes should know",');
  parts.push('    "confidence": 0.85,');
  parts.push('    "vote": "continue"');
  parts.push('  }');
  parts.push('}');
  parts.push('```');
  parts.push('');
  parts.push('Rules for the reflection block:');
  parts.push('- `confidence`: a number between 0.0 and 1.0');
  parts.push('- `vote`: exactly one of `"continue"`, `"converged"`, or `"blocked"`');
  parts.push('- `summary` and `learnings`: plain strings, no nested objects');
  parts.push('- The JSON must be valid. No trailing commas, no comments.');

  return parts.join('\n');
}

/**
 * Parse a JSON reflection block from Claude's output.
 * Returns { summary, learnings, confidence, vote, parse_failed }.
 *
 * On parse failure: parse_failed=true, vote='parse_error' (never silent 'continue').
 * The caller and convergence logic can distinguish real votes from parse failures.
 */
const VALID_VOTES = new Set(['continue', 'converged', 'blocked']);

function parseReflection(output, { truncated = false } = {}) {
  // A spliced capture can pair a block from the head with a vote from the tail: no vote at all.
  if (truncated) {
    log('REFLECTION PARSE FAILED: output exceeded the capture cap');
    return { summary: 'output exceeded the 1MB capture cap; reflection not parsed', learnings: '', confidence: 0.5, vote: 'parse_error', parse_failed: true };
  }
  // Strategy: find the last ```json ... ``` block in the output
  const jsonBlocks = [...output.matchAll(/```json\s*\n([\s\S]*?)```/g)];

  if (jsonBlocks.length > 0) {
    const lastBlock = jsonBlocks[jsonBlocks.length - 1][1].trim();
    try {
      const parsed = JSON.parse(lastBlock);
      const r = parsed.reflection || parsed;

      const summary = typeof r.summary === 'string' ? r.summary : '';
      const learnings = typeof r.learnings === 'string' ? r.learnings : '';
      const confidence = typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
        ? r.confidence : null;
      const vote = typeof r.vote === 'string' && VALID_VOTES.has(r.vote.toLowerCase())
        ? r.vote.toLowerCase() : null;

      if (vote === null || confidence === null) {
        log(`REFLECTION PARSE: JSON found but invalid fields (vote=${r.vote}, confidence=${r.confidence})`);
        return {
          summary: summary || output.slice(-300),
          learnings,
          confidence: confidence ?? 0.5,
          vote: vote ?? 'parse_error',
          parse_failed: true,
        };
      }

      debug(`Reflection parsed: vote=${vote} confidence=${confidence}`);
      return { summary, learnings, confidence, vote, parse_failed: false };
    } catch (err) {
      log(`REFLECTION PARSE: JSON block found but invalid JSON: ${err.message}`);
    }
  }

  // Fallback: try legacy REFLECTION_START format for backwards compat
  const legacyMatch = output.match(/REFLECTION_START\n?([\s\S]*?)REFLECTION_END/);
  if (legacyMatch) {
    log(`REFLECTION PARSE: Using legacy REFLECTION_START format (deprecated)`);
    const block = legacyMatch[1];
    const summary = (block.match(/SUMMARY:\s*(.+)/)?.[1] || '').trim();
    const learnings = (block.match(/LEARNINGS:\s*(.+)/)?.[1] || '').trim();
    const confidence = parseFloat(block.match(/CONFIDENCE:\s*([\d.]+)/)?.[1] || 'NaN');
    const voteRaw = (block.match(/VOTE:\s*(\w+)/)?.[1] || '').trim().toLowerCase();
    const vote = VALID_VOTES.has(voteRaw) ? voteRaw : 'parse_error';

    return {
      summary, learnings,
      confidence: isNaN(confidence) ? 0.5 : confidence,
      vote,
      parse_failed: vote === 'parse_error',
    };
  }

  // No reflection block found at all
  log(`REFLECTION PARSE FAILED: No JSON or legacy reflection block found in output`);
  return {
    summary: output.slice(-300),
    learnings: '',
    confidence: 0.5,
    vote: 'parse_error',
    parse_failed: true,
  };
}

// ── Circling Strategy: Prompt Builder + Parser ───────

/**
 * Build a prompt for a circling strategy step.
 * Role-specific: Worker gets different instructions than Reviewers at each step.
 */
function buildCirclingPrompt(task, circlingData) {
  const { circling_phase, circling_step, circling_subround, directed_input, my_role } = circlingData;
  log(`Building circling prompt: phase=${circling_phase} step=${circling_step}`);
  const isWorker = my_role === 'worker';
  const parts = [];

  parts.push(`# Task: ${task.title}`);
  parts.push('');

  switch (circling_phase) {
    case 'init':
      if (isWorker) {
        parts.push('## Your Role: WORKER (Central Authority)');
        parts.push('');
        parts.push('You are the Worker in a Circling Strategy collaboration. You OWN the deliverable.');
        parts.push('Produce your initial work artifact (v0) — your first draft/implementation based on the task plan below.');
        parts.push('');
      } else {
        parts.push('## Your Role: REVIEWER');
        parts.push('');
        parts.push('You are a Reviewer in a Circling Strategy collaboration.');
        parts.push('Produce your **reviewStrategy** — your methodology and focus areas for reviewing this type of work.');
        parts.push('Define: what you will look for, what frameworks you will apply, what your evaluation criteria are.');
        parts.push('');
      }
      break;

    case 'circling':
      if (circling_step === 1) {
        // Step 1 — Review Pass
        parts.push(`## Sub-Round ${circling_subround}, Step 1: Review Pass`);
        parts.push('');
        if (isWorker) {
          parts.push('## Your Role: WORKER — Analyze Review Strategies');
          parts.push('');
          parts.push('Below are the review STRATEGIES from both reviewers (NOT their review findings).');
          parts.push('Analyze each strategy: what they focus on well, what they miss, how they could improve.');
          parts.push('Your feedback will help reviewers sharpen their approaches.');
          parts.push('Do NOT touch the work artifact in this step.');
          parts.push('');
        } else {
          parts.push('## Your Role: REVIEWER — Review the Work Artifact');
          parts.push('');
          parts.push('Below is the work artifact. Review it using your review strategy.');
          parts.push('Produce concrete, actionable findings. For each finding, specify:');
          parts.push('- What you found (the issue or observation)');
          parts.push('- Where in the artifact (location/line/section)');
          parts.push('- Why it matters (impact)');
          parts.push('- What you recommend (suggested fix or improvement)');
          parts.push('');
        }
      } else if (circling_step === 2) {
        // Step 2 — Integration + Refinement
        parts.push(`## Sub-Round ${circling_subround}, Step 2: Integration & Refinement`);
        parts.push('');
        if (isWorker) {
          parts.push('## Your Role: WORKER — Judge Reviews & Update Artifact');
          parts.push('');
          parts.push('Below are the review artifacts from both reviewers.');
          parts.push('For EACH review finding, judge it:');
          parts.push('- **ACCEPTED**: implement the suggestion and note where');
          parts.push('- **REJECTED**: explain why with reasoning');
          parts.push('- **MODIFIED**: implement differently and explain why');
          parts.push('');
          parts.push('Then produce your UPDATED work artifact incorporating accepted changes.');
          parts.push('Also produce a reconciliationDoc summarizing all judgments.');
          parts.push('');
          parts.push('You must output TWO artifacts using the multi-artifact format below.');
          parts.push('');
        } else {
          parts.push('## Your Role: REVIEWER — Refine Your Strategy');
          parts.push('');
          parts.push("Below is the Worker's analysis of your review strategy (and the other reviewer's).");
          parts.push("Evaluate the Worker's feedback honestly:");
          parts.push("- If the feedback is valid, adjust your strategy accordingly");
          parts.push("- If you disagree, explain why and keep your approach");
          parts.push('Produce your REFINED reviewStrategy.');
          parts.push('');
        }
      }
      break;

    case 'finalization':
      parts.push('## FINALIZATION');
      parts.push('');
      if (isWorker) {
        parts.push('## Your Role: WORKER — Final Delivery');
        parts.push('');
        parts.push('Produce your FINAL formatted work artifact.');
        parts.push('Also produce a completionDiff — a checklist comparing original plan items vs what was delivered:');
        parts.push('  [x] Item implemented');
        parts.push('  [ ] Item NOT implemented — reason / deferred to follow-up');
        parts.push('');
        parts.push('You must output TWO artifacts using the multi-artifact format below.');
        parts.push('');
      } else {
        parts.push('## Your Role: REVIEWER — Final Sign-Off');
        parts.push('');
        parts.push('Review the final work artifact against the original task plan.');
        parts.push('Either:');
        parts.push('- **APPROVE**: vote "converged" — the work meets quality standards');
        parts.push('- **FLAG CONCERN**: vote "blocked" — describe remaining critical concerns');
        parts.push('');
      }
      break;
  }

  // 2.4 / D11: a grappe worker is a harness-loaded OpenClaw, not a bare LLM call —
  // inject the node's coding + harness rules, role profile, and long-term memory as
  // context (the other collab/task builders already do this; circling did not).
  injectRules(parts, task.scope, taskActivationText(task));
  injectRole(parts, task.role);
  injectMemory(parts, task);
  injectHyperagentStrategy(parts, task);
  injectRejection(parts, task);

  // Add directed input
  if (directed_input) {
    parts.push('---');
    parts.push('');
    parts.push(directed_input);
    parts.push('');
  }

  // Add artifact output instructions
  const isMultiArtifact = isWorker && (circling_step === 2 || circling_phase === 'finalization');
  parts.push('---');
  parts.push('');

  if (isMultiArtifact) {
    // Multi-artifact output format (Worker Step 2 and Finalization)
    const art1Type = 'workArtifact';
    const art2Type = circling_phase === 'finalization' ? 'completionDiff' : 'reconciliationDoc';

    parts.push('## Output Format (TWO artifacts required)');
    parts.push('');
    parts.push('Produce your first artifact, then wrap it:');
    parts.push('');
    parts.push('===CIRCLING_ARTIFACT===');
    parts.push(`type: ${art1Type}`);
    parts.push('===END_ARTIFACT===');
    parts.push('');
    parts.push('Then produce your second artifact:');
    parts.push('');
    parts.push('===CIRCLING_ARTIFACT===');
    parts.push(`type: ${art2Type}`);
    parts.push('===END_ARTIFACT===');
    parts.push('');
    parts.push('Then end with:');
  } else {
    parts.push('## Output Format');
    parts.push('');
    parts.push('Produce your work above, then end with:');
  }

  // Determine the correct type for single-artifact output
  let artifactType = 'workArtifact'; // default
  if (!isWorker) {
    if (circling_phase === 'init' || circling_step === 2) artifactType = 'reviewStrategy';
    else if (circling_step === 1) artifactType = 'reviewArtifact';
    else if (circling_phase === 'finalization') artifactType = 'reviewSignOff';
  } else {
    if (circling_step === 1) artifactType = 'workerReviewsAnalysis';
  }

  parts.push('');
  parts.push('===CIRCLING_REFLECTION===');
  parts.push(`type: ${artifactType}`);
  parts.push('summary: [1-2 sentences about what you did]');
  parts.push('confidence: [0.0 to 1.0]');
  if (circling_phase === 'finalization') {
    parts.push('vote: [converged|blocked]');
  } else {
    parts.push('vote: [continue|converged|blocked]');
  }
  parts.push('===END_REFLECTION===');
  parts.push('');
  parts.push('Rules:');
  parts.push('- Begin your output with the artifact content DIRECTLY. Do NOT include any preamble, explanation, or commentary before the artifact. Any text before the artifact delimiters (or before the reflection block for single-artifact output) is treated as part of the artifact.');
  parts.push('- confidence: a number between 0.0 and 1.0');
  if (circling_phase === 'finalization') {
    parts.push('- vote: "converged" (work meets quality standards) or "blocked" (critical issue remains)');
  } else {
    parts.push('- vote: "continue" (more work needed), "converged" (satisfied), or "blocked" (critical issue)');
  }
  parts.push('- The reflection block MUST be the last thing in your response');

  return parts.join('\n');
}

// Parser extracted to lib/circling-parser.js — single source of truth for both
// production code and tests. Zero external dependencies.
const { parseCirclingReflection: _parseCircling } = require('../lib/circling-parser');

/**
 * Parse a circling strategy output. Delegates to lib/circling-parser.js
 * with agent-specific options (logger, legacy fallback).
 */
function parseCirclingReflection(output, { truncated = false } = {}) {
  return _parseCircling(output, {
    truncated,
    log: (msg) => log(msg),
    legacyParser: parseReflection,
  });
}

// ── Collaborative Task Execution ──────────────────────

// Sessions (or tasks) this node declined: the recruiting poll sees an unfilled
// session on every pass, so it is logged once and never re-fetched.
const declinedCollab = new Set();

function collabWorkerEnv() {
  return { ...process.env, MESH_ALLOW_LOCAL_WORKERS: resolveEnvKey('MESH_ALLOW_LOCAL_WORKERS') || '' };
}

/** The provider name when this node may not be a worker for `task`, else null. */
function collabDeclinedProvider(task) {
  const name = resolveProvider(task, CLI_PROVIDER, ENV_PROVIDER).name;
  return isOpenClawWorkerProvider(name, collabWorkerEnv()) ? null : name;
}

function declineCollabOnce(key, task, providerName) {
  if (declinedCollab.has(key)) return;
  declinedCollab.add(key);
  log(`COLLAB DECLINED (D11): provider "${providerName}" is not an OpenClaw advanced-LLM frontend — this node will not join ${task.task_id}. Set MESH_LLM_PROVIDER/task.llm_provider (claude/openai/gemini/deepseek/kimi/minimax/aider), name a vetted local provider in MESH_ALLOW_LOCAL_WORKERS, or MESH_ALLOW_MOCK_WORKERS=1 for choreography testing with 'shell'.`);
}

/**
 * One recruit candidate, from the broadcast or the recruiting poll. Returns the
 * task when this node should join its session, else null.
 */
async function recruitCandidate(sessionId, taskId) {
  if (declinedCollab.has(sessionId)) return null;
  const task = await natsRequest('mesh.tasks.get', { task_id: taskId }, 5000);
  if (!task || !task.collaboration) return null;
  if (task.owner === NODE_ID) return null; // we claimed it, already handling
  if (task.preferred_nodes && task.preferred_nodes.length > 0 && !task.preferred_nodes.includes(NODE_ID)) return null;
  if (task.exclude_nodes && task.exclude_nodes.length > 0 && task.exclude_nodes.includes(NODE_ID)) return null;
  const declinedProvider = collabDeclinedProvider(task);
  if (declinedProvider) {
    declineCollabOnce(sessionId, task, declinedProvider);
    return null;
  }
  return task;
}

async function joinRecruitedTask(task, label, sessionId) {
  log(`${label}: Joining collab session ${sessionId} for task ${task.task_id}`);
  currentTaskId = task.task_id;
  try {
    await executeCollabTask(task);
  } finally {
    currentTaskId = null;
  }
}

/** A mesh.collab.*.recruit broadcast. */
async function onRecruit(recruit) {
  if (!acquireTaskSlot()) return; // busy
  try {
    const task = await recruitCandidate(recruit.session_id, recruit.task_id);
    if (task) await joinRecruitedTask(task, 'RECRUIT', recruit.session_id);
  } finally {
    releaseTaskSlot();
  }
}

/** Poll for recruiting sessions on idle — catches recruits we missed. */
async function checkRecruitingSessions() {
  if (!acquireTaskSlot()) return; // busy
  try {
    const sessions = await natsRequest('mesh.collab.recruiting', {}, 5000);
    if (!sessions || !Array.isArray(sessions) || sessions.length === 0) return;

    for (const s of sessions) {
      if (s.node_ids && s.node_ids.includes(NODE_ID)) continue; // already joined
      if (s.max_nodes && s.current_nodes >= s.max_nodes) continue; // full
      const task = await recruitCandidate(s.session_id, s.task_id);
      if (task) await joinRecruitedTask(task, 'RECRUIT POLL', s.session_id);
    }
  } catch (err) {
    warn(`recruiting poll: ${err.message}`);
  } finally {
    releaseTaskSlot();
  }
}

/**
 * One pass of the claim path: claim the next task and run it. Returns 'busy'
 * (a recruit holds the slot), 'none' (nothing claimable), 'ran' or 'error'.
 */
async function claimAndRun() {
  if (!acquireTaskSlot()) return 'busy';
  let claimedTask = null;
  let claimedAt = 0;
  try {
    // accepts_collab: false asks the daemon to leave collab tasks to nodes whose
    // default provider can be a grappe worker (D11).
    const acceptsCollab = collabDeclinedProvider(null) === null;
    // Longer timeout — KV operations on remote NATS can be slow.
    const task = await natsRequest('mesh.tasks.claim', { node_id: NODE_ID, accepts_collab: acceptsCollab }, 60000);
    if (!task) return 'none';

    log(`CLAIMED: ${task.task_id} "${task.title}"`);
    claimedTask = task;
    claimedAt = Date.now();
    currentTaskId = task.task_id;
    if (task.collaboration) {
      await executeCollabTask(task);
    } else {
      await executeTask(task);
    }
    return 'ran';
  } catch (err) {
    await onWorkerError(claimedTask, claimedAt, err);
    return 'error';
  } finally {
    releaseTaskSlot();
  }
}


function isReviewOnlyScope(scope) {
  return Array.isArray(scope) && scope.some(s => typeof s === 'string' && s.startsWith('[REVIEW-ONLY]'));
}

/** The member's write scope: review-only markers stripped, '*' and none mean the task's scope. */
function effectiveCollabScope(task, scope) {
  if (!Array.isArray(scope) || scope.length === 0) return task.scope || [];
  const stripped = scope.map(s => String(s).replace(/^\[REVIEW-ONLY\] /, ''));
  return stripped.includes('*') ? (task.scope || []) : stripped;
}

/**
 * The solo path's mechanical gates for one collab member's worktree, before its
 * contribution is committed. Review-only members and circling reviewers never
 * contribute code; a secret or scope violation drops only this member's work.
 * Returns the reason to discard, or null when it may merge.
 */
function collabMergeBlock(task, worktreePath, { reviewerOnly, scope, llmOutput }) {
  if (reviewerOnly) return 'review-only member (reviewers do not contribute code)';
  const harness = runMeshHarness({
    rules: getHarnessRules(),
    worktreePath,
    taskScope: effectiveCollabScope(task, scope),
    llmOutput,
    hasMetric: !!task.metric,
    log,
    role: getRole(task.role),
  });
  const blocking = harness.violations.filter(v => v.rule === 'no-hardcoded-secrets' || v.rule === 'scope-enforcement');
  return blocking.length > 0 ? blocking.map(v => v.message).join('; ') : null;
}

/**
 * Execute a collaborative task: join session, work in rounds, submit reflections.
 */
async function executeCollabTask(task) {
  const startedAt = Date.now();
  const collabSpec = task.collaboration;
  log(`COLLAB EXECUTING: ${task.task_id} "${task.title}" (mode: ${collabSpec.mode})`);

  const providerRefusal = taskProviderRefusal(task, CLI_PROVIDER, ENV_PROVIDER);
  if (providerRefusal) {
    log(`COLLAB DECLINED: ${providerRefusal}`);
    writeAgentState('idle', null);
    if (task.owner === NODE_ID) {
      await natsRequest('mesh.tasks.release', {
        task_id: task.task_id,
        node_id: NODE_ID,
        lease_token: task.lease_token,
        reason: providerRefusal,
      }).catch(err => warn(`mesh.tasks.release: ${err.message}`));
    }
    return;
  }

  // D11: a grappe worker is the node's OpenClaw agent on an ADVANCED LLM — never a
  // local model the operator has not vetted. Refuse to run (no silent local fallback)
  // rather than degrade the grappe. Recruits are filtered before they get here
  // (recruitCandidate) and the claim asks the daemon to skip collab tasks, so this
  // path is a task this node claimed whose own provider it cannot serve.
  const declinedProvider = collabDeclinedProvider(task);
  if (declinedProvider) {
    // P1 #9a: never mesh.tasks.fail — one misconfigured node must not abort a
    // collab task mesh-wide. A claim it holds is released for triage instead of
    // idling until the lease expires; no telemetry, since nothing ran.
    declineCollabOnce(task.collab_session_id || task.task_id, task, declinedProvider);
    writeAgentState('idle', null);
    if (task.owner === NODE_ID) {
      await natsRequest('mesh.tasks.release', {
        task_id: task.task_id,
        node_id: NODE_ID,
        lease_token: task.lease_token,
        reason: `Collab task needs a grappe-worker provider; ${NODE_ID} resolves it to "${declinedProvider}", which D11 declines.`,
      }).catch(err => warn(`mesh.tasks.release: ${err.message}`));
    }
    return;
  }

  // Discover session ID — three strategies in priority order:
  // 1. task.collab_session_id (set by daemon on auto-create)
  // 2. mesh.collab.find RPC (lookup by task_id)
  // 3. Brief wait + retry (race condition: task claimed before session created)
  let sessionId = task.collab_session_id || null;

  if (!sessionId) {
    log(`COLLAB: No session_id in task. Discovering via mesh.collab.find...`);
    try {
      const found = await natsRequest('mesh.collab.find', { task_id: task.task_id }, 5000);
      if (found) sessionId = found.session_id;
    } catch { /* find RPC unavailable or no session yet */ }
  }

  if (!sessionId) {
    // Brief wait — session may still be creating (race between claim and session auto-create)
    log(`COLLAB: Session not found. Waiting 3s for daemon to create it...`);
    await new Promise(r => setTimeout(r, 3000));
    try {
      const found = await natsRequest('mesh.collab.find', { task_id: task.task_id }, 5000);
      if (found) sessionId = found.session_id;
    } catch { /* still nothing */ }
  }

  if (!sessionId) {
    // EXPLICIT FAILURE — do NOT silently fall back to solo execution.
    // A collab task running solo loses the multi-node quality guarantee
    // with zero indication in the output. This must be a visible error.
    log(`COLLAB FAILED: No session found for task ${task.task_id}. Refusing silent solo fallback.`);
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      node_id: NODE_ID,
      lease_token: task.lease_token,
      reason: `Collab session not found for task ${task.task_id}. Task requires collaborative execution (mode: ${collabSpec.mode}) but no session could be discovered. Solo fallback refused — collab tasks must run collaboratively.`,
    }).catch(err => warn(`mesh.tasks.fail: ${err.message}`));
    debug('state → idle');
    writeAgentState('idle', null);
    return;
  }

  // Subscribe to round notifications BEFORE joining — prevents race condition
  // where the daemon starts round 1 immediately upon last node joining,
  // but the joining node hasn't subscribed yet and misses the notification.
  const roundSub = nc.subscribe(`mesh.collab.${sessionId}.node.${NODE_ID}.round`);
  let roundsDone = false;
  let lastKnownSessionStatus = null; // tracks why rounds ended (completed/aborted/converged)
  let sessionNeedsReview = false;
  let lastRound = 0;
  let reviewerOnly = false;
  let lastScope = null;
  let lastOutput = '';

  // Join the session using the discovered session_id
  let session;
  try {
    const joinResult = await natsRequest('mesh.collab.join', {
      session_id: sessionId,
      node_id: NODE_ID,
    }, 10000);
    session = joinResult;
  } catch (err) {
    log(`COLLAB JOIN FAILED: ${err.message} (session: ${sessionId})`);
    roundSub.unsubscribe();
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      node_id: NODE_ID,
      lease_token: task.lease_token,
      reason: `Failed to join collab session ${sessionId}: ${err.message}`,
    }).catch(err2 => warn(`mesh.tasks.fail: ${err2.message}`));
    debug('state → idle');
    writeAgentState('idle', null);
    return;
  }

  if (!session) {
    log(`COLLAB JOIN RETURNED NULL for session ${sessionId}`);
    roundSub.unsubscribe();
    // P1 #9a: a rejected join (full/closed/duplicate) means the session is
    // proceeding WITHOUT this node — that is a personal decline, not a task
    // failure. Failing the task here let a late-arriving node abort a healthy
    // running grappe (the 2.4-era "already joined"/"full" aborts).
    log(`COLLAB DECLINED: session ${sessionId} rejected this node's join (full, closed, or duplicate) — task proceeds without ${NODE_ID}.`);
    debug('state → idle');
    writeAgentState('idle', null);
    return;
  }

  log(`COLLAB JOINED: ${sessionId} (${session.nodes.length} nodes)`);
  writeAgentState('working', task.task_id);
  await prepareHyperagentStrategy(task);

  // Create worktree for isolation — FAIL-CLOSED (D14 rerun): a member that
  // cannot get isolation leaves the session it already joined (if it was the
  // Nth joiner, rounds have already started), so no barrier waits on it.
  // Contaminated shared-tree contributions are worse than a member loss.
  const worktreePath = createWorktree(`${task.task_id}-${NODE_ID}`);
  if (!worktreePath) {
    log(`ISOLATION FAILED: withdrawing ${NODE_ID} from collab ${sessionId} (fail-closed, no shared-workspace fallback)`);
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      node_id: NODE_ID,
      lease_token: task.lease_token,
      reason: `Worktree isolation failed for collab member ${NODE_ID} (MESH_WORKSPACE=${WORKSPACE} — must be a git repository). Fail-closed: member withdrew.`,
    }).catch(err => warn(`mesh.tasks.fail: ${err.message}`));
    roundSub.unsubscribe();
    await natsRequest('mesh.collab.leave', {
      session_id: sessionId,
      node_id: NODE_ID,
      member_token: session.member_token,
      reason: 'worktree isolation failed',
    }).catch(err => warn(`mesh.collab.leave: ${err.message}`));
    writeAgentState('idle', null);
    return;
  }
  const taskDir = worktreePath;

  const endRounds = () => {
    lastKnownSessionStatus = 'stopped';
    roundsDone = true;
    roundSub.unsubscribe();
  };
  stopHooks.set(task.task_id, endRounds);

  // Periodic session heartbeat — detects abort/completion while waiting for rounds
  const sessionHeartbeat = setInterval(async () => {
    try {
      const status = await natsRequest('mesh.collab.status', { session_id: sessionId }, 5000);
      if (['aborted', 'completed'].includes(status.status)) {
        log(`COLLAB HEARTBEAT: Session ${sessionId} is ${status.status}. Unsubscribing.`);
        lastKnownSessionStatus = status.status;
        sessionNeedsReview = !!status.needs_review;
        roundsDone = true;
        roundSub.unsubscribe();
      }
    } catch (err) { warn(`collab heartbeat: ${err.message}`); }
  }, 10000);

  // runLLM renews the lease only while this node's worker runs; the owner must
  // also renew it while waiting between rounds, or the reaper re-queues the task.
  const leaseHeartbeat = task.owner === NODE_ID && task.lease_token
    ? setInterval(() => {
      natsRequest('mesh.tasks.heartbeat', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token })
        .catch(err => warn(`collab lease heartbeat: ${err.message}`));
    }, HEARTBEAT_INTERVAL)
    : null;

  // Signal start
  await natsRequest('mesh.tasks.start', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token }).catch(err => warn(`mesh.tasks.start: ${err.message}`));

  try {
    for await (const roundMsg of roundSub) {
      if (roundsDone) break;

      const roundData = JSON.parse(sc.decode(roundMsg.data));
      const { round_number, shared_intel, directed_input, my_scope, my_role, mode, current_turn,
              round_role, circling_phase, circling_step, circling_subround } = roundData;
      if (round_number > lastRound) lastRound = round_number;

      // Sequential mode safety guard: skip if it's not our turn.
      if (mode === 'sequential' && current_turn && current_turn !== NODE_ID) {
        log(`COLLAB R${round_number}: Not our turn (current: ${current_turn}). Waiting.`);
        continue;
      }

      const isCircling = mode === 'circling_strategy';
      if (isReviewOnlyScope(my_scope) || (isCircling && my_role === 'reviewer')) reviewerOnly = true;
      lastScope = my_scope;
      const stepLabel = isCircling
        ? `${circling_phase === 'init' ? 'Init' : circling_phase === 'finalization' ? 'Final' : `SR${circling_subround}/S${circling_step}`}`
        : `R${round_number}`;
      log(`COLLAB ${stepLabel}: Starting work (role: ${my_role}, scope: ${JSON.stringify(my_scope)})`);

      // Build prompt — circling uses directed inputs, other modes use shared intel
      await prepareMemoryRecall(task);
      const prompt = isCircling
        ? buildCirclingPrompt(task, roundData)
        : buildCollabPrompt(task, round_number, shared_intel, my_scope, my_role, round_role);

      if (DRY_RUN) {
        log(`[DRY RUN] Collab prompt:\n${prompt}`);
        break;
      }

      // Execute provider (LLM or shell)
      const llmResult = await runLLM(prompt, task, worktreePath);
      const stop = stoppedFor(task.task_id);
      if (stop) {
        log(`COLLAB ${stepLabel}: ${stop.reason} — round abandoned, no reflection`);
        endRounds();
        break;
      }
      const output = llmResult.stdout || '';
      lastOutput = output;

      // Parse reflection — circling uses delimiter-based parser, others use JSON-block parser
      let reflection;
      let circlingArtifacts = [];

      if (llmResult.provider === 'shell') {
        reflection = {
          summary: output.trim().slice(-500) || '(no output)',
          learnings: '',
          confidence: llmResult.exitCode === 0 ? 1.0 : 0.0,
          vote: llmResult.exitCode === 0 ? 'converged' : 'continue',
          parse_failed: false,
        };
      } else if (isCircling) {
        const circResult = parseCirclingReflection(output, { truncated: llmResult.truncated });
        // A converged vote must have something to vote on: every circling step
        // carries a designated artifact, so ZERO artifacts — or artifacts whose
        // content is empty after sanitization — are parse failures, not
        // deliverables (2.4 findings 6+7+8; run 3 escalated on a worker that
        // submitted none and only drew a daemon warning).
        const allArtifactsEmpty = (circResult.circling_artifacts || []).length === 0 ||
          circResult.circling_artifacts.every(a => !String((a && a.content) ?? a ?? '').trim());
        if (allArtifactsEmpty && !circResult.parse_failed) {
          circResult.parse_failed = true;
          circResult.vote = 'parse_error';
          circResult.summary = 'empty artifact content after output sanitization';
          circResult.circling_artifacts = [];
        }
        // Degenerate/incomplete-submission guard (D14 smokes #2 + #4): a
        // workArtifact that is only a preamble (model narrated and worked
        // agentically instead of in-response — 89-char sr1_step2 final,
        // smoke #2), or a worker multi-artifact round missing its second
        // required artifact (finalization without completionDiff, smoke #4),
        // poisons the benchmark final. Both are parse failures — the
        // daemon's correction path re-prompts (3 attempts).
        const MIN_WORK_ARTIFACT_CHARS = 400;
        if (!circResult.parse_failed) {
          const byType = new Map((circResult.circling_artifacts || [])
            .map((a) => [a?.type ?? '', String((a && a.content) ?? '').trim()]));
          const wa = byType.get('workArtifact');
          let failReason = null;
          if (wa != null && wa.length > 0 && wa.length < MIN_WORK_ARTIFACT_CHARS) {
            failReason = `degenerate workArtifact (< ${MIN_WORK_ARTIFACT_CHARS} chars, preamble-only)`;
          }
          const isWorkerMulti = my_role === 'worker' && (circling_step === 2 || circling_phase === 'finalization');
          if (!failReason && isWorkerMulti) {
            const secondType = circling_phase === 'finalization' ? 'completionDiff' : 'reconciliationDoc';
            if (!wa || wa.length < MIN_WORK_ARTIFACT_CHARS) {
              failReason = `multi-artifact round missing a usable workArtifact`;
            } else if (!byType.get(secondType)) {
              failReason = `multi-artifact round missing ${secondType}`;
            }
          }
          if (failReason) {
            circResult.parse_failed = true;
            circResult.vote = 'parse_error';
            circResult.summary = failReason;
            circResult.circling_artifacts = [];
          }
        }
        reflection = {
          summary: circResult.summary,
          learnings: '',
          confidence: circResult.confidence,
          vote: circResult.vote,
          parse_failed: circResult.parse_failed,
        };
        circlingArtifacts = circResult.circling_artifacts;
      } else {
        reflection = parseReflection(output, { truncated: llmResult.truncated });
      }

      // List modified files
      let artifacts = [];
      try {
        if (worktreePath) {
          // Untrimmed: the first record's status column can start with a space.
          const status = execSync('git status --porcelain', {
            cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
          });
          artifacts = status.split('\n').filter(Boolean).map(line => line.slice(3));
        }
      } catch { /* best effort */ }

      // Per-round cost: the CLI's own total, else this agent's own session JSONL
      // (the per-agent work dir keeps it attributable).
      const roundSessionInfo = llmResult.cost
        ? { cost: llmResult.cost }
        : await getSessionInfo(AGENT_WORK_DIR).catch(() => null);

      // Submit reflection
      try {
        await natsRequest('mesh.collab.reflect', {
          session_id: sessionId,
          node_id: NODE_ID,
          member_token: session.member_token,
          round: round_number,
          summary: reflection.summary,
          learnings: reflection.learnings || '',
          artifacts,
          confidence: reflection.confidence,
          vote: reflection.vote,
          parse_failed: reflection.parse_failed,
          // Circling extensions
          circling_step: isCircling ? circling_step : null,
          circling_artifacts: circlingArtifacts,
          // D14 cost record: the daemon accumulates these into
          // session.circling.usage_total.
          usage: roundSessionInfo?.cost ? {
            input_tokens: roundSessionInfo.cost.inputTokens ?? null,
            output_tokens: roundSessionInfo.cost.outputTokens ?? null,
            cost_usd: roundSessionInfo.cost.estimatedCostUsd ?? null,
          } : null,
        });
        const parseTag = reflection.parse_failed ? ' [PARSE FAILED]' : '';
        const artCount = circlingArtifacts.length > 0 ? `, ${circlingArtifacts.length} artifact(s)` : '';
        log(`COLLAB ${stepLabel}: Reflection submitted (vote: ${reflection.vote}, conf: ${reflection.confidence}${parseTag}${artCount})`);
      } catch (err) {
        log(`COLLAB ${stepLabel}: Reflection submit failed: ${err.message}`);
      }

      // Check if session is done (converged/completed/aborted)
      try {
        const status = await natsRequest('mesh.collab.status', { session_id: sessionId });
        if (['converged', 'completed', 'aborted'].includes(status.status)) {
          log(`COLLAB: Session ${sessionId} is ${status.status}. Done.`);
          lastKnownSessionStatus = status.status;
          sessionNeedsReview = !!status.needs_review;
          roundsDone = true;
        }
      } catch (err) { warn(`collab status check: ${err.message}`); }
    }
  } finally {
    clearInterval(sessionHeartbeat);
    clearInterval(leaseHeartbeat);
    stopHooks.delete(task.task_id);
    roundSub.unsubscribe();
  }

  // Commit and merge only on successful convergence — don't merge partial
  // work from aborted/failed sessions into main.
  // Uses lastKnownSessionStatus (set during round loop or heartbeat) instead of
  // a fresh network read, which could see stale state due to NATS latency.
  try {
    const blocked = ['completed', 'converged'].includes(lastKnownSessionStatus)
      ? collabMergeBlock(task, worktreePath, { reviewerOnly, scope: lastScope, llmOutput: lastOutput })
      : null;
    if (blocked) {
      log(`COLLAB MERGE BLOCKED: ${blocked} — discarding ${NODE_ID}'s contribution to ${task.task_id}`);
      cleanupWorktree(worktreePath, false);
    } else if (['completed', 'converged'].includes(lastKnownSessionStatus)) {
      // A converged vote is the review for collab work, so that merge is
      // post-review; collabMergeBlock applied the solo path's mechanical gates.
      // A session that ran out of rounds never converged: the daemon holds the
      // parent in pending_review and the contribution stays on its branch
      // until the approve notice (onReviewApproved).
      const collabId = collabBranchId(task.task_id);
      const commit = commitWorktree(worktreePath, collabId, `collab contribution from ${NODE_ID}`);
      if (sessionNeedsReview) {
        if (commit?.committed) log(`Branch ${commit.branch} kept unmerged — collab ${sessionId} did not converge (merge after review)`);
        cleanupWorktree(worktreePath, !!commit?.committed);
      } else {
        const merge = commit?.committed ? mergeTaskBranch(collabId) : null;
        cleanupWorktree(worktreePath, !!commit?.committed && !merge?.merged);
      }
    } else {
      log(`COLLAB: Session ${sessionId} ended as ${lastKnownSessionStatus || 'unknown'} — discarding worktree`);
      cleanupWorktree(worktreePath, false);
    }
  } catch (err) {
    log(`COLLAB WORKTREE CLEANUP FAILED: ${err.message}`);
  }

  writeAgentState('idle', null);
  const successful = ['completed', 'converged'].includes(lastKnownSessionStatus);
  await recordHyperagentTask(task, {
    outcome: successful ? 'success' : 'failure',
    iterations: Math.max(1, lastRound),
    startedAt,
    sessionId,
    notes: `Collaboration session ${sessionId} ended with status ${lastKnownSessionStatus || 'unknown'}.`,
  });
  log(`COLLAB DONE: ${task.task_id} (node: ${NODE_ID})`);
}

// ── Task Execution ────────────────────────────────────

/**
 * Execute a task with the Karpathy iteration pattern.
 * Try → measure → keep/discard → retry.
 */
async function executeTask(task) {
  const startedAt = Date.now();
  log(`EXECUTING: ${task.task_id} "${task.title}" (budget: ${task.budget_minutes}m, metric: ${task.metric || 'none'}, max attempts: ${MAX_ATTEMPTS})`);

  const providerRefusal = taskProviderRefusal(task, CLI_PROVIDER, ENV_PROVIDER);
  if (providerRefusal) {
    log(`REFUSED: ${providerRefusal}`);
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      node_id: NODE_ID,
      lease_token: task.lease_token,
      reason: providerRefusal,
    }).catch(err => warn(`mesh.tasks.fail: ${err.message}`));
    writeAgentState('idle', null);
    return;
  }

  const preCheck = await runPreChecks({ rules: getHarnessRules(), probes: PRE_CHECK_PROBES, log });
  if (!preCheck.pass) {
    const reason = `Harness pre-check failed on ${NODE_ID}: ${preCheck.failures.map(f => `${f.service} (${f.reason})`).join('; ')}. Task not started.`;
    log(`PRE-CHECK FAILED: ${task.task_id} — ${reason}`);
    // Best effort: with the bus itself down this cannot arrive, and the
    // claim's lease expiry re-queues the task instead.
    await natsRequest('mesh.tasks.release', {
      task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, reason,
    }).catch(err => warn(`mesh.tasks.release: ${err.message}`));
    writeAgentState('idle', null);
    return;
  }

  await prepareHyperagentStrategy(task);

  // Create isolated worktree for this task — FAIL-CLOSED (D14 rerun,
  // 2026-08-03 smoke finding): a task that cannot get isolation must fail
  // loudly, not run in the shared tree producing context-contaminated
  // artifacts that reviewers then approve.
  const worktreePath = createWorktree(task.task_id);
  if (!worktreePath) {
    log(`ISOLATION FAILED: refusing to run ${task.task_id} in the shared workspace (fail-closed)`);
    await natsRequest('mesh.tasks.fail', {
      task_id: task.task_id,
      node_id: NODE_ID,
      lease_token: task.lease_token,
      reason: `Worktree isolation failed for ${task.task_id} (MESH_WORKSPACE=${WORKSPACE} — must be a git repository). Fail-closed: shared-workspace fallback refused.`,
    }).catch(err => warn(`mesh.tasks.fail: ${err.message}`));
    writeAgentState('idle', null);
    return;
  }
  const workspaceIsolated = true;

  // Signal start (include isolation status so daemon knows)
  // node_id: the daemon now enforces ownership on start/complete/release
  // (only the claiming node may drive its task) — the same check fail had.
  await natsRequest('mesh.tasks.start', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, workspace_isolated: workspaceIsolated });
  writeAgentState('working', task.task_id);
  log(`Started: ${task.task_id} (dir: ${worktreePath ? 'worktree' : 'workspace'})`);

  const supervisor = await createTaskSupervisor(task, worktreePath);
  await superviseTask(supervisor, () => runAttempts(task, worktreePath, supervisor, startedAt));
}

/**
 * Every exit from a supervised task — completion, release, dry run, or a throw
 * anywhere in the attempt loop — closes its supervisor: a loop left running would
 * keep assessing a task that is gone. A throw carries the supervisor's summary out
 * as `err.foremanNote`, because the telemetry row for a thrown task is written by
 * the main loop, which never sees the supervisor.
 */
async function superviseTask(supervisor, run) {
  try {
    return await run();
  } catch (err) {
    if (supervisor && !supervisor.closed) err.foremanNote = await closeSupervision(supervisor, 'error');
    throw err;
  } finally {
    if (supervisor && !supervisor.closed) await closeSupervision(supervisor, 'error');
  }
}

/** The attempt loop — try → measure → keep/discard → retry — then release. */
function throwIfStopped(task) {
  const stop = stoppedFor(task.task_id);
  // The daemon already released or failed the task: wind down as onWorkerError does for a TASK_TERMINAL refusal.
  if (stop) throw Object.assign(new Error(`Stopped: ${stop.reason}`), { code: TASK_TERMINAL, taskStatus: stop.kind });
}

async function runAttempts(task, worktreePath, supervisor, startedAt) {
  const attempts = [];
  // The daemon escalates to the role's on_metric_failure target only when every
  // attempt ran and the last one failed its metric, never on an early stop.
  let stoppedEarly = false;
  let lastMetricFailed = false;
  // Every run the task paid for: each attempt and each verifier pass.
  const spent = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  let costReported = false;
  const addCost = (cost) => {
    if (!cost) return;
    costReported = true;
    spent.inputTokens += cost.inputTokens || 0;
    spent.outputTokens += cost.outputTokens || 0;
    spent.estimatedCostUsd += cost.estimatedCostUsd || 0;
  };
  // The session-log estimate only when no run reported its own cost, read once: it re-reads
  // the latest session file, so summing it per attempt would multiply one stale figure.
  const reportedCost = async () => (costReported
    ? spent
    : (await getSessionInfo(AGENT_WORK_DIR).catch(() => null))?.cost || null);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastMetricFailed = false;
    throwIfStopped(task);
    // Check budget before each attempt
    const budgetDeadline = new Date(task.budget_deadline);
    const remaining = (budgetDeadline - Date.now()) / 60000;
    if (remaining <= 0) {
      log(`Budget exhausted before attempt ${attempt}`);
      stoppedEarly = true;
      break;
    }
    log(`Attempt ${attempt}/${MAX_ATTEMPTS} (${remaining.toFixed(1)}m remaining)`);

    // Build prompt — attempt number injected as discrete integer for strategy branching
    await prepareMemoryRecall(task);
    const prompt = attempt === 1
      ? buildInitialPrompt(task)
      : buildRetryPrompt(task, attempts, attempt);

    if (DRY_RUN) {
      log(`[DRY RUN] Prompt:\n${prompt}`);
      await closeSupervision(supervisor, 'dry-run');
      return;
    }

    // Run LLM (with worktree isolation if available), supervised as it streams
    if (supervisor) supervisor.workerStarted({ attempt });
    const llmResult = await runLLM(prompt, task, worktreePath, supervisor);
    throwIfStopped(task);
    const summary = llmResult.stdout.slice(-500) || '(no output)';

    log(`${llmResult.provider} exited with code ${llmResult.exitCode}`);

    addCost(llmResult.cost);
    if (llmResult.cost) {
      log(`Cost: $${llmResult.cost.estimatedCostUsd.toFixed(4)} (${llmResult.cost.inputTokens} in / ${llmResult.cost.outputTokens} out)`);
    }

    // A worker Foreman stopped is over whatever its exit code says (a CLI that traps
    // SIGTERM can exit 0): retry with the supervisor's guidance in the prompt, or
    // release when the stop was an escalation.
    const foremanStop = supervisor?.state.last_stop?.attempt === attempt ? supervisor.state.last_stop : null;
    if (foremanStop) {
      const escalated = foremanStop.action === 'ESCALATE';
      const attemptRecord = {
        approach: `Attempt ${attempt}: ${escalated ? 'escalated' : 'stopped'} by Foreman — ${foremanStop.reason}`,
        result: (foremanStop.guidance || foremanStop.reason).slice(-500),
        keep: false,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...attemptRecord });
      if (escalated) {
        log(`Attempt ${attempt}: Foreman escalated (${foremanStop.reason}). Releasing for human triage.`);
        stoppedEarly = true;
        break;
      }
      log(`Attempt ${attempt}: stopped by Foreman (${foremanStop.reason}). Retrying with the guidance.`);
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    if (llmResult.exitCode !== 0) {
      const attemptRecord = {
        approach: `Attempt ${attempt}: ${llmResult.provider} exited with error (code ${llmResult.exitCode})`,
        result: llmResult.stderr.slice(-500) || 'unknown error',
        keep: false,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...attemptRecord });

      // Two-tier retry: abnormal exit → exponential backoff (agent crash, OOM, etc.)
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // 1s, 2s, 4s... max 30s
      log(`Attempt ${attempt} failed (${llmResult.provider} error, code ${llmResult.exitCode}). Backoff ${backoffMs}ms before retry.`);
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    // ── Mesh Harness: Mechanical Enforcement (LLM-agnostic) ──
    // Runs AFTER LLM exits successfully, BEFORE commit. This is the hard
    // enforcement layer — it doesn't depend on the LLM obeying prompt rules.
    const harnessResult = runMeshHarness({
      rules: getHarnessRules(),
      worktreePath,
      taskScope: task.scope,
      llmOutput: llmResult.stdout,
      hasMetric: !!task.metric,
      log,
      role: getRole(task.role),
    });

    if (!harnessResult.pass) {
      log(`HARNESS BLOCKED: ${harnessResult.violations.length} violation(s)`);
      for (const v of harnessResult.violations) {
        log(`  - [${v.rule}] ${v.message}`);
      }
      // Scope violations were already reverted by enforceScopeCheck.
      // Secret violations block the commit entirely.
      const hasSecrets = harnessResult.violations.some(v => v.rule === 'no-hardcoded-secrets');
      if (hasSecrets) {
        // The next attempt starts from a clean tree: left in place, the secret would ride
        // into the next attempt and into a partial commit.
        const reset = resetWorktree(worktreePath);
        const attemptRecord = {
          approach: `Attempt ${attempt}: harness blocked — secrets detected`,
          result: harnessResult.violations.map(v => v.message).join('; '),
          keep: false,
          reset,
        };
        attempts.push(attemptRecord);
        await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...attemptRecord });
        log(`Attempt ${attempt}: harness blocked commit (secrets); worktree ${reset ? 'reset to HEAD' : 'reset FAILED'}. Retrying.`);
        continue;
      }
      // Non-secret violations (scope reverts, output blocks): proceed with warnings
    }

    if (harnessResult.warnings.length > 0) {
      log(`HARNESS WARNINGS: ${harnessResult.warnings.length}`);
      for (const w of harnessResult.warnings) {
        log(`  - [${w.rule}] ${w.message}`);
      }
    }

    // If no metric, an enforcing Foreman's independent verifier is the verification
    // (D3); in shadow mode or without Foreman, trust the LLM output as before.
    if (!task.metric) {
      const verification = await foremanVerify(supervisor, task, worktreePath, attempt, llmResult);
      addCost(verification.cost);
      if (verification.attemptRecord) {
        attempts.push(verification.attemptRecord);
        await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...verification.attemptRecord });
        if (verification.escalate) {
          log(`Attempt ${attempt}: ${verification.attemptRecord.approach}. Releasing for human triage.`);
          stoppedEarly = true;
          break;
        }
        log(`Attempt ${attempt}: ${verification.attemptRecord.approach}. Retrying with the findings.`);
        continue;
      }
      const attemptRecord = {
        approach: `Attempt ${attempt}: executed without metric`,
        result: summary,
        keep: true,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...attemptRecord });

      const artifacts = changedFiles(worktreePath);
      const roleValidation = checkRoleOutputs(task, artifacts, worktreePath);

      // Commit on the task branch; merge only after the daemon's review decision
      const commit = commitWorktree(worktreePath, task.task_id, summary);

      // Post-commit validation (conventional commits, etc.)
      if (commit?.committed) {
        runPostCommitValidation(getHarnessRules(), worktreePath, log);
      }

      const completedTask = await natsRequest('mesh.tasks.complete', {
        task_id: task.task_id,
        node_id: NODE_ID,
        lease_token: task.lease_token,
        result: {
          success: true, summary, artifacts,
          ...(roleValidation ? { role_validation: roleValidation } : {}),
          cost: await reportedCost(),
          harness: {
            violations: harnessResult.violations,
            warnings: harnessResult.warnings,
          },
          sha: commit?.sha || null,
          branch: commit?.branch || null,
          merged: commit?.committed ? false : null,
        },
      });
      const keepBranch = await mergeIfApproved(task, commit, completedTask);
      cleanupWorktree(worktreePath, keepBranch);
      writeAgentState('idle', null);
      const foremanNote = await closeSupervision(supervisor, 'success');
      await recordHyperagentTask(task, {
        outcome: 'success', iterations: attempts.length, startedAt,
        notes: `Completed without a configured metric. ${summary}${foremanNote}`,
      });
      log(`COMPLETED: ${task.task_id} (no metric, attempt ${attempt})`);
      return;
    }

    // Evaluate metric (run in worktree if available)
    log(`Evaluating metric: ${task.metric} (in ${worktreePath ? 'worktree' : 'workspace'})`);
    const metricResult = await evaluateMetric(task.metric, worktreePath);
    if (supervisor) supervisor.recordVerification({ passed: metricResult.passed, summary: metricResult.output.slice(-2000), source: 'metric' });

    if (metricResult.passed) {
      const attemptRecord = {
        approach: `Attempt ${attempt}: metric passed`,
        result: metricResult.output.slice(-300),
        keep: true,
      };
      attempts.push(attemptRecord);
      await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...attemptRecord });

      const artifacts = changedFiles(worktreePath);
      const roleValidation = checkRoleOutputs(task, artifacts, worktreePath);

      // Commit on the task branch; merge only after the daemon's review decision
      const commit = commitWorktree(worktreePath, task.task_id, summary);

      // Post-commit validation (conventional commits, etc.)
      if (commit?.committed) {
        runPostCommitValidation(getHarnessRules(), worktreePath, log);
      }

      const completedTask = await natsRequest('mesh.tasks.complete', {
        task_id: task.task_id,
        node_id: NODE_ID,
        lease_token: task.lease_token,
        result: {
          success: true,
          summary: `Metric passed on attempt ${attempt}. ${summary.slice(0, 200)}`,
          // Full worker deliverable — the 200-char summary loses text-artifact
          // tasks (2.6 benchmark needs the whole answer, not a tail).
          output: llmResult.stdout,
          artifacts,
          ...(roleValidation ? { role_validation: roleValidation } : {}),
          cost: await reportedCost(),
          sha: commit?.sha || null,
          branch: commit?.branch || null,
          merged: commit?.committed ? false : null,
          harness: {
            violations: harnessResult.violations,
            warnings: harnessResult.warnings,
          },
        },
      });
      const keepBranch = await mergeIfApproved(task, commit, completedTask);
      cleanupWorktree(worktreePath, keepBranch);
      writeAgentState('idle', null);
      const foremanNote = await closeSupervision(supervisor, 'success');
      await recordHyperagentTask(task, {
        outcome: 'success', iterations: attempts.length, startedAt,
        notes: `Configured metric passed on attempt ${attempt}. ${summary}${foremanNote}`,
      });
      log(`COMPLETED: ${task.task_id} (metric passed, attempt ${attempt})`);
      return;
    }

    // Metric failed — log attempt, quick continuation (normal exit, just didn't pass)
    const attemptRecord = {
      approach: `Attempt ${attempt}: metric failed`,
      result: metricResult.output.slice(-500),
      keep: false,
    };
    attempts.push(attemptRecord);
    await natsRequest('mesh.tasks.attempt', { task_id: task.task_id, node_id: NODE_ID, lease_token: task.lease_token, ...attemptRecord });
    lastMetricFailed = true;
    log(`Attempt ${attempt}: metric failed. Quick retry (1s). Output: ${metricResult.output.slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 1000)); // two-tier: normal exit → 1s continuation
  }

  // All attempts exhausted or budget exceeded → RELEASE (not fail)
  // "Released" = automation tried everything, human must triage.
  // "Failed" = a single attempt failed (used by daemon for budget/stall).
  // Commit whatever partial work exists on the task branch — preserved for
  // post-mortem, never merged (a released task failed its own verification).
  const partial = commitPartialWork(worktreePath, task.task_id, 'partial: released after exhausting attempts');

  const escalated = supervisor?.state.escalation ? `Foreman escalated: ${supervisor.state.escalation.reason}. ` : '';
  const reason = `${escalated}Exhausted ${attempts.length}/${MAX_ATTEMPTS} attempts. Last: ${attempts[attempts.length - 1]?.result?.slice(0, 200) || 'unknown'}`;
  await natsRequest('mesh.tasks.release', {
    task_id: task.task_id,
    node_id: NODE_ID,
    lease_token: task.lease_token,
    reason,
    attempts,
    metric_exhausted: !stoppedEarly && lastMetricFailed && !escalated,
    cost: await reportedCost(),
  });
  // Keep worktree branch on release for post-mortem debugging (don't merge partial
  // work); startup reconcile keeps it until MESH_KEPT_BRANCH_MAX_DAYS.
  cleanupWorktree(worktreePath, !partial?.blocked);
  writeAgentState('idle', null);
  const foremanNote = await closeSupervision(supervisor, 'failure');
  await recordHyperagentTask(task, {
    outcome: 'failure', iterations: attempts.length, startedAt,
    notes: `Task released for human triage. ${reason}${foremanNote}`,
  });
  log(`RELEASED: ${task.task_id} — ${reason}`);
}

// A task the daemon already ended (budget auto-fail, stall release, cancel)
// surfaces here as the TASK_TERMINAL refusal of the worker's next call. That
// is a stop, not a crash: wind down like the release path, so the worktree,
// the agent state and the telemetry are not left on a dead task. Any other
// error abandons the task the same way.
async function onWorkerError(task, startedAt, err) {
  const terminal = Boolean(task) && err.code === TASK_TERMINAL;
  log(terminal ? `STOPPED: ${task.task_id} — ${err.message}` : `ERROR: ${err.message}`);
  if (!task) return;
  // createWorktree's own id check: the error may be its refusal of an unsafe id.
  const worktreePath = /^[\w][\w.-]{0,127}$/.test(task.task_id) ? path.join(WORKTREE_BASE, task.task_id) : null;
  if (worktreePath && fs.existsSync(worktreePath)) {
    const partial = commitPartialWork(worktreePath, task.task_id, terminal ? `partial: the daemon ended this task (${err.taskStatus})` : 'partial: abandoned after a worker error');
    cleanupWorktree(worktreePath, !partial?.blocked);
  }
  writeAgentState('idle', null);
  await recordHyperagentTask(task, {
    outcome: 'failure', iterations: 1, startedAt,
    notes: `${terminal ? 'Stopped' : 'Unhandled worker error'}: ${err.message}${err.foremanNote || ''}`,
  });
}

// ── Tracer wrapping ──────────────────────────────────
executeTask = tracer.wrapAsync('executeTask', executeTask, { tier: 1, category: 'state_transition' });
executeCollabTask = tracer.wrapAsync('executeCollabTask', executeCollabTask, { tier: 1, category: 'state_transition' });
evaluateMetric = tracer.wrapAsync('evaluateMetric', evaluateMetric, { tier: 2, category: 'compute' });
runLLM = tracer.wrapAsync('runLLM', runLLM, { tier: 2, category: 'compute' });
createWorktree = tracer.wrap('createWorktree', createWorktree, { tier: 2, category: 'compute' });
commitWorktree = tracer.wrap('commitWorktree', commitWorktree, { tier: 2, category: 'compute' });
mergeTaskBranch = tracer.wrap('mergeTaskBranch', mergeTaskBranch, { tier: 2, category: 'compute' });
cleanupWorktree = tracer.wrap('cleanupWorktree', cleanupWorktree, { tier: 2, category: 'compute' });
buildInitialPrompt = tracer.wrap('buildInitialPrompt', buildInitialPrompt, { tier: 2, category: 'compute' });
buildRetryPrompt = tracer.wrap('buildRetryPrompt', buildRetryPrompt, { tier: 2, category: 'compute' });
natsRequest = tracer.wrapAsync('natsRequest', natsRequest, { tier: 2 });
isAllowedMetric = tracer.wrap('isAllowedMetric', isAllowedMetric, { tier: 2 });
buildCollabPrompt = tracer.wrap('buildCollabPrompt', buildCollabPrompt, { tier: 2 });
buildCirclingPrompt = tracer.wrap('buildCirclingPrompt', buildCirclingPrompt, { tier: 2 });
parseReflection = tracer.wrap('parseReflection', parseReflection, { tier: 3 });
parseCirclingReflection = tracer.wrap('parseCirclingReflection', parseCirclingReflection, { tier: 3 });

// ── Main Loop ─────────────────────────────────────────

async function main() {
  let defaultProvider;
  try {
    defaultProvider = resolveProvider(null, CLI_PROVIDER, ENV_PROVIDER);
  } catch (err) {
    // No mind seated: say exactly what to do and stop, instead of running a
    // worker that can only fail every task it claims.
    log(`FATAL: ${err.message}`);
    process.exit(1);
  }
  const defaultModel = resolveModel(null, CLI_MODEL, defaultProvider);
  log(`Starting mesh agent worker`);
  log(`  Node ID:     ${NODE_ID}`);
  log(`  NATS:        ${NATS_URL}`);
  log(`  LLM:         ${defaultProvider.name} (${defaultProvider.binary})`);
  log(`  Model:       ${defaultModel || '(per-task)'}`);
  log(`  Workspace:   ${WORKSPACE}`);
  log(`  Max attempts: ${MAX_ATTEMPTS}`);
  log(`  Poll interval: ${POLL_INTERVAL / 1000}s`);
  log(`  Mode:        ${ONCE ? 'single task' : 'continuous'} ${DRY_RUN ? '(dry run)' : ''}`);
  log(`  Heartbeat interval: ${HEARTBEAT_INTERVAL}ms`);
  log(`  Rules dir:          ${RULES_DIR}`);
  log(`  Harness path:       ${HARNESS_PATH}`);
  log(`  Worktree base:      ${WORKTREE_BASE}`);

  const natsOpts = natsConnectOpts();
  nc = await connect({
    ...natsOpts,
    timeout: 5000,
    reconnect: true,
    maxReconnectAttempts: 10,
    reconnectTimeWait: 2000,
  });
  setNatsConnection(nc, sc);
  log(`Connected to NATS`);
  let draining = false;

  // Exit on permanent NATS disconnect so launchd restarts us
  (async () => {
    for await (const s of nc.status()) {
      log(`NATS status: ${s.type}`);
      if (s.type === 'disconnect') {
        log('NATS disconnected — will attempt reconnect');
      }
    }
  })();
  nc.closed().then(err => {
    if (draining && !err) return;
    log('NATS connection permanently closed — exiting for launchd restart');
    process.exit(1);
  });

  // Subscribe to alive-check requests from the daemon's stall detector
  const aliveSub = nc.subscribe(`mesh.agent.${NODE_ID}.alive`);
  (async () => {
    for await (const msg of aliveSub) {
      try {
        const { task_id } = JSON.parse(sc.decode(msg.data));
        const alive = currentTaskId != null && (task_id === currentTaskId || !task_id);
        msg.respond(sc.encode(JSON.stringify({ alive, task_id: currentTaskId })));
        log(`ALIVE CHECK: responded ${alive} (asked about ${task_id}, working on ${currentTaskId})`);
      } catch (err) {
        debug(`alive check parse failed: ${err.message}`);
        msg.respond(sc.encode(JSON.stringify({ alive: currentTaskId != null, task_id: currentTaskId })));
      }
    }
  })();
  log(`  Listening: mesh.agent.${NODE_ID}.alive`);

  // Merge-after-review (P4-4): the daemon tells the owning agent how review
  // ended. approved → merge the kept branch now; rejected → drop it.
  const approvedSub = nc.subscribe(`mesh.agent.${NODE_ID}.approved`);
  (async () => {
    for await (const msg of approvedSub) {
      try {
        const { task_id } = JSON.parse(sc.decode(msg.data));
        if (task_id) await onReviewApproved(task_id);
      } catch (err) {
        warn(`approved handler: ${err.message}`);
      }
    }
  })();
  const rejectedSub = nc.subscribe(`mesh.agent.${NODE_ID}.rejected`);
  (async () => {
    for await (const msg of rejectedSub) {
      try {
        const { task_id } = JSON.parse(sc.decode(msg.data));
        if (task_id) await onReviewRejected(task_id);
      } catch (err) {
        warn(`rejected handler: ${err.message}`);
      }
    }
  })();
  log(`  Listening: mesh.agent.${NODE_ID}.approved / .rejected`);
  const stopSubs = listenForStops();
  log(`  Listening: mesh.agent.${NODE_ID}.${STOP_NOTICES.join(' / .')}`);
  await reconcileKeptBranches();

  // Subscribe to collab recruit broadcasts — allows this node to join
  // collab sessions without being the claiming node
  const recruitSub = nc.subscribe('mesh.collab.*.recruit');
  (async () => {
    for await (const msg of recruitSub) {
      try {
        await onRecruit(JSON.parse(sc.decode(msg.data)));
      } catch (err) {
        log(`RECRUIT ERROR: ${err.message}`);
      }
    }
  })();
  log(`  Listening: mesh.collab.*.recruit (collab recruiting)`);

  while (running) {
    // Check for recruiting collab sessions before trying to claim
    await checkRecruitingSessions();
    const outcome = await claimAndRun();
    if (outcome === 'busy') {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }
    if (outcome === 'none' && ONCE) {
      log('No tasks available. Exiting (--once mode).');
      break;
    }
    // Nothing claimed, or the task errored — wait before retrying.
    if (outcome !== 'ran') await new Promise(r => setTimeout(r, POLL_INTERVAL));

    if (ONCE) break;
  }

  aliveSub.unsubscribe();
  approvedSub.unsubscribe();
  rejectedSub.unsubscribe();
  for (const sub of stopSubs) sub.unsubscribe();
  recruitSub.unsubscribe();
  draining = true;
  log('Draining NATS...');
  await nc.drain();
  if (!nc.isClosed()) throw new Error('NATS drain did not close the connection');
  log('Agent worker stopped.');
}

// ── Shutdown ──────────────────────────────────────────

process.on('SIGINT', () => { running = false; log('Received SIGINT, finishing current task...'); });
process.on('SIGTERM', () => { running = false; log('Received SIGTERM, finishing current task...'); });

if (require.main === module) {
  main().catch(err => {
    console.error(`[mesh-agent] Fatal: ${err.message}`);
    process.exit(1);
  });
}

// Test surface (no NATS): the prompt builders + harness injectors, and the Foreman
// completion gate + supervision wrapper (they spawn the task's provider, nothing else).
module.exports = { buildCirclingPrompt, buildCollabPrompt, buildInitialPrompt, buildRetryPrompt, injectRules, injectRole, injectMemory, injectHyperagentStrategy, recallForTask, prepareMemoryRecall, readNodeMemory, recordHyperagentTask, deriveExecutionClass, foremanVerify, superviseTask };
// Review-gate, worker-error and collab-round surfaces (test/mesh-agent-review-gate.test.js,
// test/mesh-agent-terminal-task.test.js, test/mesh-agent-collab-rounds.test.js): the real
// merge/review handlers, the real daemon client and error path, and the real collab round
// loop, against a real git workspace, with only the NATS connection injected.
module.exports.__test = {
  setContext(ctx) { if (ctx.nc !== undefined) nc = ctx.nc; },
  mergeIfApproved, onReviewApproved, onReviewRejected, reconcileKeptBranches,
  natsRequest, createWorktree, onWorkerError, executeCollabTask, executeTask,
  onRecruit, checkRecruitingSessions,
  claimAndRun,
  runLLM,
  runAttempts,
  onStopNotice, listenForStops,
  evaluateMetric,
  parseReflection,
};
// deploy-v7f0130b
