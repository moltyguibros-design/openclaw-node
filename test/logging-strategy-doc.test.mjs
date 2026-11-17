import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MC_SRC = path.join(ROOT, 'mission-control', 'src');

function inventoryMessages() {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'logging-strategy.md'), 'utf-8');
  const start = doc.indexOf('### Complete API Route Error Log Inventory');
  assert.ok(start >= 0, 'inventory section heading missing');
  const rest = doc.slice(start + 1);
  const end = rest.indexOf('\n### ');
  const section = end >= 0 ? rest.slice(0, end) : rest;
  const messages = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\| `[^`]+` \| `([^`]+)` \|$/);
    if (m) messages.push(m[1]);
  }
  return messages;
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(fs.readFileSync(p, 'utf-8'));
  }
  return out;
}

test('every API route log message in docs/logging-strategy.md exists in mission-control/src', () => {
  const messages = inventoryMessages();
  assert.ok(messages.length > 30, `parsed only ${messages.length} inventory rows`);
  const sources = sourceFiles(MC_SRC);
  const missing = messages.filter((msg) => !sources.some((src) => src.includes(msg)));
  assert.deepEqual(missing, []);
});
