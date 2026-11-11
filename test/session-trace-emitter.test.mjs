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
