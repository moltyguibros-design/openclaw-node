import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('bin/llm-benchmark runBenchmark', () => {
  it('imports without running the CLI and parses fenced output like production does', async () => {
    const { runBenchmark, generateSyntheticSession } = await import('../bin/llm-benchmark.mjs');
    const client = {
      generate: async () => ({
        content: '```json\n{"entities":[],"themes":[],"decisions":[]}\n```',
        usage: null,
        finishReason: 'stop',
      }),
    };
    const result = await runBenchmark(client, generateSyntheticSession(3));
    assert.equal(result.json_valid, true);
    assert.equal(result.has_entities, true);
    assert.equal(generateSyntheticSession(3).length, 3);
  });

  it('sends production\'s extraction prompt and parses a primed continuation like production', async () => {
    const { runBenchmark, generateSyntheticSession } = await import('../bin/llm-benchmark.mjs');
    let sent = null;
    const client = {
      generate: async (messages) => {
        sent = messages;
        return { content: '"entities":[],"themes":[],"decisions":[]}', usage: null, finishReason: 'stop' };
      },
    };
    const result = await runBenchmark(client, generateSyntheticSession(3));
    assert.equal(result.parse_error, null);
    assert.equal(result.json_valid, true);
    assert.equal(result.finish_reason, 'stop');
    assert.match(sent[0].content, /\/no_think$/);
    assert.equal(sent.at(-1).role, 'assistant');
  });
});
