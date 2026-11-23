#!/usr/bin/env node

/**
 * mesh — CLI bridge for OpenClaw ↔ NATS mesh interaction.
 *
 * ARCHITECTURE:
 *   OpenClaw (via bash tool) → mesh CLI → NATS → mesh-task-daemon / mesh-deploy-listener
 *
 * This is a short-lived process: connects to NATS, sends the request,
 * waits for a response, prints the result, exits. No daemon. No state.
 *
 * SUBCOMMANDS (`mesh help` lists them all):
 *   mesh status                          — every node in MESH_NODE_HEALTH
 *   mesh health [--all] [--json]         — ok / degraded / down from MESH_NODE_HEALTH
 *   mesh submit | tasks | plan           — the mesh task daemon (mesh.tasks.*, mesh.plans.*)
 *   mesh collab gate approve|reject      — resolve a circling session's gate (mesh.collab.gate.*)
 *   mesh deploy                          — signed fleet deploy trigger (mesh.deploy.trigger)
 *
 * The exec/capture/broadcast/repair/ls/put commands were removed: their
 * responder (~/openclaw/agent.js, subjects openclaw.<node>.*) was retired on
 * 2026-10-02, mesh-health.sh/mesh-repair.sh never shipped, and nothing synced
 * ~/openclaw/shared/ between nodes.
 *
 * ENVIRONMENT:
 *   OPENCLAW_NATS  — NATS server URL (auto-detected from env or ~/.openclaw/openclaw.env)
 */

const { connect, StringCodec } = require('nats');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { natsConnectOpts } = require('../lib/nats-resolve');
const { openMeshKv } = require('../lib/mesh-kv');
const { RESULTS_BUCKET, RESULTS_KV_OPTS, openLatestKv, writeLatestMarker } = require('../lib/deploy-latest-marker');
const { createTracer, setNatsConnection } = require('../lib/tracer');
const tracer = createTracer('mesh-cli');
const LOCAL_NODE = require('../lib/node-id').resolveNodeId();
const sc = StringCodec();

// ─── Known nodes (for --node shortcuts) ──────────────
const { loadNodeAliases, resolveNodeName, unknownNodes } = require('../lib/node-aliases');
const NODE_ALIASES = loadNodeAliases();

/**
 * Resolve a node name — accepts aliases, full IDs, or "self"/"local"
 */
function resolveNode(name) {
  return resolveNodeName(name, { localId: LOCAL_NODE, aliases: NODE_ALIASES });
}

// ─── NATS helpers ────────────────────────────────────

/**
 * Connect to NATS with a short timeout (this is a CLI tool, not a daemon).
 */
async function natsConnect() {
  const opts = natsConnectOpts();
  try {
    const nc = await connect({ ...opts, timeout: 5000 });
    setNatsConnection(nc, sc);
    return nc;
  } catch (err) {
    console.error(`Error: Cannot connect to NATS at ${opts.servers}`);
    console.error(`Is the NATS server running? Is Tailscale connected?`);
    process.exit(1);
  }
}

/**
 * Send a NATS request and wait for a response (with timeout).
 */
/**
 * Sign an operator action with this node's identity (lib/operator-auth). The
 * daemon refuses unsigned approve/reject/cancel/plan/gate requests, so the CLI
 * — which runs on the lead beside ~/.openclaw/identity.key — signs them.
 */
async function signOperatorRequest(payload) {
  const { signOperatorRequest: sign } = await import('../lib/operator-auth.mjs');
  return sign(payload);
}

async function natsRequest(nc, subject, payload, timeoutMs = 35000) {
  try {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const msg = await nc.request(subject, sc.encode(data), { timeout: timeoutMs });
    return JSON.parse(sc.decode(msg.data));
  } catch (err) {
    if (err.code === '503' || err.message?.includes('503')) {
      console.error(`Error: No responder on subject "${subject}". Is mesh-task-daemon running?`);
    } else if (err.code === 'TIMEOUT' || err.message?.includes('TIMEOUT')) {
      console.error(`Error: Request timed out after ${timeoutMs / 1000}s. The target node may be offline or the command is taking too long.`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * The task daemon answers { ok: true, data } or { ok: false, error }. A refusal
 * is a normal reply rather than a transport error, and printing fields off one
 * reported approvals that never happened ("Task approved: undefined →
 * undefined"). Every task-daemon call goes through here.
 */
async function daemonRequest(nc, subject, payload) {
  const reply = await natsRequest(nc, subject, payload);
  if (!reply.ok) {
    console.error(`Error: ${subject} refused: ${reply.error}`);
    process.exit(1);
  }
  return reply.data;
}

/**
 * MESH_NODE_HEALTH, or exit with why it cannot be read. The openclaw.*
 * heartbeat/exec/capture subjects this CLI used to talk to have no publisher
 * or responder anywhere (federation D4), and `mesh status` waited forever on them.
 */
async function loadNodeHealth(nc) {
  const { readNodeHealth, HEALTH_BUCKET } = require('../lib/mesh-node-health');
  try {
    return await readNodeHealth(nc);
  } catch (err) {
    console.error(`Error: cannot read ${HEALTH_BUCKET}: ${err.message}`);
    console.error('Is mesh-health-publisher running on any node?');
    await nc.close();
    process.exit(1);
  }
}

function formatAge(seconds) {
  if (seconds == null) return '?';
  if (seconds < 120) return `${seconds}s ago`;
  if (seconds < 7200) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

// ─── Subcommands ─────────────────────────────────────

/**
 * mesh status — every node in MESH_NODE_HEALTH: role, platform, memory, uptime, deployed sha.
 */
async function cmdStatus() {
  const { summarizeFleet } = require('../lib/mesh-node-health');
  const nc = await natsConnect();
  const { nodes } = summarizeFleet(await loadNodeHealth(nc), { localId: LOCAL_NODE, all: true });
  await nc.close();

  for (const n of nodes) {
    const local = n.nodeId === LOCAL_NODE ? ' (this machine)' : '';
    console.log(`  ${n.overall === 'down' ? '○' : '●'} ${n.nodeId}${local}  [${n.overall}]`);
    if (n.reportedAt == null) {
      console.log(`    ${n.problems.join('; ')}`);
      console.log('');
      continue;
    }
    console.log(`    Platform:     ${n.platform || '?'}`);
    console.log(`    Role:         ${n.role || '?'}`);
    console.log(`    Memory:       ${n.mem?.free ?? '?'}MB free / ${n.mem?.total ?? '?'}MB total`);
    console.log(`    Uptime:       ${n.uptimeSeconds != null ? (n.uptimeSeconds / 3600).toFixed(1) : '?'}h`);
    console.log(`    Deployed:     ${n.deployVersion || '?'}`);
    console.log(`    Reported:     ${formatAge(n.ageSeconds)}`);
    console.log('');
  }
}

/**
 * mesh submit <task.yaml|-> — submit a task to the mesh.
 *
 * Reads YAML from a file or stdin, publishes to mesh.tasks.submit.
 * Also accepts --id <task-id> to hand a queued active-tasks.md card to the mesh
 * bridge (sets execution: mesh and wakes the bridge, which dispatches it).
 */
async function cmdSubmit(args) {
  // js-yaml is the repo's declared YAML parser; the `yaml` module this required
  // was never a dependency, so `mesh submit` failed on every clean install.
  const yaml = require('js-yaml');

  // Option A: submit from active-tasks.md by ID
  const idIdx = args.indexOf('--id');
  if (idIdx >= 0 && args[idIdx + 1]) {
    const taskId = args[idIdx + 1];
    const { readTasks, updateTaskInPlace, isoTimestamp, ACTIVE_TASKS_PATH } = require('../lib/kanban-io');
    const tasks = readTasks(ACTIVE_TASKS_PATH);
    const task = tasks.find(t => t.task_id === taskId);
    if (!task) { console.error(`Task ${taskId} not found in active-tasks.md`); process.exit(1); }
    if (task.status !== 'queued') { console.error(`Task ${taskId} is ${task.status}, not queued`); process.exit(1); }

    // The bridge only follows tasks it dispatched itself, so a direct daemon submit
    // left the card stuck at 'submitted' with its claim, result and log dropped.
    // Hand the card to the bridge instead: it submits, tracks and writes back.
    await updateTaskInPlace(ACTIVE_TASKS_PATH, taskId, { execution: 'mesh', updated_at: isoTimestamp() });
    const nc = await natsConnect();
    nc.publish('mesh.bridge.wake');
    await nc.flush();
    console.log(`Queued for mesh: ${taskId} (execution: mesh). The mesh bridge submits it and tracks it to completion.`);
    console.log('Needs a running mesh-bridge; the card stays queued until one picks it up.');
    await nc.close();
    return;
  }

  // Option B: read YAML from file or stdin
  let input;
  const filePath = args.find(a => !a.startsWith('-'));
  if (filePath && filePath !== '-') {
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    input = fs.readFileSync(filePath, 'utf8');
  } else {
    // Stdin mode — but only if actually piped (not interactive TTY)
    if (process.stdin.isTTY) {
      console.error('Usage: mesh submit <task.yaml>');
      console.error('       mesh submit --id <task-id>');
      console.error('       cat task.yaml | mesh submit');
      process.exit(1);
    }
    // Read from stdin with 5s timeout
    const chunks = [];
    process.stdin.setEncoding('utf8');
    const stdinTimeout = setTimeout(() => {
      console.error('Error: stdin read timed out after 5s');
      process.exit(1);
    }, 5000);
    for await (const chunk of process.stdin) { chunks.push(chunk); }
    clearTimeout(stdinTimeout);
    input = chunks.join('');
  }

  if (!input.trim()) { console.error('No input. Provide a YAML file or pipe from stdin.'); process.exit(1); }

  const task = yaml.load(input);
  if (!task.task_id || !task.title) { console.error('YAML must have task_id and title.'); process.exit(1); }

  const nc = await natsConnect();
  const submitted = await daemonRequest(nc, 'mesh.tasks.submit', {
    task_id: task.task_id,
    title: task.title,
    description: task.description || '',
    budget_minutes: task.budget_minutes || 30,
    metric: task.metric || null,
    on_fail: task.on_fail || 'revert and log approach',
    success_criteria: task.success_criteria || [],
    scope: task.scope || [],
    priority: task.priority || 0,
    tags: task.tags || [],
    llm_provider: task.provider || task.llm_provider || null,
    llm_model: task.model || task.llm_model || null,
    preferred_nodes: task.preferred_nodes || [],
    exclude_nodes: task.exclude_nodes || [],
    collaboration: task.collaboration || undefined,
  });

  console.log(`Submitted: ${submitted.task_id} "${submitted.title}"`);
  console.log(`  Status:  ${submitted.status}`);
  console.log(`  Budget:  ${submitted.budget_minutes}m`);
  console.log(`  Metric:  ${submitted.metric || 'none'}`);
  if (submitted.llm_provider) console.log(`  Provider: ${submitted.llm_provider}`);
  await nc.close();
}

/**
 * mesh tasks [--status <filter>] — list mesh tasks.
 */
async function cmdTasks(args) {
  const subCmd = args[0];

  // Subcommands: approve, reject
  if (subCmd === 'approve') {
    const taskId = args[1];
    if (!taskId) { console.error('Usage: mesh tasks approve <task-id>'); process.exit(1); }
    const nc = await natsConnect();
    try {
      const task = await daemonRequest(nc, 'mesh.tasks.approve', await signOperatorRequest({ task_id: taskId }));
      console.log(`Task approved: ${task.task_id} → ${task.status}`);
    } finally { await nc.close(); }
    return;
  }

  if (subCmd === 'reject') {
    const taskId = args[1];
    if (!taskId) { console.error('Usage: mesh tasks reject <task-id> [--reason "..."]'); process.exit(1); }
    let reason = 'Rejected by reviewer';
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--reason' && args[i + 1]) { reason = args[++i]; }
    }
    const nc = await natsConnect();
    try {
      const task = await daemonRequest(nc, 'mesh.tasks.reject', await signOperatorRequest({ task_id: taskId, reason }));
      // markRejected re-queues, or fails the task once the rejection cap is reached.
      console.log(`Task rejected: ${task.task_id} → ${task.status === 'queued' ? 're-queued' : `${task.status} (rejection cap reached)`}`);
      console.log(`  Reason: ${reason}`);
    } finally { await nc.close(); }
    return;
  }

  if (subCmd === 'review') {
    // List only pending_review tasks
    const nc = await natsConnect();
    const tasks = await daemonRequest(nc, 'mesh.tasks.list', { status: 'pending_review' });
    if (tasks.length === 0) {
      console.log('No tasks pending review.');
      await nc.close();
      return;
    }
    console.log(`Tasks pending review (${tasks.length}):\n`);
    for (const t of tasks) {
      console.log(`  ${t.task_id}  "${t.title}"`);
      if (t.result?.summary) console.log(`    Result: ${t.result.summary.slice(0, 200)}`);
      if (t.result?.harness?.warnings?.length) {
        console.log(`    Harness warnings: ${t.result.harness.warnings.length}`);
      }
      console.log(`    Approve: mesh tasks approve ${t.task_id}`);
      console.log(`    Reject:  mesh tasks reject ${t.task_id} --reason "..."`);
      console.log('');
    }
    await nc.close();
    return;
  }

  // Default: list all tasks
  const nc = await natsConnect();
  const filter = {};
  const statusIdx = args.indexOf('--status');
  if (statusIdx >= 0 && args[statusIdx + 1]) filter.status = args[statusIdx + 1];

  const tasks = await daemonRequest(nc, 'mesh.tasks.list', filter);

  if (tasks.length === 0) {
    console.log('No tasks in mesh.');
    await nc.close();
    return;
  }

  for (const t of tasks) {
    const elapsed = t.started_at && t.completed_at
      ? ((new Date(t.completed_at) - new Date(t.started_at)) / 1000).toFixed(0) + 's'
      : t.started_at
        ? ((Date.now() - new Date(t.started_at)) / 1000).toFixed(0) + 's (running)'
        : '-';
    const reviewTag = t.status === 'pending_review' ? ' ⏳' : '';
    console.log(`  ${t.task_id}  [${t.status}]${reviewTag}  "${t.title}"`);
    console.log(`    Owner: ${t.owner || '-'}  Elapsed: ${elapsed}  Attempts: ${t.attempts.length}`);
    if (t.metric) console.log(`    Metric: ${t.metric}`);
    if (t.result?.summary) console.log(`    Result: ${t.result.summary.slice(0, 120)}`);
    console.log('');
  }

  await nc.close();
}

/**
 * mesh health [--json] [--all] — ok / degraded / down for this node (or every
 * node) from MESH_NODE_HEALTH. Exits 1 unless everything reported is ok.
 */
async function cmdHealth(args) {
  const { summarizeFleet } = require('../lib/mesh-node-health');
  const jsonMode = args.includes('--json');
  const nc = await natsConnect();
  const report = summarizeFleet(await loadNodeHealth(nc), { localId: LOCAL_NODE, all: args.includes('--all') });
  await nc.close();

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const n of report.nodes) {
      console.log(`${n.overall.toUpperCase().padEnd(9)}${n.nodeId}${n.nodeId === LOCAL_NODE ? ' (this machine)' : ''}`);
      for (const p of n.problems) console.log(`  - ${p}`);
    }
    console.log(`\nOverall: ${report.overall}`);
  }
  process.exitCode = report.overall === 'ok' ? 0 : 1;
}

/**
 * mesh deploy [--force] [--component <name>] [--node <name>] — trigger fleet deploy.
 *
 * Publishes mesh.deploy.trigger to NATS. All nodes with mesh-deploy-listener
 * will pull from git and self-deploy. Polls MESH_DEPLOY_RESULTS for status.
 */
async function cmdDeploy(args) {
  const { execSync } = require('child_process');
  // Prefer openclaw-node (git repo) over openclaw (runtime)
  const defaultRepo = fs.existsSync(path.join(os.homedir(), 'openclaw-node', '.git'))
    ? path.join(os.homedir(), 'openclaw-node')
    : path.join(os.homedir(), 'openclaw');
  const repoDir = process.env.OPENCLAW_REPO_DIR || defaultRepo;
  const force = args.includes('--force');
  // bin/mesh-deploy.js documents --dry-run/--status/--rollback/--local under this
  // same name; here any of them would still publish a real fleet trigger.
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--component' || args[i] === '--node') { i++; continue; }
    if (args[i] !== '--force') {
      console.error(`mesh deploy: unknown option ${args[i]} (this command always triggers a real fleet deploy)`);
      console.error('  --dry-run, --status, --rollback, --local and --to belong to: node bin/mesh-deploy.js');
      process.exit(2);
    }
  }

  // Parse --component flags
  const components = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--component' && args[i + 1]) {
      components.push(args[i + 1]);
      i++;
    }
  }

  // Parse --node flags (target specific nodes, default: all)
  const targetNodes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--node' && args[i + 1]) {
      targetNodes.push(resolveNode(args[i + 1]));
      i++;
    }
  }

  // Get current SHA and branch
  let sha, branch;
  try {
    sha = execSync('git rev-parse --short HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
    branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
    if (branch === 'HEAD') branch = process.env.OPENCLAW_DEPLOY_BRANCH || 'main';
  } catch {
    console.error(`Error: Cannot read git state from ${repoDir}`);
    process.exit(1);
  }

  console.log(`Deploying ${sha} (${branch})${force ? ' [FORCE]' : ''}`);
  if (components.length > 0) console.log(`  Components: ${components.join(', ')}`);
  if (targetNodes.length > 0) console.log(`  Targets: ${targetNodes.join(', ')}`);
  else console.log('  Targets: all nodes');

  const nc = await natsConnect();
  // The fleet registry, not the alias table: aliases only ever named the two original VMs.
  const known = await require('./fleet-deploy').discoverNodes(nc);
  const unknown = unknownNodes(targetNodes, known);
  if (unknown.length > 0) {
    console.error(`mesh deploy: unknown node ${unknown.join(', ')} — known: ${known.map(n => n.nodeId).join(', ') || 'none'}`);
    await nc.close();
    process.exit(2);
  }

  const trigger = {
    sha,
    branch,
    components: components.length > 0 ? components : ['all'],
    nodes: targetNodes.length > 0 ? targetNodes : ['all'],
    force,
    initiator: LOCAL_NODE,
    timestamp: new Date().toISOString(),
  };

  // Sign the trigger (best-effort) so signed-deploy listeners accept it. C2:
  // harmless when no listener enforces signatures; required once they do.
  const { maybeSignDeployTrigger } = await import('../lib/deploy-trigger-auth.mjs');
  const signedTrigger = maybeSignDeployTrigger(trigger);

  // Write "latest" marker so offline nodes can catch up. Same signed trigger —
  // an unsigned marker let anyone with KV write access steer catching-up nodes.
  // Only a fleet-wide deploy moves it: a node that missed one and comes back
  // after a targeted deploy must still catch up to it.
  if (trigger.nodes.includes('all')) {
    try {
      const js = nc.jetstream();
      const resultsKv = await openMeshKv(js, RESULTS_BUCKET, RESULTS_KV_OPTS, { waitMs: 0 });
      await writeLatestMarker({ latestKv: await openLatestKv(js, { waitMs: 0 }), resultsKv }, signedTrigger);
    } catch (err) { console.warn(`[mesh] write deploy latest marker: ${err.message}`); }
  } else {
    console.log('targeted deploy: catch-up marker unchanged');
  }

  // Publish trigger
  nc.publish('mesh.deploy.trigger', sc.encode(JSON.stringify(signedTrigger)));
  await nc.flush();
  console.log('Deploy trigger sent.\n');

  // Poll for results (10s timeout)
  console.log('Waiting for node responses...');
  const deadline = Date.now() + 15000;
  const seen = new Set();

  try {
    const js = nc.jetstream();
    const resultsKv = await openMeshKv(js, RESULTS_BUCKET, {}, { waitMs: 0 });
    const checkNodes = targetNodes.length > 0 ? targetNodes : known.map(n => n.nodeId);

    while (Date.now() < deadline) {
      for (const nodeId of checkNodes) {
        if (seen.has(nodeId)) continue;
        const key = `${sha}-${nodeId}`;
        try {
          const entry = await resultsKv.get(key);
          if (entry && entry.value) {
            const result = JSON.parse(sc.decode(entry.value));
            if (result.status === 'success' || result.status === 'failed' || result.status === 'skipped') {
              const icon = result.status === 'success' ? '\x1b[32m✓\x1b[0m' : result.status === 'skipped' ? '\x1b[33m-\x1b[0m' : '\x1b[31m✗\x1b[0m';
              console.log(`  ${icon} ${nodeId}: ${result.status} (${result.durationSeconds || 0}s)`);
              if (result.errors && result.errors.length > 0) {
                for (const e of result.errors) console.log(`    Error: ${e}`);
              }
              seen.add(nodeId);
            }
          }
        } catch (err) { console.warn(`[mesh] poll deploy result for node: ${err.message}`); }
      }

      if (seen.size >= checkNodes.length) break;
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) { console.warn(`[mesh] poll deploy results: ${err.message}`); }

  if (seen.size === 0) {
    console.log('  (no responses yet — nodes may still be deploying)');
  }

  console.log('');
  await nc.close();
}

// ── Collab Commands ────────────────────────────────

/**
 * mesh collab gate approve|reject <session-id> — a circling session waiting at
 * a gate (tier gate or blocked finalization) resumes only on a signed operator
 * request; before this nothing could send one but a hand-built NATS message.
 */
async function cmdCollab(args) {
  const [sub, decision, sessionId] = args;
  if (sub !== 'gate' || !['approve', 'reject'].includes(decision) || !sessionId) {
    console.error('Usage: mesh collab gate approve|reject <session-id>');
    process.exit(1);
  }
  const nc = await natsConnect();
  try {
    const result = await daemonRequest(nc, `mesh.collab.gate.${decision}`, await signOperatorRequest({ session_id: sessionId }));
    if (decision === 'approve') console.log(`Gate approved: ${sessionId} resumes`);
    else console.log(`Gate rejected: ${sessionId} → sub-round ${result.new_subround}`);
  } finally { await nc.close(); }
}

/**
 * mesh help — show usage.
 */
// ── Plan Commands ──────────────────────────────────

async function cmdPlan(args) {
  const { loadTemplate, listTemplates, validateTemplate, instantiateTemplate } = require('../lib/plan-templates');
  const TEMPLATES_DIR = process.env.OPENCLAW_TEMPLATES_DIR || path.join(process.env.HOME, '.openclaw', 'plan-templates');
  const FALLBACK_DIR = path.join(__dirname, '..', 'config', 'plan-templates');

  const sub = args[0];

  switch (sub) {
    case 'templates': {
      // List available templates
      const templates = [
        ...listTemplates(TEMPLATES_DIR),
        ...listTemplates(FALLBACK_DIR),
      ];
      // Deduplicate by id
      const seen = new Set();
      const unique = templates.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });

      if (unique.length === 0) {
        console.log('No plan templates found.');
        console.log(`Checked: ${TEMPLATES_DIR}`);
        return;
      }

      console.log('Available plan templates:\n');
      for (const t of unique) {
        console.log(`  ${t.id.padEnd(20)} ${t.description}`);
      }
      return;
    }

    case 'create': {
      // Parse --template, --context, --parent-task, and --set flags
      let templateId = null;
      let context = '';
      let parentTaskId = null;
      const overrides = []; // [{path: 'implement.delegation.mode', value: 'collab_mesh'}, ...]

      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--template' && args[i + 1]) { templateId = args[++i]; continue; }
        if (args[i] === '--context' && args[i + 1]) { context = args[++i]; continue; }
        if (args[i] === '--parent-task' && args[i + 1]) { parentTaskId = args[++i]; continue; }
        if (args[i] === '--set' && args[i + 1]) {
          // Format: subtask_id.field.path=value
          const raw = args[++i];
          const eqIdx = raw.indexOf('=');
          if (eqIdx === -1) {
            console.error(`Invalid --set format: "${raw}" (expected subtask_id.field=value)`);
            process.exit(1);
          }
          overrides.push({ path: raw.slice(0, eqIdx), value: raw.slice(eqIdx + 1) });
          continue;
        }
      }

      if (!templateId || !parentTaskId) {
        console.error('Usage: mesh plan create --template <id> --parent-task <task-id> --context "<description>" [--set subtask.field=value]');
        process.exit(1);
      }

      // Find template file
      let templatePath = null;
      for (const dir of [TEMPLATES_DIR, FALLBACK_DIR]) {
        const candidate = path.join(dir, `${templateId}.yaml`);
        if (fs.existsSync(candidate)) { templatePath = candidate; break; }
        const candidateYml = path.join(dir, `${templateId}.yml`);
        if (fs.existsSync(candidateYml)) { templatePath = candidateYml; break; }
      }

      if (!templatePath) {
        console.error(`Template not found: ${templateId}`);
        console.error(`Run "mesh plan templates" to see available templates.`);
        process.exit(1);
      }

      const template = loadTemplate(templatePath);
      const validation = validateTemplate(template);
      if (!validation.valid) {
        console.error('Template validation failed:');
        validation.errors.forEach(e => console.error(`  - ${e}`));
        process.exit(1);
      }

      const plan = instantiateTemplate(template, context, { parent_task_id: parentTaskId });

      // Apply --set overrides to instantiated plan subtasks
      // Format: subtask_id.field.nested=value (e.g., implement.delegation.mode=collab_mesh)
      for (const { path: setPath, value } of overrides) {
        const parts = setPath.split('.');
        const subtaskId = parts[0];
        const st = plan.subtasks.find(s => s.subtask_id === subtaskId);
        if (!st) {
          console.error(`--set: unknown subtask "${subtaskId}". Available: ${plan.subtasks.map(s => s.subtask_id).join(', ')}`);
          process.exit(1);
        }
        // Walk the nested path and set the value
        let target = st;
        for (let j = 1; j < parts.length - 1; j++) {
          if (target[parts[j]] === undefined || target[parts[j]] === null) target[parts[j]] = {};
          target = target[parts[j]];
        }
        const finalKey = parts[parts.length - 1];
        // Auto-coerce numbers and booleans
        let coerced = value;
        if (value === 'true') coerced = true;
        else if (value === 'false') coerced = false;
        else if (/^\d+$/.test(value)) coerced = parseInt(value, 10);
        target[finalKey] = coerced;
      }

      // Submit to mesh via NATS
      const nc = await connect({ ...natsConnectOpts(), timeout: 5000 });
      try {
        // The daemon honours requires_approval:false only on an operator-signed create.
        const request = plan.requires_approval === false ? await signOperatorRequest(plan) : plan;
        const result = await daemonRequest(nc, 'mesh.plans.create', request);
        console.log(`Plan created: ${result.plan_id}`);
        console.log(`  Subtasks: ${result.subtasks.length}`);
        console.log(`  Waves: ${result.estimated_waves}`);
        console.log(`  Budget: ${result.total_budget_minutes}min`);
        console.log(`  Status: ${result.status}`);
        if (result.requires_approval) {
          console.log(`\n  Approve with: mesh plan approve ${result.plan_id}`);
        }
      } finally {
        await nc.close();
      }
      return;
    }

    case 'list': {
      let statusFilter = null;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--status' && args[i + 1]) { statusFilter = args[++i]; }
      }

      const nc = await connect({ ...natsConnectOpts(), timeout: 5000 });
      try {
        const payload = statusFilter ? { status: statusFilter } : {};
        const plans = await daemonRequest(nc, 'mesh.plans.list', payload);
        if (plans.length === 0) {
          console.log('No plans found.');
          return;
        }

        console.log(`Plans (${plans.length}):\n`);
        for (const p of plans) {
          const status = p.status.padEnd(12);
          const subtasks = `${p.total_subtasks} subtasks`;
          console.log(`  ${p.plan_id}  ${status}  ${subtasks}  "${p.title}"`);
        }
      } finally {
        await nc.close();
      }
      return;
    }

    case 'show': {
      const planId = args[1];
      if (!planId) {
        console.error('Usage: mesh plan show <plan-id>');
        process.exit(1);
      }

      const nc = await connect({ ...natsConnectOpts(), timeout: 5000 });
      try {
        const plan = await daemonRequest(nc, 'mesh.plans.get', { plan_id: planId });

        // Header
        console.log(`\nPlan: ${plan.plan_id}`);
        console.log(`  Title:    ${plan.title}`);
        console.log(`  Status:   ${plan.status}`);
        console.log(`  Policy:   ${plan.failure_policy || 'continue_best_effort'}`);
        console.log(`  Approval: ${plan.requires_approval ? 'required' : 'auto'}`);
        if (plan.created_at) console.log(`  Created:  ${plan.created_at}`);
        if (plan.parent_task_id) console.log(`  Parent:   ${plan.parent_task_id}`);

        // Compute waves from subtask dependencies
        const subtasks = plan.subtasks || [];
        const waves = new Map();
        for (const st of subtasks) {
          const wave = st.wave ?? 0;
          if (!waves.has(wave)) waves.set(wave, []);
          waves.get(wave).push(st);
        }

        // If no wave field, group by dependency depth
        if (waves.size <= 1 && subtasks.length > 1) {
          waves.clear();
          const idToSt = new Map(subtasks.map(s => [s.subtask_id, s]));
          const depths = new Map();
          function getDepth(id) {
            if (depths.has(id)) return depths.get(id);
            const st = idToSt.get(id);
            if (!st || !st.depends_on || st.depends_on.length === 0) { depths.set(id, 0); return 0; }
            const d = 1 + Math.max(...st.depends_on.map(dep => getDepth(dep)));
            depths.set(id, d);
            return d;
          }
          for (const st of subtasks) getDepth(st.subtask_id);
          for (const st of subtasks) {
            const w = depths.get(st.subtask_id) || 0;
            if (!waves.has(w)) waves.set(w, []);
            waves.get(w).push(st);
          }
        }

        // Render subtask tree
        const sortedWaves = [...waves.keys()].sort((a, b) => a - b);
        for (const w of sortedWaves) {
          console.log(`\n  ── Wave ${w} ${'─'.repeat(50)}`);
          for (const st of waves.get(w)) {
            const status = (st.status || 'pending').toUpperCase();
            const critical = st.critical ? ' [CRITICAL]' : '';
            const mode = st.delegation?.mode || 'auto';
            const reason = st.delegation?.reason ? ` (${st.delegation.reason})` : '';
            const budget = st.budget_minutes ? ` ${st.budget_minutes}min` : '';
            const metric = st.metric ? ` metric:"${st.metric}"` : '';
            const deps = st.depends_on?.length ? ` deps:[${st.depends_on.join(',')}]` : '';

            console.log(`    ${status.padEnd(10)} ${st.subtask_id}${critical}`);
            console.log(`               "${st.title}"`);
            console.log(`               route:${mode}${reason}${budget}${metric}${deps}`);

            if (st.result) {
              const success = st.result.success ? '✓' : '✗';
              const summary = st.result.summary || '';
              console.log(`               result: ${success} ${summary}`);
            }
          }
        }

        // Summary
        const completed = subtasks.filter(s => s.status === 'completed').length;
        const failed = subtasks.filter(s => s.status === 'failed').length;
        const blocked = subtasks.filter(s => s.status === 'blocked').length;
        const pending = subtasks.filter(s => s.status === 'pending' || s.status === 'queued').length;
        const running = subtasks.filter(s => s.status === 'running').length;
        console.log(`\n  Summary: ${subtasks.length} subtasks — ${completed} done, ${running} running, ${pending} pending, ${failed} failed, ${blocked} blocked`);

      } finally {
        await nc.close();
      }
      return;
    }

    case 'approve': {
      const planId = args[1];
      if (!planId) {
        console.error('Usage: mesh plan approve <plan-id>');
        process.exit(1);
      }

      const nc = await connect({ ...natsConnectOpts(), timeout: 5000 });
      try {
        const result = await daemonRequest(nc, 'mesh.plans.approve', await signOperatorRequest({ plan_id: planId }));
        console.log(`Plan approved: ${result.plan_id}`);
        console.log(`  Status: ${result.status}`);
        console.log(`  Wave 0 dispatched with ${result.subtasks.filter(s => s.status !== 'pending').length} subtasks`);
      } finally {
        await nc.close();
      }
      return;
    }

    case 'abort': {
      const planId = args[1];
      let reason = 'Manual abort';
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--reason' && args[i + 1]) { reason = args[++i]; }
      }

      if (!planId) {
        console.error('Usage: mesh plan abort <plan-id> [--reason "..."]');
        process.exit(1);
      }

      const nc = await connect({ ...natsConnectOpts(), timeout: 5000 });
      try {
        const result = await daemonRequest(nc, 'mesh.plans.abort', await signOperatorRequest({ plan_id: planId, reason }));
        console.log(`Plan aborted: ${result.plan_id}`);
      } finally {
        await nc.close();
      }
      return;
    }

    default:
      console.log([
        '',
        'mesh plan -- Plan management commands',
        '',
        '  mesh plan templates                     List available templates',
        '  mesh plan create --template <id>        Create plan from template',
        '    --parent-task <task-id>                Existing task the plan belongs to (required)',
        '    --context "<description>"              Context for template variables',
        '    --set subtask.field=value              Override subtask fields post-instantiation',
        '                                           e.g., --set implement.delegation.mode=collab_mesh',
        '                                                 --set test.budget_minutes=30',
        '  mesh plan list                          List all plans',
        '    --status <status>                      Filter by status',
        '  mesh plan show <plan-id>                Show full plan with subtask tree',
        '  mesh plan approve <plan-id>             Approve and start executing',
        '  mesh plan abort <plan-id>               Abort a plan',
        '    --reason "..."                         Reason for abort',
        '',
      ].join('\n'));
  }
}

function cmdHelp() {
  console.log([
    '',
    'mesh -- OpenClaw multi-node mesh CLI',
    '',
    'USAGE:',
    '  mesh status                             Every node in MESH_NODE_HEALTH',
    '  mesh submit <task.yaml>                 Submit a task YAML to the mesh',
    '  mesh submit --id <task-id>              Queue a kanban card for the mesh bridge',
    '  cat task.yaml | mesh submit             Submit from stdin',
    '  mesh tasks                              List all mesh tasks',
    '  mesh tasks --status running             Filter mesh tasks by status',
    '  mesh tasks review                       List tasks pending human review',
    '  mesh tasks approve <task-id>            Approve a pending_review task',
    '  mesh tasks reject <task-id>             Reject and re-queue a task',
    '    --reason "..."                         Reason for rejection',
    '  mesh plan <subcommand>                  Plan management (templates, create, approve)',
    '  mesh collab gate approve <session-id>   Resume a circling session waiting at its gate',
    '  mesh collab gate reject <session-id>    Send it back for another sub-round',
    '  mesh health                             ok / degraded / down for this node',
    '  mesh health --all                       ... for every node in MESH_NODE_HEALTH',
    '  mesh health --json                      Same, as JSON (exit 1 unless all ok)',
    '  mesh deploy                             Deploy to all nodes',
    '  mesh deploy --force                     Force deploy (skip cache)',
    '  mesh deploy --node ubuntu               Deploy to specific node',
    '  mesh deploy --component mesh-daemons    Deploy specific component',
    '',
    'NODE ALIASES:',
    '  ubuntu, linux, calos  = Ubuntu VM (calos-vmware-virtual-platform)',
    '  mac, macos, moltymac  = macOS VM (moltymacs-virtual-machine)',
    '  self, local           = this node',
    '  ~/.openclaw/mesh-aliases.json adds more (openclaw-node-init writes it)',
    '',
    'ENVIRONMENT:',
    '  OPENCLAW_NATS  -- NATS server URL (auto-detected from env or ~/.openclaw/openclaw.env)',
    '',
  ].join('\n'));
}

// --- Tracer Instrumentation -------------------------------------------
cmdStatus = tracer.wrapAsync('cmdStatus', cmdStatus, { tier: 2 });
cmdSubmit = tracer.wrapAsync('cmdSubmit', cmdSubmit, { tier: 2 });
cmdTasks = tracer.wrapAsync('cmdTasks', cmdTasks, { tier: 2 });
cmdHealth = tracer.wrapAsync('cmdHealth', cmdHealth, { tier: 2 });
cmdDeploy = tracer.wrapAsync('cmdDeploy', cmdDeploy, { tier: 2 });
cmdPlan = tracer.wrapAsync('cmdPlan', cmdPlan, { tier: 2 });
cmdCollab = tracer.wrapAsync('cmdCollab', cmdCollab, { tier: 2 });

// --- Main dispatch ---------------------------------------------------

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case 'status':    return cmdStatus();
    case 'submit':    return cmdSubmit(args);
    case 'tasks':     return cmdTasks(args);
    case 'health':    return cmdHealth(args);
    case 'deploy':    return cmdDeploy(args);
    case 'plan':      return cmdPlan(args);
    case 'collab':    return cmdCollab(args);
    case 'help':
    case '--help':
    case '-h':        return cmdHelp();
    default:
      if (!cmd) return cmdHelp();
      console.error(`Unknown command: ${cmd}`);
      console.error(`Run "mesh help" for usage.`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`mesh error: ${err.message}`);
  process.exit(1);
});
