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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills');

describe('dead skill files', () => {
  it('upstream dev and fixture files are not shipped', () => {
    const present = [
      'clawddocs/package.json',
      'crypto-price/ARCHITECTURE.md',
    ].filter((rel) => existsSync(join(SKILLS, rel)));
    assert.deepEqual(present, []);
  });

  it('no shipped skill carries Rust source, which no install path compiles', () => {
    const rust = [];
    const walk = (rel) => {
      for (const name of readdirSync(join(SKILLS, rel))) {
        const child = join(rel, name);
        if (statSync(join(SKILLS, child)).isDirectory()) walk(child);
        else if (name === 'Cargo.toml' || name.endsWith('.rs')) rust.push(child);
      }
    };
    for (const e of readdirSync(SKILLS, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== '_quarantine' && e.name !== 'node_modules') walk(e.name);
    }
    assert.deepEqual(rust, []);
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
