/**
 * soul-skills.test.mjs — a soul may only list skills that ship from skills/.
 * deep-research was listed for two souls while it wired the agent to a
 * third-party MCP server over a public plaintext tunnel. Quarantined skills
 * are covered by skill-quarantine.test.mjs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');

function soulSkillLists() {
  const lists = [];
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'souls', 'registry.json'), 'utf8'));
  for (const soul of registry.souls) lists.push([`registry.json:${soul.id}`, soul.capabilities?.skills || []]);
  for (const dir of fs.readdirSync(path.join(ROOT, 'souls'), { withFileTypes: true })) {
    const file = path.join(ROOT, 'souls', dir.name, 'capabilities.json');
    if (dir.isDirectory() && fs.existsSync(file)) {
      lists.push([`${dir.name}/capabilities.json`, JSON.parse(fs.readFileSync(file, 'utf8')).skills || []]);
    }
  }
  return lists;
}

describe('soul skill lists', () => {
  it('every listed skill ships from skills/', () => {
    for (const [where, skills] of soulSkillLists()) {
      for (const s of skills) {
        assert.ok(fs.existsSync(path.join(SKILLS, s, 'SKILL.md')), `${where} lists ${s}, which does not ship`);
      }
    }
  });

  it('deep-research (third-party MCP over a public plaintext tunnel) is gone; souls use gemini-deep-research', () => {
    assert.ok(!fs.existsSync(path.join(SKILLS, 'deep-research')));
    for (const [where, skills] of soulSkillLists()) {
      assert.ok(!skills.includes('deep-research'), `${where} still lists deep-research`);
    }
    const lists = Object.fromEntries(soulSkillLists());
    assert.ok(lists['daedalus/capabilities.json'].includes('gemini-deep-research'));
    assert.ok(lists['identity-architect/capabilities.json'].includes('gemini-deep-research'));
  });

  // Placeholders souls still list (lore-writer, blockchain-auditor); this list may
  // only shrink. A skill a soul advertises must not be a new empty stub.
  const KNOWN_STUBS = new Set(['narrative-designer', 'world-builder', 'solidity-audit', 'slither-analyzer', 'mythril-scanner']);
  const isStub = (name) => /Status: stub/.test(fs.readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8'));

  it('no soul lists an unimplemented stub skill beyond the tracked placeholders', () => {
    for (const [where, skills] of soulSkillLists()) {
      for (const s of skills) {
        if (fs.existsSync(path.join(SKILLS, s, 'SKILL.md')) && isStub(s)) {
          assert.ok(KNOWN_STUBS.has(s), `${where} lists ${s}, which is an empty stub`);
        }
      }
    }
    for (const s of KNOWN_STUBS) assert.ok(isStub(s), `${s} is implemented now; drop it from KNOWN_STUBS`);
  });

  it('flavor-text-writer is a real skill with routing triggers', () => {
    const text = fs.readFileSync(path.join(SKILLS, 'flavor-text-writer', 'SKILL.md'), 'utf8');
    const fm = text.split('---')[1];
    assert.match(fm, /^name: flavor-text-writer$/m);
    assert.match(fm, /^description: .*Use when/m);
    assert.ok((fm.match(/^triggers:\n((?:  - .+\n)+)/m)?.[1].split('\n').filter(Boolean).length ?? 0) >= 3);
    assert.ok((fm.match(/^negative_triggers:\n((?:  - .+\n)+)/m)?.[1].split('\n').filter(Boolean).length ?? 0) >= 2);
    assert.match(text, /^## Output format$/m);
  });
});
