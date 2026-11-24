import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_DIRS = ['bin', 'workspace-bin', 'lib', '.claude/hooks'];

function ownerAndConsumerScripts() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'STATE_FILES.md'), 'utf-8');
  const end = doc.indexOf('\n## Files removed');
  assert.ok(end >= 0, '"Files removed" section heading missing');
  const names = new Set();
  let inConsumers = false;
  for (const line of doc.slice(0, end).split('\n')) {
    if (line.startsWith('- **')) inConsumers = line.startsWith('- **Consumers:**');
    else if (!line.startsWith('  - ')) inConsumers = false;
    if (!line.startsWith('- **Owner:**') && !inConsumers) continue;
    for (const m of line.matchAll(/`([\w./-]+\.(?:mjs|js|sh))`/g)) names.add(m[1]);
  }
  return [...names];
}

function exists(name) {
  if (name.includes('/')) return fs.existsSync(path.join(ROOT, name));
  return SCRIPT_DIRS.some((dir) => fs.existsSync(path.join(ROOT, dir, name)));
}

test('every owner/consumer script named in docs/STATE_FILES.md exists', () => {
  const names = ownerAndConsumerScripts();
  assert.ok(names.length > 5, `parsed only ${names.length} script names`);
  assert.deepEqual(names.filter((name) => !exists(name)), []);
});

test('the .knowledge.db entry names the embedding model and dimension core.mjs uses', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'STATE_FILES.md'), 'utf-8');
  const start = doc.indexOf('\n### `.knowledge.db`');
  assert.ok(start >= 0, '.knowledge.db section missing');
  const entry = doc.slice(start, doc.indexOf('\n#', start + 5));
  const core = fs.readFileSync(path.join(ROOT, 'lib', 'mcp-knowledge', 'core.mjs'), 'utf-8');
  const model = core.match(/KNOWLEDGE_MODEL \|\| '([^']+)'/)[1];
  const dim = core.match(/EMBEDDING_DIM = (\d+)/)[1];
  assert.ok(entry.includes(model), `entry must name ${model}`);
  assert.ok(entry.includes(`${dim}-dim`), `entry must say ${dim}-dim`);
  assert.doesNotMatch(entry, /MiniLM|384-dim/);
});
