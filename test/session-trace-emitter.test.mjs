import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSessionTraceEmitter } from '../workspace-bin/session-trace-emitter.mjs';

const userLine = (content) => JSON.stringify({ type: 'user', message: { content } }) + '\n';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-trace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});
  const jsonl = path.join(dir, 'session.jsonl');
  const calls = [];
  const emitter = createSessionTraceEmitter({ emit: (fn) => calls.push(fn) });
  fs.writeFileSync(jsonl, userLine('a'));
  emitter.processNewEntries(jsonl);
  assert.equal(calls.length, 1);
  return { jsonl, calls, emitter };
}

test('a burst of more than 64KB since the last tick is emitted in full, not just its tail', (t) => {
  const { jsonl, calls, emitter } = setup(t);
  fs.appendFileSync(jsonl, Array.from({ length: 200 }, () => userLine('x'.repeat(600))).join(''));
  emitter.processNewEntries(jsonl);
  assert.equal(calls.length, 201);
  assert.ok(calls.every((fn) => fn === 'message.user'));
});

test('a line still being written is not consumed until its newline lands', (t) => {
  const { jsonl, calls, emitter } = setup(t);
  fs.appendFileSync(jsonl, '{"type":"user","message":{"content":"tail');
  emitter.processNewEntries(jsonl);
  assert.equal(calls.length, 1);

  fs.appendFileSync(jsonl, '"}}\n');
  emitter.processNewEntries(jsonl);
  assert.equal(calls.length, 2, 'the completed line is emitted exactly once');
});

function capture(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-trace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.method(console, 'log', () => {});
  const jsonl = path.join(dir, 'session.jsonl');
  const events = [];
  const emitter = createSessionTraceEmitter({ emit: (fn, data) => events.push({ fn, ...data }) });
  fs.writeFileSync(jsonl, lines.map((l) => JSON.stringify(l) + '\n').join(''));
  emitter.processNewEntries(jsonl);
  return events;
}

test('gateway turns are emitted by role, with their tool calls and results', (t) => {
  const events = capture(t, [
    { type: 'session', id: 's1' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'list the files' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'sure' }, { type: 'toolCall', name: 'exec', arguments: { command: 'ls' } }] } },
    { type: 'message', message: { role: 'toolResult', toolName: 'exec', toolCallId: 'c1', content: [{ type: 'text', text: 'a b' }] } },
  ]);
  assert.deepEqual(events.map((e) => [e.fn, e.args_summary]), [
    ['message.user', 'list the files'],
    ['message.assistant', 'sure'],
    ['tool.call', 'tool=exec'],
    ['tool.result', 'tool=exec'],
  ]);
});

test('gateway toolCall ids are not kept: their results name the tool themselves', (t) => {
  const events = capture(t, [
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c1', name: 'exec' }] } },
    { type: 'message', message: { role: 'toolResult', toolName: 'exec', toolCallId: 'c1' } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1' }] } },
  ]);
  assert.deepEqual(events.map((e) => [e.fn, e.args_summary]), [
    ['tool.call', 'tool=exec'],
    ['tool.result', 'tool=exec'],
    ['tool.result', 'tool=unknown'],
  ]);
});

test('Claude Code tool_use blocks, model and usage are emitted, usage once per turn', (t) => {
  const usage = { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 };
  const turn = (content) => ({ type: 'assistant', message: { id: 'm1', model: 'model-x', role: 'assistant', content, usage } });
  const events = capture(t, [
    turn([{ type: 'text', text: 'reading it' }]),
    turn([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/x' } }]),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'data' }] } },
  ]);
  assert.deepEqual(events.map((e) => [e.fn, e.args_summary, e.result_summary]), [
    ['message.assistant', 'reading it', 'model-x'],
    ['tool.call', 'tool=Read', 'model-x'],
    ['tool.result', 'tool=Read', ''],
  ]);
  assert.deepEqual(JSON.parse(events[0].meta), { input_tokens: 10, output_tokens: 4, cache_read: 2 });
  assert.equal(events[1].meta, null, 'the repeated usage of the same turn is not counted twice');
});

test('message excerpts are scrubbed of secrets before they are cut', (t) => {
  const key = 'AKIA' + 'B'.repeat(16);
  const events = capture(t, [{ type: 'message', message: { role: 'user', content: `${'x'.repeat(90)} ${key}` } }]);
  assert.equal(events.length, 1);
  assert.doesNotMatch(events[0].args_summary, /AKIA/);
});
