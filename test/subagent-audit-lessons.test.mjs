import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../workspace-bin/subagent-audit.mjs', import.meta.url));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-audit-lessons-'));
fs.mkdirSync(path.join(root, '.learnings'));
process.env.OPENCLAW_WORKSPACE = root;
const { processResults } = await import('../workspace-bin/subagent-audit.mjs');
const { parseLessons } = await import('../workspace-bin/obsidian-sync.mjs');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('an auto-extracted failure lesson is written in the MEMORY_SPEC form and keeps its date through obsidian-sync', async () => {
  await processResults([{ result: 'failure', soulId: 's', errorPattern: 'boom', turnsConsumed: 1, taskDescription: 't' }]);
  const written = fs.readFileSync(path.join(root, '.learnings', 'lessons.md'), 'utf8').trim();
  assert.match(written, /^\[error\] .+ \(\d{4}-\d{2}-\d{2}\)$/);
  const [lesson] = parseLessons(written, 'n');
  assert.equal(lesson.date, new Date().toISOString().split('T')[0]);
});

test('the CLI the daemon runs reports only; trust-registry and lessons are written only with --apply', () => {
  const ws = fs.mkdtempSync(path.join(root, 'cli-'));
  fs.mkdirSync(path.join(ws, '.learnings'));
  fs.mkdirSync(path.join(ws, 'bin'));
  const calls = path.join(ws, 'trust-calls');
  fs.writeFileSync(path.join(ws, 'bin', 'trust-registry'),
    `import sys\nopen(${JSON.stringify(calls)}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n`);
  const jsonl = path.join(ws, 'session.jsonl');
  fs.writeFileSync(jsonl, [
    { message: { content: [{ type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'tester', description: 'run suite' } }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'All 42 tests pass, 0 failed. Unblocked the step.' }] } },
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  const lessons = path.join(ws, '.learnings', 'lessons.md');
  const run = (...args) => spawnSync(process.execPath, [script, ...args, jsonl],
    { encoding: 'utf8', env: { ...process.env, OPENCLAW_WORKSPACE: ws } });

  const report = run();
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /Report only: would update 1 trust registry entries/);
  assert.equal(fs.existsSync(calls), false, 'the default run wrote the trust registry');
  assert.equal(fs.existsSync(lessons), false, 'the default run wrote a lesson');

  assert.equal(run('--apply').status, 0);
  assert.match(fs.readFileSync(calls, 'utf8'), /^update tester --result failure /);
  assert.match(fs.readFileSync(lessons, 'utf8'), /^\[error\] Sub-agent tester failed:/);
});

test('parseLessons dates the bare form, the current auto-extracted form, and lines written in the old comma form', () => {
  const lessons = parseLessons([
    '[error] Sub-agent s failed: boom (auto-extracted, 2026-11-11)',
    '[error] x (auto-extracted) (2026-11-10)',
    '[pattern] y (2026-01-02)',
  ].join('\n'), 'n');
  assert.deepEqual(lessons.map(l => [l.tag, l.text, l.date]), [
    ['error', 'Sub-agent s failed: boom', '2026-11-11'],
    ['error', 'x (auto-extracted)', '2026-11-10'],
    ['pattern', 'y', '2026-01-02'],
  ]);
});
