import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmbeddingLoader, modelsEnabled, modelCacheDir } from '../lib/model-policy.mjs';

test('persisted no-model profile refuses loading before any download or cache access', async t => {
  const home = mkdtempSync(join(tmpdir(), 'model-policy-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.openclaw'));
  writeFileSync(join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_MODEL_ENABLED=0\n');
  const env = { HOME: home };
  let calls = 0;
  const load = createEmbeddingLoader(async () => { calls++; }, env);
  assert.equal(modelsEnabled(env), false);
  await assert.rejects(load(), { code: 'OPENCLAW_MODELS_DISABLED' });
  assert.equal(calls, 0);
  assert.equal(modelCacheDir(env), join(home, '.cache', 'openclaw', 'models'));
});

test('unit-profile model opt-out is enforced at the actual loader boundary', async () => {
  let calls = 0;
  const load = createEmbeddingLoader(async () => { calls++; }, {
    OPENCLAW_MODEL_ENABLED: '1', OPENCLAW_NO_EMBED_MODEL: '1', HOME: '/owned',
  });
  await assert.rejects(load(), { code: 'OPENCLAW_MODELS_DISABLED' });
  assert.equal(calls, 0);
});

test('concurrent cold callers share one load and a failed load can be retried', async () => {
  let calls = 0;
  let release;
  const model = {};
  const load = createEmbeddingLoader(async options => {
    calls++;
    assert.equal(options.cache_dir, '/owned/model-cache');
    assert.equal(options.dtype, 'fp32');
    if (calls === 1) throw new Error('owned load failure');
    await new Promise(resolve => { release = resolve; });
    return model;
  }, { OPENCLAW_MODEL_ENABLED: '1', OPENCLAW_MODEL_CACHE: '/owned/model-cache' });
  await assert.rejects(load(), /owned load failure/);
  const first = load();
  const second = load();
  await Promise.resolve();
  assert.equal(calls, 2);
  release();
  assert.deepEqual(await Promise.all([first, second]), [model, model]);
  assert.equal(await load(), model);
  assert.equal(calls, 2);
});
