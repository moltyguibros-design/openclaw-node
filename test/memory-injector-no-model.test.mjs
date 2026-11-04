import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryInjector, formatDegradedWarning } from '../lib/memory-injector.mjs';

test('no-model retrieval reports text matching and never calls embedding or LLM analysis', async () => {
  const prior = process.env.OPENCLAW_MODEL_ENABLED;
  process.env.OPENCLAW_MODEL_ENABLED = '0';
  let calls = 0;
  try {
    const injector = createMemoryInjector({ llmClient: { generateAnalysis: async () => { calls++; } } });
    const result = await injector.retrieve('owned query about lib/model-policy.mjs', { embedFn: async () => { calls++; } });
    assert.equal(calls, 0);
    assert.equal(result.analysis.mode, 'lexical-only');
    assert.equal(result.analysis.fallbackReason, 'models_disabled');
    assert.equal(result.analysis.llm, null);
    assert.match(formatDegradedWarning(result.analysis), /semantic search are unavailable/);
    assert.doesNotMatch(formatDegradedWarning(result.analysis), /embedding-only/);
  } finally {
    if (prior === undefined) delete process.env.OPENCLAW_MODEL_ENABLED;
    else process.env.OPENCLAW_MODEL_ENABLED = prior;
  }
});
