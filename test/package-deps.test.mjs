import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

// onnxruntime-node's postinstall downloads CUDA EP binaries from a GitHub release on
// Linux x64; when that asset 404s, npm ci and the installer's npm install fail outright.
describe('onnxruntime CUDA download', () => {
  const hasNpm = spawnSync('npm', ['--version'], { encoding: 'utf8' }).status === 0;
  it('npm reads the project .npmrc that skips it', { skip: !hasNpm && 'npm not on PATH' }, () => {
    const r = spawnSync('npm', ['config', 'get', 'onnxruntime-node-install-cuda'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.stdout.trim(), 'skip', r.stderr);
  });

  it('nothing in the code asks ONNX Runtime for the CUDA execution provider', () => {
    const r = spawnSync('git', ['grep', '-l', '-i', '-E', "cuda(ExecutionProvider)?['\"]|device: *['\"]cuda", '--', 'lib', 'bin', 'workspace-bin', 'packages'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.stdout.trim(), '');
  });
});

// With root "workspaces", npm pack reads no .gitignore/.npmignore below the root, so a
// publish from a dev checkout shipped mission-control/node_modules (~830 MB), .env.local,
// data/ and .next. The negations in "files" are what keep them out.
describe('published tarball', () => {
  const hasNpm = spawnSync('npm', ['--version'], { encoding: 'utf8' }).status === 0;
  it('ships the workspace dist but no node_modules, env files, build output or local data',
    { skip: !hasNpm && 'npm not on PATH' }, (t) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-files-'));
      t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
      const put = (rel, text = 'x\n') => {
        fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
        fs.writeFileSync(path.join(tmp, rel), text);
      };
      const { name, version, files, workspaces } = pkg;
      put('package.json', JSON.stringify({ name, version, files, workspaces }));
      put('.gitignore', fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'));
      put('mission-control/.gitignore', fs.readFileSync(path.join(ROOT, 'mission-control/.gitignore'), 'utf8'));
      put('packages/event-schemas/.npmignore', fs.readFileSync(path.join(ROOT, 'packages/event-schemas/.npmignore'), 'utf8'));
      put('packages/event-schemas/package.json', JSON.stringify({ name: 'event-schemas', version: '1.0.0' }));
      put('packages/event-schemas/dist/index.js');
      put('packages/event-schemas/src/index.ts');
      put('packages/openclaw-memory-context-engine/package.json', JSON.stringify({ name: 'context-engine', version: '1.0.0' }));
      put('packages/openclaw-memory-context-engine/index.js');
      put('lib/mcp-knowledge/package.json', JSON.stringify({ name: 'mcp-knowledge', version: '1.0.0' }));
      put('lib/mcp-knowledge/core.mjs');
      put('mission-control/package.json', JSON.stringify({ name: 'mission-control', version: '1.0.0', private: true }));
      put('mission-control/page.ts');
      for (const decoy of [
        'mission-control/node_modules/decoy/x.js',
        'mission-control/.env.local',
        'mission-control/data/a.db',
        'mission-control/.next/x.js',
        'mission-control/tsconfig.tsbuildinfo',
        'packages/event-schemas/node_modules/decoy/x.js',
        'workspace-bin/__pycache__/x.cpython-312.pyc',
      ]) put(decoy);

      const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
        cwd: tmp, encoding: 'utf8', env: { ...process.env, npm_config_cache: path.join(tmp, '.npm-cache') },
      });
      assert.equal(r.status, 0, r.stderr);
      const packed = JSON.parse(r.stdout)[0].files.map((f) => f.path);
      assert.ok(packed.includes('packages/event-schemas/dist/index.js'), packed.join('\n'));
      assert.ok(packed.includes('mission-control/page.ts'), packed.join('\n'));
      const leaked = packed.filter((f) =>
        /(^|\/)node_modules\/|(^|\/)\.env|\.tsbuildinfo$|^mission-control\/(data|\.next)\/|__pycache__|\.pyc$/.test(f));
      assert.deepEqual(leaked, []);
    });

  it('lists each workspace path once: "packages/" already ships event-schemas', () => {
    assert.ok(pkg.files.includes('packages/'));
    assert.deepEqual(pkg.files.filter((f) => f.startsWith('packages/') && f !== 'packages/'), []);
  });
});
