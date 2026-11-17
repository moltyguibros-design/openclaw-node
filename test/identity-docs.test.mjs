import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// install.sh and mesh-deploy copy identity/*.md into every node's workspace,
// Linux workers included, so these docs must hold for any node.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const docs = fs.readdirSync(path.join(ROOT, 'identity')).filter(f => f.endsWith('.md'))
  .map(f => [f, fs.readFileSync(path.join(ROOT, 'identity', f), 'utf8')]);

test('shipped identity docs carry no operator-specific home paths', () => {
  for (const [f, text] of docs) assert.doesNotMatch(text, /\/Users\/[^/\s`]+\//, f);
});

test('every skills/<name>/SKILL.md an identity doc points at ships', () => {
  for (const [f, text] of docs) {
    for (const [, name] of text.matchAll(/skills\/([\w-]+)\/SKILL\.md/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'skills', name, 'SKILL.md')), `${f} -> skills/${name}/SKILL.md`);
    }
  }
});

test('numbered lists in identity docs count up without gaps', () => {
  for (const [f, text] of docs) {
    let prev = 0, fenced = false;
    text.split('\n').forEach((line, i) => {
      if (/^```/.test(line)) fenced = !fenced;
      if (fenced) return;
      if (/^#/.test(line)) { prev = 0; return; }
      const n = Number(line.match(/^(\d+)\. /)?.[1]);
      if (!n) return;
      assert.ok(n === 1 || n === prev + 1, `${f}:${i + 1} item ${n} follows ${prev}`);
      prev = n;
    });
  }
});
