import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-audit-ledger-'));
fs.mkdirSync(path.join(root, '.learnings'));
fs.mkdirSync(path.join(root, 'bin'));
const calls = path.join(root, 'registry-calls.log');
fs.writeFileSync(path.join(root, 'bin', 'trust-registry'),
  `import sys\nopen(${JSON.stringify(calls)}, 'a').write(' '.join(sys.argv[1:3]) + '\\n')\n`);
process.env.OPENCLAW_WORKSPACE = root;
const { auditAndProcess } = await import('../workspace-bin/subagent-audit.mjs');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const delegation = (id, soul, resultText, isError = false) => [
  { message: { content: [{ type: 'tool_use', name: 'Task', id, input: { subagent_type: soul, description: `task ${id}` } }] } },
  { message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: resultText }] } },
].map(l => JSON.stringify(l)).join('\n') + '\n';

const registryCalls = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []);
const lessons = () => fs.readFileSync(path.join(root, '.learnings', 'lessons.md'), 'utf8').trim().split('\n');

test('auditing the same session at session end and again at boot counts each delegation once', async () => {
  const jsonl = path.join(root, 'sess-a.jsonl');
  fs.writeFileSync(jsonl, delegation('t1', 'scout', 'Error: could not reach host', true) + delegation('t2', 'scout', 'completed'));

  await auditAndProcess(jsonl);
  await auditAndProcess(jsonl);
  await auditAndProcess(jsonl);

  assert.deepEqual(registryCalls(), ['update scout', 'update scout']);
  assert.equal(lessons().length, 1);
});

test('a resumed session counts only the delegations added since the last audit', async () => {
  const jsonl = path.join(root, 'sess-a.jsonl');
  fs.appendFileSync(jsonl, delegation('t3', 'builder', 'done'));
  const { fresh } = await auditAndProcess(jsonl);
  assert.deepEqual(fresh.map(r => r.toolUseId), ['t3']);
  assert.equal(registryCalls().length, 3);
});

test('the same failure lesson from another session is not appended twice', async () => {
  const jsonl = path.join(root, 'sess-b.jsonl');
  fs.writeFileSync(jsonl, delegation('u1', 'scout', 'Error: could not reach host', true));
  await auditAndProcess(jsonl);
  assert.equal(registryCalls().length, 4, 'a distinct delegation still updates the trust registry');
  assert.equal(lessons().length, 1);
});
