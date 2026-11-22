/**
 * getEmbedder memoizes the model LOAD, not the loaded model: concurrent first
 * callers (an inject request plus the MCP server's initial index pass) must
 * share one ~2 GB bge-m3 pipeline, and a failed load must not be memoized.
 * The transformers package is replaced by a counting stub through a module
 * resolve hook, so this runs without the model.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CORE_URL = new URL('../lib/mcp-knowledge/core.mjs', import.meta.url).href;
let dir;
let registerPath;

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'embedder-load-'));
  const stubUrl = pathToFileURL(join(dir, 'transformers-stub.mjs')).href;
  writeFileSync(join(dir, 'transformers-stub.mjs'), `
    export async function pipeline() {
      globalThis.__loads = (globalThis.__loads || 0) + 1;
      const n = globalThis.__loads;
      await new Promise((r) => setTimeout(r, 50));
      if (process.env.STUB_FAIL_FIRST && n === 1) throw new Error('offline');
      return async () => ({ data: new Float32Array(1024) });
    }
  `);
  writeFileSync(join(dir, 'hooks.mjs'), `
    export async function resolve(specifier, context, next) {
      if (specifier === '@huggingface/transformers') return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
      return next(specifier, context);
    }
  `);
  registerPath = join(dir, 'register.mjs');
  writeFileSync(registerPath, `
    import { register } from 'node:module';
    register(${JSON.stringify(pathToFileURL(join(dir, 'hooks.mjs')).href)});
  `);
});

after(() => rmSync(dir, { recursive: true, force: true }));

function run(script, env = {}) {
  const r = spawnSync(process.execPath, ['--import', registerPath, '--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

test('concurrent first callers share one model load', () => {
  const out = run(`
    const c = await import(${JSON.stringify(CORE_URL)});
    await Promise.all([c.getEmbedder(), c.getEmbedder(), c.embed('x')]);
    console.log(globalThis.__loads);
  `);
  assert.equal(out, '1');
});

test('a failed load is reported and retried on the next call', () => {
  const out = run(`
    const c = await import(${JSON.stringify(CORE_URL)});
    const first = await c.getEmbedder().then(() => 'loaded', (e) => e.message);
    await c.getEmbedder();
    console.log(JSON.stringify({ first, loads: globalThis.__loads }));
  `, { STUB_FAIL_FIRST: '1' });
  const { first, loads } = JSON.parse(out);
  assert.match(first, /Embedding model not cached/);
  assert.match(first, /Original error: offline/);
  assert.equal(loads, 2);
});
