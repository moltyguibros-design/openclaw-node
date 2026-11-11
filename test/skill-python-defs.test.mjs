/**
 * skill-python-defs.test.mjs — no skill Python script defines the same
 * top-level function or class twice.
 *
 * crypto-price's get_price_chart.py carried two copies of _post_json and of
 * its Hyperliquid helpers and three of _hyperliquid_lookup; Python keeps the
 * last definition, so edits to the earlier copies silently did nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

const DUPLICATE_DEFS = `
import ast, sys
for path in sys.argv[1:]:
    seen = {}
    for node in ast.parse(open(path, encoding="utf-8").read(), path).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            seen[node.name] = seen.get(node.name, 0) + 1
    dups = sorted(name for name, n in seen.items() if n > 1)
    if dups:
        print(path + ": " + ", ".join(dups))
`;

const SKIP_DIRS = new Set(['_quarantine', 'node_modules', '__pycache__']);
const skillPythonFiles = () =>
  readdirSync(SKILLS, { recursive: true })
    .filter(rel => rel.endsWith('.py') && !rel.split(sep).some(part => SKIP_DIRS.has(part)))
    .map(rel => join(SKILLS, rel));

describe('skill Python scripts', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('define each top-level function or class once', () => {
    const files = skillPythonFiles();
    assert.ok(files.length > 0);
    const r = spawnSync('python3', ['-I', '-c', DUPLICATE_DEFS, ...files], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });

  it('crypto-price get_price_chart.py still loads and reports a missing symbol', () => {
    const r = spawnSync('python3', ['-B', join(SKILLS, 'crypto-price', 'scripts', 'get_price_chart.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).error, 'missing symbol');
  });
});
