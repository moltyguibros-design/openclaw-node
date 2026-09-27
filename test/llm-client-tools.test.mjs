/**
 * llm-client-tools.test.mjs — integrations plan step 6.1.
 *
 * Tool calling on the local LLM client. Two backends answer differently:
 * Ollama's native /api/chat returns `arguments` as an object, the
 * OpenAI-compatible /v1/chat/completions returns it as a JSON string. Callers
 * (lib/node-agent.mjs, the God's Eye View driver) must not have to know which
 * one replied, so the client normalizes both and reports malformed argument
 * JSON instead of swallowing it.
 *
 * The server here is a real HTTP server, so the request body asserted below is
 * the one that actually went over the wire. Model reliability — whether qwen3
 * picks the right tool — is a separate question and needs a real model.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLlmClient, normalizeToolCalls } from '../lib/llm-client.mjs';

const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_fleet_state',
    description: 'Current node health across the mesh',
    parameters: { type: 'object', properties: { scope: { type: 'string' } }, required: [] },
  },
}];

let server;
let baseUrl;
let lastRequest;
let reply;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      lastRequest = { url: req.url, body: JSON.parse(body || '{}') };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

const native = (env) => { process.env.LLM_NATIVE_API = env; };

describe('normalizeToolCalls', () => {
  it('accepts object arguments (Ollama native)', () => {
    const [call] = normalizeToolCalls([{ function: { name: 'f', arguments: { a: 1 } } }]);
    assert.deepEqual(call.arguments, { a: 1 });
    assert.equal(call.argumentsRaw, null);
    assert.equal(call.parseError, null);
  });

  it('parses string arguments and keeps the raw text (OpenAI shape)', () => {
    const [call] = normalizeToolCalls([{ id: 'call_1', function: { name: 'f', arguments: '{"a":1}' } }]);
    assert.deepEqual(call.arguments, { a: 1 });
    assert.equal(call.argumentsRaw, '{"a":1}');
    assert.equal(call.id, 'call_1');
  });

  it('reports malformed argument JSON rather than pretending the call was empty', () => {
    const [call] = normalizeToolCalls([{ function: { name: 'f', arguments: '{oops' } }]);
    assert.deepEqual(call.arguments, {});
    assert.ok(call.parseError, 'a small model emitting broken JSON must be visible to the caller');
    assert.equal(call.argumentsRaw, '{oops');
  });

  it('is empty for a response with no tool calls', () => {
    assert.deepEqual(normalizeToolCalls(undefined), []);
    assert.deepEqual(normalizeToolCalls(null), []);
    assert.deepEqual(normalizeToolCalls([]), []);
  });
});

describe('generate() over the Ollama native endpoint', () => {
  it('sends the tools and returns the call, with arguments as an object', async () => {
    native('true');
    reply = {
      message: { content: '', tool_calls: [{ function: { name: 'get_fleet_state', arguments: { scope: 'all' } } }] },
      prompt_eval_count: 12, eval_count: 5, done_reason: 'stop',
    };
    const client = createLlmClient({ baseUrl, model: 'qwen3:8b' });
    const out = await client.generate([{ role: 'user', content: 'which nodes are down' }], { tools: TOOLS, bypassQueue: true });

    assert.equal(lastRequest.url, '/api/chat');
    assert.deepEqual(lastRequest.body.tools, TOOLS, 'the schema must reach the server unchanged');
    assert.equal(lastRequest.body.think, false);
    assert.equal(out.toolCalls.length, 1);
    assert.equal(out.toolCalls[0].name, 'get_fleet_state');
    assert.deepEqual(out.toolCalls[0].arguments, { scope: 'all' });
    assert.equal(out.usage.total_tokens, 17);
  });

  it('suppresses format:json when tools are present', async () => {
    native('true');
    reply = { message: { content: '{}' } };
    const client = createLlmClient({ baseUrl, model: 'llama3.1' }); // not a thinking family
    await client.generate([{ role: 'user', content: 'x' }], { tools: TOOLS, jsonMode: true, bypassQueue: true });
    assert.equal(lastRequest.body.format, undefined,
      'format:json and tools constrain decoding differently; sending both yields neither');

    await client.generate([{ role: 'user', content: 'x' }], { jsonMode: true, bypassQueue: true });
    assert.equal(lastRequest.body.format, 'json', 'jsonMode still works when no tools are passed');
  });

  it('returns an empty toolCalls array when the model just answers', async () => {
    native('true');
    reply = { message: { content: 'four nodes are up' } };
    const client = createLlmClient({ baseUrl, model: 'qwen3:8b' });
    const out = await client.generate([{ role: 'user', content: 'status' }], { tools: TOOLS, bypassQueue: true });
    assert.deepEqual(out.toolCalls, []);
    assert.equal(out.content, 'four nodes are up');
  });
});

describe('generate() over an OpenAI-compatible endpoint', () => {
  it('sends tools plus tool_choice and parses string arguments', async () => {
    native('false');
    reply = {
      choices: [{ message: { content: null, tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get_fleet_state', arguments: '{"scope":"down"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { total_tokens: 40 },
    };
    const client = createLlmClient({ baseUrl, model: 'gpt-oss' });
    const out = await client.generate([{ role: 'user', content: 'which nodes are down' }], {
      tools: TOOLS, toolChoice: 'auto', bypassQueue: true,
    });

    assert.equal(lastRequest.url, '/v1/chat/completions');
    assert.deepEqual(lastRequest.body.tools, TOOLS);
    assert.equal(lastRequest.body.tool_choice, 'auto');
    assert.equal(lastRequest.body.response_format, undefined);
    assert.equal(out.finishReason, 'tool_calls');
    assert.equal(out.toolCalls[0].id, 'call_9');
    assert.deepEqual(out.toolCalls[0].arguments, { scope: 'down' });
  });

  it('omits tool fields entirely when no tools are passed', async () => {
    native('false');
    reply = { choices: [{ message: { content: 'hi' } }] };
    const client = createLlmClient({ baseUrl, model: 'gpt-oss' });
    const out = await client.generate([{ role: 'user', content: 'hi' }], { bypassQueue: true });
    assert.equal(lastRequest.body.tools, undefined, 'callers that never ask for tools see an unchanged request');
    assert.equal(lastRequest.body.tool_choice, undefined);
    assert.deepEqual(out.toolCalls, []);
  });
});
