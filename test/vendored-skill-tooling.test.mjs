// Vendored ClawHub skills shipped their authors' release tooling: scripts that
// need files and packages absent here (public.manifest.json, evolution logs,
// `glob`), one of which pushes history to a foreign document. Nothing called
// them; they were copied to every node as dead weight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVOLVER = join(ROOT, 'skills/_quarantine/capability-evolver');

test('upstream maintainer and publishing scripts are not vendored', () => {
  assert.equal(existsSync(join(EVOLVER, 'scripts')), false);
  assert.equal(existsSync(join(ROOT, 'skills/cc-godmode/scripts/build-skill.js')), false);
  assert.ok(existsSync(join(EVOLVER, 'index.js')), 'the skill itself stays');
});

test('the capability-evolver READMEs point at nothing that is missing', () => {
  for (const f of ['README.md', 'README.zh-CN.md']) {
    const text = readFileSync(join(EVOLVER, f), 'utf8');
    assert.doesNotMatch(text, /assets\/cover\.png/, f);
    assert.doesNotMatch(text, /publish:public/, f);
  }
});
