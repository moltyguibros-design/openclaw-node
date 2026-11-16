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
});
