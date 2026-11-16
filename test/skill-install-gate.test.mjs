import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

function markdown(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '_quarantine' || e.name === 'node_modules' ? [] : markdown(full);
    return e.name.endsWith('.md') ? [full] : [];
  });
}

// Skill installs and updates go only through openclaw-skill-scanner/install-hook.sh
// (operator decision, audit finding skills-a-l#8).
describe('skill install gate', () => {
  it('no loaded skill tells the agent to install or bulk-update skills around the scanner', () => {
    const bypass = /npx skills (add|update)\b|clawd?hub update --all|npm update -g clawdbot/;
    const hits = markdown(SKILLS).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
      .map((line, i) => (bypass.test(line) ? `${path.relative(SKILLS, file)}:${i + 1}: ${line.trim()}` : null))
      .filter(Boolean));
    assert.deepEqual(hits, []);
  });

  it('auto-updater is quarantined', () => {
    assert.ok(!fs.existsSync(path.join(SKILLS, 'auto-updater')));
    assert.ok(fs.existsSync(path.join(SKILLS, '_quarantine', 'auto-updater', 'SKILL.md')));
    assert.match(fs.readFileSync(path.join(SKILLS, '_quarantine', 'README.md'), 'utf8'), /\| `auto-updater` \|/);
  });

  it('find-skills routes any install through the scanner gate without --force or -y', () => {
    const text = fs.readFileSync(path.join(SKILLS, 'find-skills', 'SKILL.md'), 'utf8');
    assert.match(text, /bash skills\/openclaw-skill-scanner\/install-hook\.sh <clawhub-slug>/);
    assert.doesNotMatch(text, /\s-y\b|--yes/);
    assert.match(text, /Never pass `--force`/);
  });
});
