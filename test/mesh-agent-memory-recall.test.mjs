// The task-relevant memory recall must not block the agent's event loop: it used a
// synchronous curl, which froze alive checks, heartbeats and NATS for as long as
// the loopback inject-server took to answer. Here the inject-server lives in the
// same process, so it can only answer while the agent's event loop is free.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const home = mkdtempSync(join(tmpdir(), 'mesh-recall-'));
mkdirSync(join(home, '.openclaw', 'config'), { recursive: true });
writeFileSync(join(home, '.openclaw', 'config', 'memory-injection-token'), 'tok-1\n');

const seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    seen.push({ auth: req.headers.authorization, body: JSON.parse(body) });
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ block: '[memory: recalled QX-31]' }));
    }, 300);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

Object.assign(process.env, {
  HOME: home,
  MESH_WORKSPACE: join(home, 'workspace'),
  MEMORY_INJECT_PORT: String(server.address().port),
  OPENCLAW_NODE_ID: 'node-recall',
  OPENCLAW_OBS_DB: ':memory:',
});
delete process.env.MESH_MEMORY_RECALL;

const require = createRequire(import.meta.url);
const m = require('../bin/mesh-agent.js');

after(() => {
  server.close();
  rmSync(home, { recursive: true, force: true });
});

test('recallForTask answers from an in-process inject-server, and timers run while it waits', async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 20);
  try {
    const block = await m.recallForTask({ title: 'Fix the limiter', description: 'reset path' });
    assert.equal(block, '[memory: recalled QX-31]');
    assert.ok(ticks >= 5, `the event loop kept running during the recall (ticks=${ticks})`);
  } finally {
    clearInterval(timer);
  }
  assert.equal(seen.at(-1).auth, 'Bearer tok-1');
  assert.equal(seen.at(-1).body.prompt, 'Fix the limiter\nreset path');
});

test('prepareMemoryRecall feeds the recalled block to the synchronous prompt builders', async () => {
  const task = { title: 'Fix the limiter', description: 'reset path', scope: [], role: null, collaboration: { mode: 'parallel' } };
  await m.prepareMemoryRecall(task);
  assert.match(m.buildInitialPrompt(task), /Node memory \(task-relevant recall\)[\s\S]*QX-31/);
  assert.match(m.buildCollabPrompt(task, 1, '', [], 'worker'), /QX-31/);
});

test('a retry prompt keeps the success criteria and the scope restriction', () => {
  const task = { task_id: 'R-1', title: 't', success_criteria: ['CRIT-ONE'], scope: ['src/a.js'], role: null, collaboration: { mode: 'parallel' } };
  const retry = m.buildRetryPrompt(task, [{ approach: 'a', result: 'b' }], 2);
  assert.match(retry, /## Success Criteria\n- CRIT-ONE/);
  assert.match(retry, /## Scope\nOnly modify these files\/paths:\n- src\/a\.js/);
  const once = (prompt) => prompt.split('CRIT-ONE').length - 1;
  assert.equal(once(m.buildInitialPrompt(task)), 1);
  assert.equal(once(m.buildCollabPrompt(task, 1, '', [], 'worker')), 1);
});
