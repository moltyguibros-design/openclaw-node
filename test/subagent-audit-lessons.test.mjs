import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
