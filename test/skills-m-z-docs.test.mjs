// m-z skill docs: commands an agent copies must run where the skill is installed, and the
// frontmatter name is the directory id (per-skill config and skill-audit key on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../skills/', import.meta.url));
const read = (rel) => readFileSync(`${SKILLS}${rel}`, 'utf8');
const frontName = (rel) => read(rel).match(/^---\n([\s\S]*?)\n---/)?.[1].match(/^name:\s*(\S+)\s*$/m)?.[1];

test('renamed skills declare their directory id as their name', () => {
  assert.equal(frontName('tavily-search/SKILL.md'), 'tavily-search');
  assert.equal(frontName('moltbook-interact/SKILL.md'), 'moltbook-interact');
  assert.equal(frontName('_quarantine/refactor-suggest/SKILL.md'), 'refactor-suggest');
});

test('user-story example quotes its arguments as bash will read them', () => {
  const doc = read('user-story/SKILL.md');
  assert.doesNotMatch(doc, /\\"/);
  assert.match(doc, /python3 \{baseDir\}\/scripts\/user-story-template\.py --persona "trial user"/);
});

test('soulcraft README links its research report relative to the skill', () => {
  assert.match(read('soulcraft/README.md'), /\]\(research\/RESEARCH_REPORT\.md\)/);
});
