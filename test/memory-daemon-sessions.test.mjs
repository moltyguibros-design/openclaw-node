/**
 * memory-daemon-sessions.test.mjs — with several transcripts written at once,
 * each daemon job works on the session it is about. The interval synthesis,
 * the NATS-requested flush, the idle recap and the boot recap of "the previous
 * session" used to take the newest (or second-newest) file by mtime, which
 * belongs to whichever concurrent session wrote last.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const recorder = (name) =>
  `require('fs').appendFileSync(process.env.TEST_CALLS, JSON.stringify({ bin: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n');\n`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-sessions-'));
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

function transcript(fx, id, ageSec) {
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

function runDaemon(fx, body) {
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
      OPENCLAW_NODE_ID: 'sessions-test',
      OPENCLAW_MEMORY_DAEMON_NO_AUTOSTART: '1',
      USE_LLM_EXTRACTION: 'false',
      TEST_CALLS: fx.calls,
    },
    encoding: 'utf8',
    timeout: 60000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r;
}

const calls = (fx) => (fs.existsSync(fx.calls) ? fs.readFileSync(fx.calls, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const daemonLog = (fx) => fs.readFileSync(path.join(fx.workspace, '.tmp', 'memory-daemon.log'), 'utf8');

test('interval synthesis flushes every active session, not only the newest transcript', () => {
  const fx = fixture();
  try {
    transcript(fx, 'aaaa1111', 120);
    transcript(fx, 'bbbb2222', 10);
    runDaemon(fx, `await daemon.runPhase2ThrottledWork(config, [
      { sessionId: 'aaaa1111', state: 'ACTIVE' }, { sessionId: 'bbbb2222', state: 'ACTIVE' }, { sessionId: 'cccc3333', state: 'IDLE' },
    ]);`);
    const log = daemonLog(fx);
    assert.match(log, /interval synthesis \[[a-z-]+\] aaaa1111:/, 'the older active session gets its own synthesis');
    assert.match(log, /interval synthesis \[[a-z-]+\] bbbb2222:/);
    assert.doesNotMatch(log, /cccc3333/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('a NATS extract request flushes each live session, idle ones included', () => {
  const fx = fixture();
  try {
    transcript(fx, 'aaaa1111', 120);
    transcript(fx, 'bbbb2222', 10);
    transcript(fx, 'dddd4444', 5);
    runDaemon(fx, `await daemon.runRequestedFlush([
      { sessionId: 'aaaa1111', state: 'IDLE' }, { sessionId: 'bbbb2222', state: 'ACTIVE' }, { sessionId: 'dddd4444', state: 'BOOT' },
    ], config);`);
    const log = daemonLog(fx);
    assert.match(log, /nats-triggered flush \[[a-z-]+\] aaaa1111:/);
    assert.match(log, /nats-triggered flush \[[a-z-]+\] bbbb2222:/);
    assert.doesNotMatch(log, /flush \[[a-z-]+\] dddd4444/, 'the newest file belongs to a session still booting');
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('the idle recap digests the session going idle, even when another one wrote later', () => {
  const fx = fixture();
  try {
    const a = transcript(fx, 'aaaa1111', 400);
    transcript(fx, 'bbbb2222', 10);
    runDaemon(fx, `await daemon.handleTransitions([{ from: 'ACTIVE', to: 'IDLE', sessionId: 'aaaa1111', jsonlPath: ${JSON.stringify(a)} }], config);`);
    const recaps = calls(fx).filter((c) => c.bin === 'session-recap');
    assert.deepEqual(recaps.map((c) => c.args), [['--file', a]]);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('the boot recap digests the last session that ended, not the second-newest file', () => {
  const fx = fixture();
  try {
    const ended = transcript(fx, 'aaaa1111', 3600);
    transcript(fx, 'bbbb2222', 30);
    const booting = transcript(fx, 'cccc3333', 5);
    runDaemon(fx, `await daemon.handleTransitions([{ from: 'ENDED', to: 'BOOT', sessionId: 'cccc3333', jsonlPath: ${JSON.stringify(booting)}, othersLive: true, previousJsonl: ${JSON.stringify(ended)} }], config);`);
    const recaps = calls(fx).filter((c) => c.bin === 'session-recap');
    assert.deepEqual(recaps.map((c) => c.args), [['--file', ended]]);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('session-recap --file digests exactly the named transcript', () => {
  const fx = fixture();
  try {
    const older = transcript(fx, 'aaaa1111', 600);
    transcript(fx, 'bbbb2222', 10);
    const home = path.join(fx.root, 'home');
    fs.mkdirSync(path.join(home, '.openclaw', 'config'), { recursive: true });
    fs.writeFileSync(path.join(home, '.openclaw', 'config', 'transcript-sources.json'), JSON.stringify({ sources: [{ path: fx.transcripts }] }));
    const run = (...args) => spawnSync(process.execPath, [path.join(repo, 'workspace-bin/session-recap'), ...args], {
      encoding: 'utf8', env: { ...process.env, HOME: home, OPENCLAW_WORKSPACE: fx.workspace },
    });
    const r = run('--file', older);
    assert.equal(r.status, 0, r.stderr);
    const recap = fs.readFileSync(path.join(fx.workspace, 'memory/last-session-recap.md'), 'utf8');
    assert.match(recap, /### Session aaaa1111/);
    assert.doesNotMatch(recap, /bbbb2222/);

    const missing = run('--file', path.join(fx.transcripts, 'gone.jsonl'));
    assert.equal(missing.status, 0, missing.stderr);
    assert.match(missing.stderr, /No JSONL transcripts found/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('no daemon job picks a transcript by mtime any more', () => {
  const src = fs.readFileSync(path.join(repo, 'workspace-bin/memory-daemon.mjs'), 'utf8');
  assert.doesNotMatch(src, /findCurrentJsonl|findPreviousJsonl/);
  assert.doesNotMatch(src, /'--previous'/);
  assert.match(src, /onExtract: async \(payload\) => \{[\s\S]*?await runRequestedFlush\(sm\.sessions, config\);/);
  assert.match(src, /await runPhase2ThrottledWork\(config, sm\.sessions\);/);
});
