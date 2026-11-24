import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useJsonFormat, createLlmClient, DEFAULT_MODEL } from '../lib/llm-client.mjs';
import { buildExtractionPrompt, parseWithPrimer, extractStructured } from '../lib/extraction-prompt.mjs';

// Locks the format:"json" decision that killed extraction for 45h
// (audits/extraction_stall): thinking-family models must never get the JSON
// grammar; everything else keeps it unless the operator forces free-form.

test('thinking families never get format:json', () => {
  for (const m of ['qwen3:8b', 'qwen3:14b', 'Qwen3:8B', 'deepseek-r1:7b', 'magistral:latest', 'gpt-oss:20b']) {
    assert.equal(useJsonFormat(m, {}), false, m);
  }
});

test('non-thinking models keep format:json', () => {
  for (const m of ['llama3.1:8b', 'mistral:7b', 'gemma3:4b', 'phi4:latest']) {
    assert.equal(useJsonFormat(m, {}), true, m);
  }
});

test('LLM_FORCE_FREE_FORM=1 disables format:json for every model', () => {
  const env = { LLM_FORCE_FREE_FORM: '1' };
  assert.equal(useJsonFormat('llama3.1:8b', env), false);
  assert.equal(useJsonFormat('qwen3:8b', env), false);
});

test('family match is prefix-anchored, not substring', () => {
  assert.equal(useJsonFormat('my-qwen3-finetune', {}), true);
});

const QWEN3_PRIMER = '<think>\n\n</think>\n\n{';

test('jsonPrimer appends a trailing assistant turn; default does not', () => {
  const msgs = [{ role: 'user', content: 'hello' }];
  for (const model of [undefined, 'qwen3:8b', 'llama3.1:8b']) {
    const plain = buildExtractionPrompt(msgs, { model });
    assert.notEqual(plain[plain.length - 1].role, 'assistant', String(model));
  }
  const primed = buildExtractionPrompt(msgs, { jsonPrimer: true, model: 'llama3.1:8b' });
  assert.deepEqual(primed[primed.length - 1], { role: 'assistant', content: '{' });
});

test('only classic qwen3 / qwen3:<tag> gets the closed think block before the primer brace', () => {
  const msgs = [{ role: 'user', content: 'hello' }];
  const primerFor = (model) => buildExtractionPrompt(msgs, { jsonPrimer: true, model }).at(-1).content;
  for (const m of ['qwen3', 'qwen3:8b', 'qwen3:14b', 'Qwen3:8B', 'QWEN3:latest', 'qwen3:30b-a3b']) {
    assert.equal(primerFor(m), QWEN3_PRIMER, m);
  }
  for (const m of ['qwen3.5:9b', 'qwen3-coder:30b', 'qwen3-next:80b', 'qwen3vl:8b', 'library/qwen3:8b',
    'hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M', 'my-qwen3:8b', 'qwen2.5:7b', 'deepseek-r1:7b', 'gpt-oss:20b']) {
    assert.equal(primerFor(m), '{', m);
  }
});

test('with no model the primer follows the default model', () => {
  const primed = buildExtractionPrompt([], { jsonPrimer: true });
  assert.equal(primed.at(-1).content, /^qwen3(?::|$)/i.test(DEFAULT_MODEL) ? QWEN3_PRIMER : '{');
});

test('parseWithPrimer restores the consumed brace only when primed', () => {
  const continuation = '"entities": [], "themes": [], "decisions": []}';
  assert.deepEqual(parseWithPrimer(continuation, true), { entities: [], themes: [], decisions: [] });
  assert.throws(() => parseWithPrimer(continuation, false));
  const echoed = '{"entities": []}';
  assert.deepEqual(parseWithPrimer(echoed, true), { entities: [] });
});

const NESTED_CONTINUATION = '"entities": [{"name": "NATS", "type": "technology", "salience": 0.9}, '
  + '{"name": "OpenClaw Gateway", "type": "project", "salience": 0.7}], "themes": [], "decisions": []}';

test('parseWithPrimer restores the brace before parsing a continuation with nested objects', () => {
  assert.equal(parseWithPrimer(NESTED_CONTINUATION, true).entities.length, 2);
  const fresh = '<think></think>\n{"entities": [{"name": "X", "type": "concept", "salience": 0.5}]}';
  assert.equal(parseWithPrimer(fresh, true).entities.length, 1);
  const fenced = '```json\n{"entities": [{"name": "X", "type": "concept", "salience": 0.5}]}\n```';
  assert.equal(parseWithPrimer(fenced, true).entities.length, 1);
});

test('a primed continuation must be one whole object: trailing text, a second root or truncation refuse', () => {
  const ENTITY = '{"name": "NATS", "type": "technology", "salience": 0.9}';
  for (const reply of [
    NESTED_CONTINUATION + '\n\nDone.',
    NESTED_CONTINUATION + '\n</think>\n\n{"entities": [' + ENTITY + '], "themes": []}',
    NESTED_CONTINUATION + '{"entities": []}',
    '"entities": [' + ENTITY + ', ' + ENTITY + '], "themes": [',
    '"entities": [' + ENTITY + ']',
  ]) {
    assert.throws(() => parseWithPrimer(reply, true), SyntaxError, reply);
  }
});

test('parseWithPrimer keeps backtick content and unwraps only a whole-reply fence', () => {
  const label = 'run `npm ci` then ```make build```';
  const cont = `"themes": [{"label": ${JSON.stringify(label)}}], "entities": []}`;
  assert.equal(parseWithPrimer(cont, true).themes[0].label, label);
  assert.equal(parseWithPrimer('```json\n' + cont + '\n```', true).themes[0].label, label);
  const fresh = `{"themes": [{"label": ${JSON.stringify(label)}}]}`;
  assert.equal(parseWithPrimer('```\n' + fresh + '\n```', false).themes[0].label, label);
  assert.deepEqual(parseWithPrimer('[{"a": 1}]', true), [{ a: 1 }]);
});

// The real client, with fetch stubbed: what extractStructured actually sends.
async function captureExtractionRequest(model, reply) {
  const realFetch = globalThis.fetch;
  const prevNative = process.env.LLM_NATIVE_API;
  delete process.env.LLM_NATIVE_API;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ message: { content: reply }, done_reason: 'stop' }), { status: 200 });
  };
  try {
    const real = createLlmClient({ baseUrl: 'http://llm.test', model });
    const client = { model: real.model, generate: (m, o) => real.generate(m, { ...o, bypassQueue: true }) };
    const result = await extractStructured(client, [{ role: 'user', content: 'set up NATS' }]);
    return { request, result };
  } finally {
    globalThis.fetch = realFetch;
    if (prevNative === undefined) delete process.env.LLM_NATIVE_API; else process.env.LLM_NATIVE_API = prevNative;
  }
}

test('extractStructured sends the client model\'s primer on the native endpoint with think:false and no format', async () => {
  const { request, result } = await captureExtractionRequest('qwen3:8b', NESTED_CONTINUATION);
  assert.equal(request.url, 'http://llm.test/api/chat');
  assert.equal(request.body.model, 'qwen3:8b');
  assert.equal(request.body.think, false);
  assert.equal('format' in request.body, false);
  assert.deepEqual(request.body.messages.at(-1), { role: 'assistant', content: QWEN3_PRIMER });
  assert.deepEqual(result.entities.map((e) => e.name), ['NATS', 'OpenClaw Gateway']);
});

test('extractStructured wiring: qwen3.5 gets the bare primer, a non-thinking model none and format:json', async () => {
  const q35 = await captureExtractionRequest('qwen3.5:9b', NESTED_CONTINUATION);
  assert.equal(q35.request.body.think, false);
  assert.equal('format' in q35.request.body, false);
  assert.deepEqual(q35.request.body.messages.at(-1), { role: 'assistant', content: '{' });
  const llama = await captureExtractionRequest('llama3.1:8b', '{' + NESTED_CONTINUATION);
  assert.equal(llama.request.body.format, 'json');
  assert.notEqual(llama.request.body.messages.at(-1).role, 'assistant');
  assert.equal(llama.result.entities.length, 2);
});

test('extractStructured refuses a qwen3 reply that restores a root then opens a second one', async () => {
  await assert.rejects(
    () => captureExtractionRequest('qwen3:8b', NESTED_CONTINUATION + '\n</think>\n{"entities": []}'),
    /LLM response is not valid JSON/,
  );
});
