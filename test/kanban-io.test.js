#!/usr/bin/env node

/**
 * kanban-io.test.js — Unit tests for kanban-io parseTasks mesh routing fields.
 * Uses node:test (no external deps). Run: node test/kanban-io.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseTasks } = require('../lib/kanban-io');

function mkContent(taskBlock) {
  return `## Live Tasks\n${taskBlock}`;
}

describe('parseTasks — mesh routing fields', () => {
  it('parses llm_provider field', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t1\n  title: Test\n  status: queued\n  llm_provider: openai\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].llm_provider, 'openai');
  });

  it('parses provider as alias for llm_provider', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t2\n  title: Test\n  status: queued\n  provider: shell\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_provider, 'shell');
  });

  it('parses llm_model field', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t3\n  title: Test\n  status: queued\n  llm_model: gpt-4.1\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_model, 'gpt-4.1');
  });

  it('parses model as alias for llm_model', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t4\n  title: Test\n  status: queued\n  model: sonnet\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_model, 'sonnet');
  });

  it('parses preferred_nodes array', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t5\n  title: Test\n  status: queued\n  preferred_nodes:\n    - moltymac\n    - calos\n  updated_at: 2026-01-01'
    ));
    assert.deepEqual(tasks[0].preferred_nodes, ['moltymac', 'calos']);
  });

  it('parses exclude_nodes array', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t6\n  title: Test\n  status: queued\n  exclude_nodes:\n    - bad-node\n  updated_at: 2026-01-01'
    ));
    assert.deepEqual(tasks[0].exclude_nodes, ['bad-node']);
  });

  it('parses inline JSON collaboration spec', () => {
    const collab = JSON.stringify({ mode: 'parallel', min_nodes: 2, max_nodes: 3 });
    const tasks = parseTasks(mkContent(
      `- task_id: t7\n  title: Test\n  status: queued\n  collaboration: ${collab}\n  updated_at: 2026-01-01`
    ));
    assert.equal(tasks[0].collaboration.mode, 'parallel');
    assert.equal(tasks[0].collaboration.min_nodes, 2);
    assert.equal(tasks[0].collaboration.max_nodes, 3);
  });

  it('handles invalid JSON in collaboration gracefully', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t8\n  title: Test\n  status: queued\n  collaboration: {invalid json\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].collaboration, null);
  });

  it('defaults missing routing fields to null/empty', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t9\n  title: Test\n  status: queued\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].llm_provider, null);
    assert.equal(tasks[0].llm_model, null);
    assert.deepEqual(tasks[0].preferred_nodes, []);
    assert.deepEqual(tasks[0].exclude_nodes, []);
    assert.equal(tasks[0].collaboration, null);
  });

  it('parses all routing fields together on one task', () => {
    const collab = JSON.stringify({ mode: 'parallel', min_nodes: 2 });
    const tasks = parseTasks(mkContent(
      `- task_id: t10\n  title: Full routing\n  status: queued\n  llm_provider: shell\n  llm_model: custom\n  preferred_nodes:\n    - node-a\n    - node-b\n  exclude_nodes:\n    - node-c\n  collaboration: ${collab}\n  updated_at: 2026-01-01`
    ));
    assert.equal(tasks[0].llm_provider, 'shell');
    assert.equal(tasks[0].llm_model, 'custom');
    assert.deepEqual(tasks[0].preferred_nodes, ['node-a', 'node-b']);
    assert.deepEqual(tasks[0].exclude_nodes, ['node-c']);
    assert.equal(tasks[0].collaboration.mode, 'parallel');
  });

  it('parses collab_result JSON field', () => {
    const result = JSON.stringify({ rounds_taken: 3, summary: 'done', artifacts: ['a.txt'] });
    const tasks = parseTasks(mkContent(
      `- task_id: t11\n  title: Test\n  status: done\n  collab_result: ${result}\n  updated_at: 2026-01-01`
    ));
    assert.equal(tasks[0].collab_result.rounds_taken, 3);
    assert.equal(tasks[0].collab_result.summary, 'done');
    assert.deepEqual(tasks[0].collab_result.artifacts, ['a.txt']);
  });

  it('handles invalid JSON in collab_result gracefully', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t12\n  title: Test\n  status: done\n  collab_result: {broken\n  updated_at: 2026-01-01'
    ));
    assert.equal(tasks[0].collab_result, null);
  });

  it('circling_* display lines end an array and are not returned', () => {
    const tasks = parseTasks(mkContent(
      '- task_id: t13\n  title: Test\n  status: running\n  scope:\n    - a.js\n    - b.js\n' +
      '  circling_phase: circling\n    - stray\n  circling_nodes: ["a"]\n  budget_minutes: 45\n  updated_at: 2026-01-01'
    ));
    assert.deepEqual(tasks[0].scope, ['a.js', 'b.js']);
    assert.equal(tasks[0].budget_minutes, 45);
    assert.deepEqual(Object.keys(tasks[0]).filter(k => k.startsWith('circling_')), []);
  });
});

describe('updateTaskInPlace — object serialization', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { updateTaskInPlace } = require('../lib/kanban-io');

  it('serializes object field values as JSON, not [object Object]', async () => {
    const tmpFile = path.join(os.tmpdir(), `kanban-test-${process.pid}.md`);
    const content = `## Live Tasks\n- task_id: ser1\n  title: Serialize test\n  status: running\n  updated_at: 2026-01-01\n`;
    fs.writeFileSync(tmpFile, content);
    try {
      await updateTaskInPlace(tmpFile, 'ser1', {
        collab_result: { rounds_taken: 2, summary: 'ok' },
      });
      const updated = fs.readFileSync(tmpFile, 'utf8');
      assert.ok(!updated.includes('[object Object]'), 'must not contain [object Object]');
      assert.ok(updated.includes('"rounds_taken":2'), 'must contain JSON-serialized object');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  it('keeps multi-line values on one line so the task block stays parseable', async () => {
    const tmpFile = path.join(os.tmpdir(), `kanban-test-nl-${process.pid}.md`);
    fs.writeFileSync(tmpFile, `## Live Tasks\n- task_id: nl1\n  title: Newline test\n  status: running\n  updated_at: 2026-01-01\n`);
    try {
      await updateTaskInPlace(tmpFile, 'nl1', {
        next_action: 'Collab completed:\n- first finding\n- status: done',
        description: 'line one\nline two',
      });
      await updateTaskInPlace(tmpFile, 'nl1', { next_action: 'second update' });
      const [task] = parseTasks(fs.readFileSync(tmpFile, 'utf8'));
      assert.equal(task.status, 'running', 'a "status:" inside the summary must not become a field');
      assert.equal(task.next_action, 'second update');
      assert.equal(task.description, 'line one\nline two');
      assert.ok(!fs.readFileSync(tmpFile, 'utf8').includes('first finding'), 'no orphaned continuation lines');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  });
});

describe('appendTaskBlock', () => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { appendTaskBlock } = require('../lib/kanban-io');
  const block = (id) => `- task_id: ${id}\n  title: B\n  status: queued\n  next_action: Plan subtask (local)\n  description: x\\ny\n  updated_at: t`;

  it('appends under the lock, once per task id, and never while the lock is held', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-append-'));
    const tmpFile = path.join(dir, 'active-tasks.md');
    fs.writeFileSync(tmpFile, '## Live Tasks\n- task_id: a1\n  title: A\n  status: queued\n');
    try {
      assert.equal(await appendTaskBlock(tmpFile, 'b1', block('b1')), true);
      const tasks = parseTasks(fs.readFileSync(tmpFile, 'utf8'));
      assert.deepEqual(tasks.map(t => t.task_id), ['a1', 'b1']);
      assert.equal(tasks[1].next_action, 'Plan subtask (local)');
      assert.equal(tasks[1].description, 'x\ny');

      const before = fs.readFileSync(tmpFile, 'utf8');
      assert.equal(await appendTaskBlock(tmpFile, 'b1', block('b1')), false);
      assert.equal(fs.readFileSync(tmpFile, 'utf8'), before);

      fs.mkdirSync(tmpFile + '.lk');
      await assert.rejects(appendTaskBlock(tmpFile, 'c1', block('c1')), /lock acquisition timeout/);
      assert.equal(fs.readFileSync(tmpFile, 'utf8'), before);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
