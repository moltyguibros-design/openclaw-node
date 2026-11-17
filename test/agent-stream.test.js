const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { streamAnswer, PROVIDERS } = require('../lib/agent-stream');

const jsonl = (...records) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

describe('streamAnswer — claude stream-json', () => {
  const init = { type: 'system', subtype: 'init', session_id: 's', model: 'm', tools: [] };

  it('the answer is the last result record\'s text', () => {
    const raw = jsonl(init,
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the inventory.' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Closed step 1.1.' });
    assert.equal(streamAnswer('claude', raw), 'Closed step 1.1.');
  });

  it('init, usage, an empty or bare result, and narration before an empty result are no answer', () => {
    assert.equal(streamAnswer('claude', jsonl(init)), '');
    assert.equal(streamAnswer('claude', jsonl({ type: 'result' })), '');
    assert.equal(streamAnswer('claude', jsonl(init, { type: 'result', result: '', usage: { output_tokens: 0 } })), '');
    assert.equal(streamAnswer('claude', jsonl(init,
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', name: 'Read', input: {} }] } },
      { type: 'result', is_error: false, result: '   ' })), '');
  });

  it('an error result is no answer, whatever text it carries', () => {
    assert.equal(streamAnswer('claude', jsonl({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' })), '');
  });

  it('a thinking-only result is no answer once sanitized, as runProvider sanitizes it', () => {
    assert.equal(streamAnswer('claude', jsonl({ type: 'result', result: 'Thinking...\nplan\n...done thinking.' })), '');
  });
});

describe('streamAnswer — codex exec --json', () => {
  const started = [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' }];
  const done = { type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 0 } };

  it('the answer is the last agent_message', () => {
    const raw = jsonl(...started,
      { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'first' } },
      { type: 'item.completed', item: { id: 'b', type: 'command_execution', command: 'ls', exit_code: 0 } },
      { type: 'item.completed', item: { id: 'c', type: 'agent_message', text: 'Step 1.1 waits.' } }, done);
    assert.equal(streamAnswer('codex', raw), 'Step 1.1 waits.');
  });

  it('thread/turn/usage records and reasoning items are no answer', () => {
    assert.equal(streamAnswer('codex', jsonl(...started,
      { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: '**thinking**' } }, done)), '');
    assert.equal(streamAnswer('codex', jsonl(...started,
      { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: '' } }, done)), '');
  });

  it('a failed turn or error after the message cancels it', () => {
    const msg = { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'partial' } };
    assert.equal(streamAnswer('codex', jsonl(...started, msg, { type: 'turn.failed', error: { message: 'quota' } })), '');
    assert.equal(streamAnswer('codex', jsonl(...started, msg, { type: 'error', message: 'stream lost' })), '');
  });

  it('the older msg-envelope format is read too', () => {
    assert.equal(streamAnswer('codex', jsonl({ id: '0', msg: { type: 'agent_message', message: 'done' } })), 'done');
    assert.equal(streamAnswer('codex', jsonl({ id: '0', msg: { type: 'task_complete', last_agent_message: 'done' } })), 'done');
    assert.equal(streamAnswer('codex', jsonl({ id: '0', msg: { type: 'agent_message', message: 'x' } },
      { id: '1', msg: { type: 'error', message: 'quota' } })), '');
  });
});

describe('streamAnswer — gemini stream-json', () => {
  const init = { type: 'init', session_id: 's', model: 'gemini-2.5-pro' };
  const prompt = { type: 'message', role: 'user', content: 'the tick prompt' };

  it('the answer is the assistant message text, deltas joined', () => {
    const raw = jsonl(init, prompt,
      { type: 'message', role: 'assistant', content: 'Step 1.1 ', delta: true },
      { type: 'tool_use', tool_name: 'read_file', tool_id: 't', parameters: {} },
      { type: 'message', role: 'assistant', content: 'waits.', delta: true },
      { type: 'result', status: 'success', stats: {} });
    assert.equal(streamAnswer('gemini', raw), 'Step 1.1 waits.');
  });

  it('init, the echoed user prompt and a stats-only result are no answer', () => {
    assert.equal(streamAnswer('gemini', jsonl(init, prompt, { type: 'result', status: 'success', stats: { total_tokens: 3 } })), '');
  });

  it('an error result or error record cancels the answer', () => {
    const said = { type: 'message', role: 'assistant', content: 'partial' };
    assert.equal(streamAnswer('gemini', jsonl(init, said, { type: 'result', status: 'error', error: { message: 'quota' } })), '');
    assert.equal(streamAnswer('gemini', jsonl(init, said, { type: 'error', severity: 'error', message: 'x' })), '');
  });
});

describe('streamAnswer — framing', () => {
  it('non-JSON lines and plain text are never an answer', () => {
    for (const p of PROVIDERS) {
      assert.equal(streamAnswer(p, 'ok\nAll done!\n{"type":"result","result":"cut'), '', p);
      assert.equal(streamAnswer(p, ''), '', p);
    }
  });

  it('an unknown provider throws', () => {
    assert.throws(() => streamAnswer('ollama', ''), /unknown agent provider 'ollama'/);
  });
});

describe('agent-stream.js CLI (what plan-tick.sh runs)', () => {
  const cli = path.join(__dirname, '..', 'lib', 'agent-stream.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stream-'));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const file = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };

  it('exits 0 on an answer, 1 with a reason on none, 2 on misuse', () => {
    assert.equal(run(['claude', file('a.jsonl', jsonl({ type: 'result', result: 'ok' }))]).status, 0);
    const none = run(['codex', file('b.jsonl', jsonl({ type: 'thread.started' }, { type: 'turn.completed' }))]);
    assert.equal(none.status, 1);
    assert.equal(none.stdout, '2 JSON record(s), none an answer\n');
    const empty = run(['gemini', file('c.jsonl', '')]);
    assert.equal(empty.status, 1);
    assert.equal(empty.stdout, 'no JSON records\n');
    assert.equal(run(['ollama', file('d.jsonl', '')]).status, 2);
    assert.equal(run(['claude', path.join(dir, 'missing.jsonl')]).status, 2);
  });
});
