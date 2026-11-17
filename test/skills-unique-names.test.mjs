// Every shipped skill dir is deployed to every node, and name-keyed consumers
// (skill-routing-eval's stats, name-keyed loaders) keep only one entry per
// frontmatter name. Two dirs answering to one name made routing ambiguous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));

test('shipped skills have unique frontmatter names', () => {
  const owners = new Map();
  for (const dir of readdirSync(SKILLS, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === '_quarantine') continue;
    const file = join(SKILLS, dir.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const front = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const name = front?.[1].match(/^name:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1];
    if (!name) continue;
    owners.set(name, [...(owners.get(name) || []), dir.name]);
  }
  assert.ok(owners.size > 10, 'frontmatter parse');
  const dupes = [...owners].filter(([, dirs]) => dirs.length > 1);
  assert.deepEqual(dupes, []);
});

// web-search and tavily-search both fired on "search the web for" and two
// more phrases; Tavily now answers only when asked for by name.
test('tavily-search shares no trigger phrase with web-search', () => {
  const triggers = (dir) => {
    const front = readFileSync(join(SKILLS, dir, 'SKILL.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/)[1];
    const block = front.match(/^triggers:\n((?:[ \t]+-.*\n?)+)/m)[1];
    return [...block.matchAll(/^\s+-\s*["']?(.+?)["']?\s*$/gm)].map((m) => m[1].toLowerCase());
  };
  const tavily = triggers('tavily-search');
  assert.ok(tavily.length > 0 && tavily.every((t) => t.includes('tavily')), tavily.join(', '));
  assert.deepEqual(tavily.filter((t) => triggers('web-search').includes(t)), []);
});
