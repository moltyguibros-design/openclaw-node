/**
 * skills-removed.test.mjs — skills deleted for cause stay deleted.
 *
 * markdown-formatter (a third-party ClawHub skill) deleted table cells under
 * its default github style, rewrote every '#' in a document under
 * headingStyle 'atx', and crashed on fixLists and heading-level lint. An agent
 * asked to "format markdown" could quietly wreck a file. The operator chose
 * deletion over quarantine; agents use a real formatter (prettier/markdownlint).
 *
 * clawdbot-filesystem shipped without the `filesystem` CLI that every command in
 * its SKILL.md runs, so a file request that selected it failed with "command not
 * found". The agent's built-in file tools cover the same ground.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

describe('removed skills', () => {
  for (const name of ['markdown-formatter', 'clawdbot-filesystem']) {
    it(`${name} is not shipped`, () => {
      assert.equal(existsSync(join(SKILLS, name)), false);
      assert.equal(existsSync(join(SKILLS, '_quarantine', name)), false);
    });
  }
});
