import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pageSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..',
    'mission-control', 'src', 'app', 'obsidian', 'page.tsx'),
  'utf-8'
);

test('Obsidian "Index Workspace" calls the memory indexer and only reloads on success', () => {
  const match = pageSrc.match(/const handleIndexWorkspace = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(match, 'page.tsx must define handleIndexWorkspace');
  const body = match[1];
  assert.ok(body.includes('fetch("/api/memory/sync"'), 'must POST to the indexer /api/memory/sync');
  assert.ok(!body.includes('/api/memory/flush'), 'must not call the session-flush endpoint');
  assert.ok(body.includes('res.ok'), 'must check the response before reloading');
});
