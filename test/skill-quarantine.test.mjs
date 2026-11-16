/**
 * skill-quarantine.test.mjs — a quarantined skill (skills/_quarantine/README.md)
 * is neither in the live skills tree nor granted to any soul.
 *
 * Adversarial-review H-11: capability-evolver (an unattended self-edit loop fed
 * raw transcripts, with a shell exec of INTEGRATION_STATUS_CMD) stayed live and
 * enabled for the daedalus orchestrator soul after the 2026-09-06 remediation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUARANTINE = join(ROOT, 'skills', '_quarantine');
const quarantined = readdirSync(QUARANTINE, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

function soulSkillGrants() {
  const grants = [];
  const souls = join(ROOT, 'souls');
  for (const dir of readdirSync(souls, { withFileTypes: true })) {
    const caps = join(souls, dir.name, 'capabilities.json');
    if (dir.isDirectory() && existsSync(caps)) {
      for (const skill of JSON.parse(readFileSync(caps, 'utf8')).skills || []) grants.push([`souls/${dir.name}`, skill]);
    }
  }
  for (const soul of JSON.parse(readFileSync(join(souls, 'registry.json'), 'utf8')).souls) {
    for (const skill of soul.capabilities?.skills || []) grants.push([`registry ${soul.id}`, skill]);
  }
  return grants;
}

describe('skill quarantine', () => {
  it('capability-evolver is quarantined, with its reason recorded', () => {
    assert.ok(quarantined.includes('capability-evolver'));
    assert.match(readFileSync(join(QUARANTINE, 'README.md'), 'utf8'), /`capability-evolver` \|.*H-11/);
  });

  it('no quarantined skill is also in the live skills tree', () => {
    assert.deepEqual(quarantined.filter(name => existsSync(join(ROOT, 'skills', name))), []);
  });

  it('no soul is granted a quarantined skill', () => {
    assert.deepEqual(soulSkillGrants().filter(([, skill]) => quarantined.includes(skill)), []);
  });
});
