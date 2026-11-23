#!/usr/bin/env node
/**
 * mesh-agent-dry-run.test.mjs — --dry-run previews a task's prompt through the
 * read-only mesh.tasks.get / mesh.tasks.list calls and touches nothing: no
 * claim, no start, no worktree, no agent state.
 *
 * Run: node --test test/mesh-agent-dry-run.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-dry-run-'));
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  MESH_WORKTREE_BASE: path.join(TMP, 'worktrees'),
  OPENCLAW_NODE_ID: 'node-dry',
  OPENCLAW_OBS_DB: ':memory:',
  MESH_MEMORY_RECALL: 'off',
});

const require = createRequire(import.meta.url);
const { StringCodec } = require('nats');
const agent = require('../bin/mesh-agent.js');
const sc = StringCodec();
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function fakeBus(tasks) {
  const calls = [];
  agent.__test.setContext({
    nc: {
      async request(subject, data) {
        const payload = JSON.parse(sc.decode(data));
        calls.push({ subject, payload });
        let reply = null;
        if (subject === 'mesh.tasks.list') reply = tasks.filter((t) => t.status === payload.status);
        else if (subject === 'mesh.tasks.get') reply = tasks.find((t) => t.task_id === payload.task_id) ?? null;
        return { data: sc.encode(JSON.stringify({ ok: true, data: reply })) };
      },
      subscribe() { throw new Error('a dry run subscribes to nothing'); },
    },
  });
  return calls;
}

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.join(' ')); };
  return fn().finally(() => { console.log = orig; }).then(() => lines.join('\n'));
}

const solo = { task_id: 'T-dry-1', title: 'Fix the parser', description: 'Make it strict.', status: 'queued', scope: ['src/p.js'] };
const collab = { task_id: 'T-dry-2', title: 'Design review', description: 'Review it.', status: 'queued', collaboration: { mode: 'parallel' }, scope: ['docs/'] };

describe('--dry-run', () => {
  it('previews the first queued task without claiming, starting or creating a worktree', async () => {
    const calls = fakeBus([{ ...solo, status: 'running', task_id: 'T-busy' }, solo]);
    const out = await captureLog(() => agent.__test.dryRun(null));
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.tasks.list']);
    assert.equal(calls[0].payload.status, 'queued');
    assert.match(out, /\[DRY RUN\] Prompt for T-dry-1/);
    assert.match(out, /# Task: Fix the parser/);
    assert.equal(fs.existsSync(path.join(TMP, 'worktrees')), false);
    assert.equal(fs.existsSync(path.join(TMP, '.openclaw', 'agent-state.json')), false);
  });

  it('previews a named task by id, and a collab task with its round-1 prompt', async () => {
    const calls = fakeBus([solo, collab]);
    const out = await captureLog(() => agent.__test.dryRun('T-dry-2'));
    assert.deepEqual(calls.map((c) => c.subject), ['mesh.tasks.get']);
    assert.match(out, /# Task: Design review \(Collaborative Round 1\)/);
    for (const c of calls) assert.ok(!/claim|start|join|fail|release/.test(c.subject), c.subject);
  });

  it('says so when nothing is queued', async () => {
    fakeBus([]);
    const out = await captureLog(() => agent.__test.dryRun(null));
    assert.match(out, /No queued task to preview/);
  });

  it('the task paths carry no dry-run branch that could run after a claim', () => {
    const src = fs.readFileSync(new URL('../bin/mesh-agent.js', import.meta.url), 'utf8');
    const body = (name) => src.slice(src.indexOf(`async function ${name}(`), src.indexOf('\n}\n', src.indexOf(`async function ${name}(`)));
    for (const name of ['runAttempts', 'executeCollabTask', 'executeTask']) assert.doesNotMatch(body(name), /DRY_RUN/, name);
    assert.match(src, /--dry-run\s+# read one task and print its prompt; claims nothing/);
  });
});
