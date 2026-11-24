/**
 * memory-daemon-harness.mjs — runs the memory daemon's real transition and
 * Phase 2 code in a child process against a scratch node: its own
 * OPENCLAW_HOME, workspace, transcript source and recording stand-ins for the
 * scripts the daemon spawns (each appends {bin, args} to calls.jsonl).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const recorder = (name) =>
  `require('fs').appendFileSync(process.env.TEST_CALLS, JSON.stringify({ bin: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n');\n`;

export function daemonFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-harness-'));
  const fx = {
    root,
    node: path.join(root, 'node'),
    workspace: path.join(root, 'workspace'),
    transcripts: path.join(root, 'transcripts'),
    calls: path.join(root, 'calls.jsonl'),
  };
  for (const d of [path.join(fx.node, 'config'), path.join(fx.workspace, '.tmp'), path.join(fx.workspace, 'bin'), fx.transcripts, path.join(root, 'home')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(fx.node, 'config', 'transcript-sources.json'),
    JSON.stringify({ sources: [{ name: 'test', path: fx.transcripts, format: 'claude-code' }] }));
  fs.writeFileSync(path.join(fx.workspace, 'bin', 'session-recap'), recorder('session-recap'));
  fs.writeFileSync(path.join(fx.workspace, 'bin', 'clawvault-local'), `#!/usr/bin/env node\n${recorder('clawvault')}`, { mode: 0o755 });
  return fx;
}

/** A stand-in for workspace/bin/<rel> that records its argv; `.mjs` gets an ESM body. */
export function recordingBin(fx, rel, name = path.basename(rel)) {
  const body = rel.endsWith('.mjs')
    ? `import fs from 'node:fs'; fs.appendFileSync(process.env.TEST_CALLS, JSON.stringify({ bin: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n');\n`
    : recorder(name);
  fs.writeFileSync(path.join(fx.workspace, 'bin', rel), body);
}

export function transcript(fx, id, ageSec) {
  const lines = [];
  for (let i = 0; lines.join('\n').length < 2048; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    lines.push(JSON.stringify({ type: role, timestamp: '2026-11-20T00:00:00Z', message: { role, content: `${id} turn ${i}: we decided to keep the plan` } }));
  }
  const p = path.join(fx.transcripts, `${id}.jsonl`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(p, t, t);
  return p;
}

/** Runs `body` with `daemon` (the module's exports) and a test `config` in scope. */
export function runDaemon(fx, body, env = {}) {
  // A script file, not --input-type=module -e: the flush worker inherits execArgv.
  const child = path.join(fx.root, 'child.mjs');
  fs.writeFileSync(child, `
    const daemon = await import(${JSON.stringify(pathToFileURL(path.join(repo, 'workspace-bin/memory-daemon.mjs')).href)});
    const config = {
      timezone: 'UTC', clawvaultBin: 'bin/clawvault-local', memoryCharBudget: 2200, contextWindowTokens: 1,
      intervals: { sessionRecapMs: Infinity, maintenanceMs: Infinity, synthesisMs: 0, obsidianSyncMs: Infinity },
    };
    ${body}
  `);
  const r = spawnSync(process.execPath, [child], {
    cwd: repo,
    env: {
      HOME: path.join(fx.root, 'home'),
      PATH: path.dirname(process.execPath) + ':/usr/bin:/bin',
      OPENCLAW_HOME: fx.node,
      OPENCLAW_WORKSPACE: fx.workspace,
      OPENCLAW_OBS_DB: path.join(fx.root, 'obs.db'),
      OPENCLAW_NATS: 'nats://127.0.0.1:1',
      OPENCLAW_NODE_ID: 'daemon-harness',
      OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART: '1',
      USE_LLM_EXTRACTION: 'false',
      TEST_CALLS: fx.calls,
      ...env,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

export const calls = (fx) => (fs.existsSync(fx.calls)
  ? fs.readFileSync(fx.calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : []);

export const daemonLog = (fx) => fs.readFileSync(path.join(fx.workspace, '.tmp', 'memory-daemon.log'), 'utf8');

export const removeFixture = (fx) => fs.rmSync(fx.root, { recursive: true, force: true });
