/**
 * transcript-sources.test.mjs — one reader of config/transcript-sources.json.
 *
 * memory-daemon, session-recap, session-search --import and heartbeat-detect
 * each carried their own copy of the registry loader, with different roots and
 * fallbacks: session-search fell back to three default folders whenever no
 * source was enabled (so switching every source off still imported them), and
 * session-recap read ~/.openclaw under any OPENCLAW_HOME plus a .txt list that
 * nothing writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const CALLERS = [
  'workspace-bin/memory-daemon.mjs',
  'workspace-bin/session-recap',
  'workspace-bin/session-search.mjs',
  'lib/heartbeat-detect.mjs',
];

function claudeLines(marker) {
  const lines = [];
  for (let i = 0; lines.join('\n').length < 2048; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    lines.push(JSON.stringify({ type: role, timestamp: '2026-11-17T00:00:00Z', message: { role, content: `${marker} turn ${i} about the plan` } }));
  }
  return lines.join('\n') + '\n';
}

function gatewayLines(marker) {
  const lines = [];
  for (let i = 0; lines.join('\n').length < 2048; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    lines.push(JSON.stringify({ type: 'message', timestamp: '2026-11-17T00:00:00Z', message: { role, content: `${marker} turn ${i} about the plan` } }));
  }
  return lines.join('\n') + '\n';
}

// A HOME with one session in each default transcript folder, the workspace
// being this checkout (what both CLIs use when OPENCLAW_WORKSPACE is unset).
function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-sources-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const openclaw = path.join(home, '.openclaw');
  const dirs = {
    'claude-code': path.join(home, '.claude', 'projects', ROOT.replace(/[/.]/g, '-')),
    'claude-home': path.join(home, '.claude', 'projects', '-' + path.basename(home)),
    gateway: path.join(openclaw, 'agents', 'main', 'sessions'),
  };
  for (const [name, dir] of Object.entries(dirs)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}-0001.jsonl`), name === 'gateway' ? gatewayLines(name) : claudeLines(name));
  }
  const writeRegistry = (root, sources) => {
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'transcript-sources.json'), JSON.stringify({ sources }));
  };
  const env = (extra = {}) => {
    const e = { ...process.env, HOME: home, ...extra };
    delete e.OPENCLAW_WORKSPACE;
    if (!('OPENCLAW_HOME' in extra)) delete e.OPENCLAW_HOME;
    return e;
  };
  return { home, openclaw, dirs, writeRegistry, env };
}

function recapCount(env) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'workspace-bin/session-recap'), '--list'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return Number(r.stdout.match(/Found (\d+) JSONL transcripts/)[1]);
}

function searchImported(env) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'workspace-bin/session-search.mjs'), '--import', '--json'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop()).imported;
}

test('loadTranscriptSources: enabled registry sources with ~ expanded; the defaults only without a readable registry', async (t) => {
  const { loadTranscriptSources } = await import('../lib/transcript-sources.mjs');
  const { home, openclaw, writeRegistry } = setup(t);
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = savedHome; });
  const ws = path.join(home, 'ws');
  fs.mkdirSync(ws);
  const defaults = [
    { name: 'claude-code', path: path.join(home, '.claude', 'projects', ws.replace(/[/.]/g, '-')), format: 'claude-code' },
    { name: 'claude-home', path: path.join(home, '.claude', 'projects', '-' + path.basename(home)), format: 'claude-code' },
    { name: 'gateway', path: path.join(openclaw, 'agents', 'main', 'sessions'), format: 'openclaw-gateway' },
  ];

  assert.deepEqual(loadTranscriptSources(openclaw, { workspace: ws }), defaults, 'no registry');

  fs.mkdirSync(path.join(openclaw, 'config'), { recursive: true });
  fs.writeFileSync(path.join(openclaw, 'config', 'transcript-sources.json'), '{not json');
  const warnings = [];
  assert.deepEqual(loadTranscriptSources(openclaw, { workspace: ws, warn: (m) => warnings.push(m) }), defaults, 'unparseable registry');
  assert.equal(warnings.length, 1);

  writeRegistry(openclaw, [{ name: 'gateway', path: '/x', format: 'openclaw-gateway', enabled: false }]);
  assert.deepEqual(loadTranscriptSources(openclaw, { workspace: ws }), [], 'every source disabled');

  writeRegistry(openclaw, [
    { name: 'kimi', path: '~/kimi/sessions', format: 'generic' },
    { name: 'off', path: '/off', enabled: false },
    { name: 'broken' },
    { name: 'abs', path: '/abs/sessions', format: 'claude-code', enabled: true },
  ]);
  assert.deepEqual(loadTranscriptSources(openclaw, { workspace: ws }), [
    { name: 'kimi', path: path.join(home, 'kimi/sessions'), format: 'generic' },
    { name: 'abs', path: '/abs/sessions', format: 'claude-code', enabled: true },
  ]);
});

test('loadTranscriptSources resolves the node root through OPENCLAW_HOME', async (t) => {
  const { loadTranscriptSources } = await import('../lib/transcript-sources.mjs');
  const { home, writeRegistry } = setup(t);
  const nodeRoot = path.join(home, 'node-b');
  writeRegistry(nodeRoot, [{ name: 'b', path: '/b/sessions', format: 'generic' }]);
  const saved = process.env.OPENCLAW_HOME;
  process.env.OPENCLAW_HOME = nodeRoot;
  t.after(() => { if (saved === undefined) delete process.env.OPENCLAW_HOME; else process.env.OPENCLAW_HOME = saved; });
  assert.deepEqual(loadTranscriptSources(undefined, { workspace: home }), [{ name: 'b', path: '/b/sessions', format: 'generic' }]);
});

test('without a registry every caller reads the same three default folders', async (t) => {
  const { openclaw, env } = setup(t);
  assert.equal(recapCount(env()), 3);
  assert.equal(searchImported(env()), 3);
  const { detectHeartbeat } = await import('../lib/heartbeat-detect.mjs');
  assert.equal(detectHeartbeat({ workspace: ROOT, openclawRoot: openclaw }).sessionType, 'main', 'the default gateway folder is read');
});

test('a registry whose only source is disabled yields no transcripts from any caller', async (t) => {
  const { openclaw, dirs, writeRegistry, env } = setup(t);
  writeRegistry(openclaw, [{ name: 'gateway', path: dirs.gateway, format: 'openclaw-gateway', enabled: false }]);
  assert.equal(recapCount(env()), 0);
  assert.equal(searchImported(env()), 0);
  const { detectHeartbeat } = await import('../lib/heartbeat-detect.mjs');
  assert.equal(detectHeartbeat({ workspace: ROOT, openclawRoot: openclaw }).sessionType, 'unknown');
});

test('the CLIs read the registry of the OPENCLAW_HOME node, not ~/.openclaw', (t) => {
  const { home, writeRegistry, env } = setup(t);
  const nodeRoot = path.join(home, 'node-b');
  const only = path.join(home, 'node-b-sessions');
  fs.mkdirSync(only);
  fs.writeFileSync(path.join(only, 'b-0001.jsonl'), claudeLines('node-b'));
  writeRegistry(nodeRoot, [{ name: 'b', path: only, format: 'claude-code' }]);
  assert.equal(recapCount(env({ OPENCLAW_HOME: nodeRoot })), 1);
  assert.equal(searchImported(env({ OPENCLAW_HOME: nodeRoot })), 1);
});

test('no caller keeps its own copy of the registry loader or the default list', () => {
  for (const rel of CALLERS) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /\/transcript-sources\.mjs['"]/, `${rel} uses the shared loader`);
    assert.doesNotMatch(src, /transcript-sources\.(json|txt)['"]/, `${rel} opens no registry file itself`);
    assert.doesNotMatch(src, /\.claude\/projects|'\.claude', 'projects'/, `${rel} carries no default list`);
  }
});
