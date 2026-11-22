/**
 * skills-dead-files.test.mjs — upstream build and fixture files with no consumer
 * stay out of the shipped skills.
 *
 * scripts/install/workspace.sh runs `npm install --production` in every skill that
 * has a package.json and no node_modules. A package.json with no dependencies never
 * gets a node_modules, so every install re-ran npm there for nothing.
 * crypto-price's ARCHITECTURE.md and README described wrapper skills and a font
 * that do not ship.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

describe('dead skill files', () => {
  it('upstream dev and fixture files are not shipped', () => {
    const present = [
      'fast-browser-use/package.json',
      'fast-browser-use/package-lock.json',
      'fast-browser-use/CODEBUDDY.md',
      'fast-browser-use/test_auth.json',
      'fast-browser-use/test_state.json',
      'clawddocs/package.json',
      'crypto-price/ARCHITECTURE.md',
    ].filter((rel) => existsSync(join(SKILLS, rel)));
    assert.deepEqual(present, []);
  });

  it('crypto-price README promises no unshipped font or wrapper skills', () => {
    const readme = readFileSync(join(SKILLS, 'crypto-price', 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /Tomorrow font/);
    assert.doesNotMatch(readme, /## Related Skills/);
  });

  it('every shipped skill package.json declares dependencies for the installer to fetch', () => {
    const empty = readdirSync(SKILLS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_quarantine' && e.name !== 'node_modules')
      .map((e) => join(e.name, 'package.json'))
      .filter((rel) => existsSync(join(SKILLS, rel)))
      .filter((rel) => Object.keys(JSON.parse(readFileSync(join(SKILLS, rel), 'utf8')).dependencies ?? {}).length === 0);
    assert.deepEqual(empty, []);
  });
});
