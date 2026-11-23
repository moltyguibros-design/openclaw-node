/**
 * mesh-bridge-reconcile.test.mjs — the bridge re-runs reconcile on every NATS
 * reconnect while `dispatched` still holds the in-flight task. A task that
 * reached a terminal state during the gap sends no further event, so reconcile
 * itself must free its dispatch slot; serial dispatch waits on `dispatched.size === 0`.
 *
 * Run: node --test test/mesh-bridge-reconcile.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { tmpDir } = require('./helpers/tmp-dir.cjs');
const workspace = tmpDir('mesh-bridge-reconcile-');
process.env.OPENCLAW_WORKSPACE = workspace;
process.env.OPENCLAW_OBS_DB = ':memory:';

const { StringCodec } = require('nats');
const { readTasks, ACTIVE_TASKS_PATH } = require('../lib/kanban-io');
const bridge = require('../bin/mesh-bridge.js').__test;
const sc = StringCodec();

fs.mkdirSync(path.dirname(ACTIVE_TASKS_PATH), { recursive: true });

function seed(status) {
  fs.writeFileSync(ACTIVE_TASKS_PATH, [
    '# Fixture', '', '## Live Tasks', '',
    '- task_id: T-1', '  title: bridged task', `  status: ${status}`, '  execution: mesh', '  owner: n1', '',
  ].join('\n'));
  bridge.dispatched.clear();
  bridge.lastHeartbeat.clear();
  bridge.dispatched.add('T-1');
  bridge.lastHeartbeat.set('T-1', Date.now());
}

function daemonAnswers(response) {
  bridge.setNc({ request: async () => ({ data: sc.encode(JSON.stringify(response)) }) });
}

async function cardSettles(from) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (readTasks(ACTIVE_TASKS_PATH).find((t) => t.task_id === 'T-1')?.status !== from) return;
    await delay(10);
  }
  assert.fail(`card T-1 never left ${from}`);
}

const meshTask = (status) => ({ task_id: 'T-1', title: 'bridged task', status, owner: 'n1', result: { summary: 'done' }, attempts: [] });

for (const [status, cardAfter] of [['completed', 'waiting-user'], ['failed', 'blocked'], ['released', 'blocked'], ['cancelled', 'cancelled']]) {
  test(`a task found ${status} at reconcile frees its dispatch slot`, async () => {
    seed('running');
    daemonAnswers({ ok: true, data: meshTask(status) });
    await bridge.reconcile();
    await cardSettles('running');
    assert.equal(readTasks(ACTIVE_TASKS_PATH).find((t) => t.task_id === 'T-1').status, cardAfter);
    assert.equal(bridge.dispatched.has('T-1'), false);
    assert.equal(bridge.lastHeartbeat.has('T-1'), false);
  });
}

for (const cardStatus of ['submitted', 'running']) {
  test(`a ${cardStatus} card the daemon no longer knows frees its dispatch slot`, async () => {
    seed(cardStatus);
    daemonAnswers({ ok: false, error: 'Task T-1 not found' });
    await bridge.reconcile();
    if (cardStatus === 'submitted') await cardSettles('submitted');
    assert.equal(bridge.dispatched.has('T-1'), false);
    assert.equal(bridge.lastHeartbeat.has('T-1'), false);
  });
}

test('a task still running at reconcile keeps its slot', async () => {
  seed('running');
  daemonAnswers({ ok: true, data: meshTask('running') });
  await bridge.reconcile();
  assert.equal(bridge.dispatched.has('T-1'), true);
  assert.equal(bridge.lastHeartbeat.has('T-1'), true);
});
