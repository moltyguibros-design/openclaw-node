/**
 * skill-links.test.mjs — relative markdown links in skills/<dir>/SKILL.md
 * resolve against that skill's directory. lean-ux-canvas and pol-probe linked
 * siblings as `skills/<x>/SKILL.md`, which pointed inside their own dir.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

describe('skill markdown links', () => {
  it('every relative link in a SKILL.md points at an existing file', () => {
    const broken = [];
    for (const dir of readdirSync(SKILLS, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === '_quarantine') continue;
      const file = join(SKILLS, dir.name, 'SKILL.md');
      if (!existsSync(file)) continue;
      let fenced = false;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*```/.test(line)) { fenced = !fenced; return; }
        if (fenced) return;
        for (const [, target] of line.matchAll(/\]\(([^)\s]+)\)/g)) {
          if (/^(https?:|mailto:|#)/.test(target)) continue;
          const path = target.split('#')[0];
          if (!existsSync(join(SKILLS, dir.name, path))) broken.push(`${dir.name}/SKILL.md:${i + 1} -> ${target}`);
        }
      });
    }
    assert.deepEqual(broken, []);
  });
});
