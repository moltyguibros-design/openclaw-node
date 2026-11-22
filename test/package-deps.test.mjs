import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    // lib/mcp-knowledge is a workspace with its own package.json.
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'mcp-knowledge' ? [] : sources(full);
    return /\.(mjs|js)$/.test(e.name) ? [full] : [];
  });
}

const packageName = (spec) => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

describe('root package.json dependencies', () => {
  it('declares every package that shipped lib/ code imports statically', () => {
    const builtins = new Set(builtinModules);
    const missing = [];
    for (const file of sources(path.join(ROOT, 'lib'))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1];
        if (spec.startsWith('.') || spec.startsWith('node:')) continue;
        const name = packageName(spec);
        if (builtins.has(name) || pkg.dependencies?.[name]) continue;
        missing.push(`${path.relative(ROOT, file)}: ${name}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it('matches the lockfile root entry, as npm ci requires', () => {
    assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  });
});

describe('event-schemas workspace dependencies', () => {
  const dir = path.join(ROOT, 'packages', 'event-schemas');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const tsSources = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsSources(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);

  it('declares only packages its src imports', () => {
    const imported = new Set();
    for (const file of tsSources(path.join(dir, 'src'))) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (!m[1].startsWith('.')) imported.add(packageName(m[1]));
      }
    }
    assert.deepEqual(Object.keys(manifest.dependencies).filter((name) => !imported.has(name)), []);
  });

  it('matches its lockfile workspace entry, as npm ci requires', () => {
    assert.deepEqual(lock.packages['packages/event-schemas'].dependencies, manifest.dependencies);
  });
});
