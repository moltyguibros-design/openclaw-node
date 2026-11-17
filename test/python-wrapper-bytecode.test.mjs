// tests#14: these wrappers' python3 runs import modules from workspace-bin/ and
// memory-plan/, so without PYTHONDONTWRITEBYTECODE every `npm test` wrote
// __pycache__ into the repo tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const WRAPPERS = ['service-gate', 'timer-hold-install', 'journal-hold', 'restore-only'];

for (const name of WRAPPERS) {
  test(`${name}.test.mjs runs python3 without writing bytecode`, () => {
    const src = fs.readFileSync(fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url)), 'utf8');
    const calls = src.split(/(?=(?:spawnSync|execFileSync)\('python3')/).slice(1);
    assert.ok(calls.length > 0, 'no python3 spawn found');
    for (const call of calls) {
      const opts = call.slice(0, call.indexOf('});'));
      assert.match(opts, /env: \{ \.\.\.process\.env, PYTHONDONTWRITEBYTECODE: '1' \}/, opts);
    }
  });
}
