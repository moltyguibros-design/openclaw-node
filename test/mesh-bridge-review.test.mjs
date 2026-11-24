/**
 * mesh-bridge-review.test.mjs — a metric-less board task finishes into the
 * daemon's pending_review. The card must say it waits on the operator's mesh
 * review (not 'running'), the serial dispatch slot stays held until that
 * decision, and the approval ('completed', reviewed_by human) closes the card
 * instead of asking for a second board review. A bridge restart while the
 * review is pending must pick the card up again.
 *
 * Run: node --test test/mesh-bridge-review.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { tmpDir } = require('./helpers/tmp-dir.cjs');
const workspace = tmpDir('mesh-bridge-review-');
process.env.OPENCLAW_WORKSPACE = workspace;
process.env.OPENCLAW_OBS_DB = ':memory:';

const { StringCodec } = require('nats');
const { readTasks, ACTIVE_TASKS_PATH } = require('../lib/kanban-io');
const bridge = require('../bin/mesh-bridge.js').__test;
const sc = StringCodec();

fs.mkdirSync(path.dirname(ACTIVE_TASKS_PATH), { recursive: true });

function seed(status, nextAction) {
  fs.writeFileSync(ACTIVE_TASKS_PATH, [
    '# Fixture', '', '## Live Tasks', '',
    '- task_id: T-1', '  title: bridged task', `  status: ${status}`, '  execution: mesh', '  owner: mesh',
    ...(nextAction ? [`  next_action: ${nextAction}`] : []), '',
  ].join('\n'));
  bridge.dispatched.clear();
  bridge.lastHeartbeat.clear();
}

const card = () => readTasks(ACTIVE_TASKS_PATH).find((t) => t.task_id === 'T-1');

async function cardReaches(status) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (card()?.status === status) return card();
    await delay(10);
  }
  assert.fail(`card T-1 never reached ${status} (is ${card()?.status})`);
}

const meshTask = (status, extra = {}) => ({
  task_id: 'T-1', title: 'bridged task', status, owner: 'n1', attempts: [{}],
  started_at: '2026-11-23T10:00:00Z', result: { success: true, summary: 'done' }, ...extra,
});

test('pending_review moves the card to waiting-user with the review commands and keeps the slot', async () => {
  seed('submitted');
  bridge.dispatched.add('T-1');
  bridge.handleEvent('claimed', 'T-1', meshTask('claimed'));
  await cardReaches('running');

  bridge.handleEvent('pending_review', 'T-1', meshTask('pending_review'));
  const waiting = await cardReaches('waiting-user');
  assert.match(waiting.next_action, /^mesh review: mesh tasks approve T-1 \| mesh tasks reject T-1 --reason/);
  assert.equal(bridge.dispatched.has('T-1'), true, 'serial dispatch slot stays held until the review decision');
  assert.equal(bridge.lastHeartbeat.has('T-1'), false, 'no silent-agent warning while a human decides');

  bridge.handleEvent('completed', 'T-1', meshTask('completed', { completed_at: '2026-11-23T10:05:00Z', reviewed_by: 'human' }));
  const closed = await cardReaches('done');
  assert.equal(closed.next_action, 'approved in mesh review');
  assert.equal(bridge.dispatched.has('T-1'), false);
});

test('a completion without a human review still asks for the board review', async () => {
  seed('running');
  bridge.dispatched.add('T-1');
  bridge.handleEvent('completed', 'T-1', meshTask('completed', { completed_at: '2026-11-23T10:05:00Z' }));
  const review = await cardReaches('waiting-user');
  assert.match(review.next_action, /^Gui review — mesh completed/);
  assert.equal(bridge.dispatched.has('T-1'), false);
});

test('a bridge restart re-tracks a card waiting on mesh review', async () => {
  seed('waiting-user', 'mesh review: mesh tasks approve T-1 | mesh tasks reject T-1 --reason ...');
  bridge.setNc({ request: async () => ({ data: sc.encode(JSON.stringify({ ok: true, data: meshTask('pending_review') })) }) });
  await bridge.reconcile();
  assert.equal(bridge.dispatched.has('T-1'), true);
  assert.equal(bridge.lastHeartbeat.has('T-1'), false);
});

test('an approval that landed while the bridge was down closes the card at reconcile', async () => {
  seed('waiting-user', 'mesh review: mesh tasks approve T-1 | mesh tasks reject T-1 --reason ...');
  bridge.setNc({ request: async () => ({ data: sc.encode(JSON.stringify({ ok: true, data: meshTask('completed', { reviewed_by: 'human' }) })) }) });
  await bridge.reconcile();
  await cardReaches('done');
  assert.equal(bridge.dispatched.has('T-1'), false);
});

test('a running card whose task already awaits review is corrected at reconcile', async () => {
  seed('running');
  bridge.setNc({ request: async () => ({ data: sc.encode(JSON.stringify({ ok: true, data: meshTask('pending_review') })) }) });
  await bridge.reconcile();
  const waiting = await cardReaches('waiting-user');
  assert.match(waiting.next_action, /^mesh review: /);
  assert.equal(bridge.dispatched.has('T-1'), true);
  assert.equal(bridge.lastHeartbeat.has('T-1'), false);
});

test('a rejection re-queues the card instead of leaving the approve commands up', async () => {
  seed('waiting-user', 'mesh review: mesh tasks approve T-1 | mesh tasks reject T-1 --reason ...');
  bridge.dispatched.add('T-1');
  bridge.handleEvent('rejected', 'T-1', meshTask('queued', { rejection_reason: 'tests missing' }));
  const requeued = await cardReaches('submitted');
  assert.equal(requeued.next_action, 'Rejected in mesh review, re-queued: tests missing');
  assert.equal(bridge.dispatched.has('T-1'), true);
});
