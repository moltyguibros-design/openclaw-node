/**
 * agent-stream.js — the answer a plan tick's agent CLI gave, read from its JSONL stream.
 *
 * plan-tick.sh runs claude (`--output-format stream-json`), codex (`exec --json`)
 * or gemini (`--output-format stream-json`) and keeps the raw stream. An exit-0
 * run that changed nothing is only a good run if the provider actually answered:
 * init, usage and empty result records are metadata, not an answer, and counting
 * their bytes let a CLI that answered nothing reset the failure count forever.
 *
 * Each provider's answer is the text it would hand a caller:
 *   claude  the last result record's `result` (parseClaudeJsonResult), unless is_error
 *   codex   the last agent_message after any failed turn
 *   gemini  the assistant message text, unless the run's result reports an error
 * Text is sanitized with stripLlmOutput, as runProvider does, before it counts.
 *
 * CLI: node lib/agent-stream.js <claude|codex|gemini> <stream.jsonl>
 *   exit 0  the stream holds a non-empty answer
 *   exit 1  it does not (prints why on stdout)
 *   exit 2  usage error or unreadable stream
 */

const fs = require('fs');
const { parseClaudeJsonResult, stripLlmOutput } = require('./llm-providers');

function records(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const r = JSON.parse(t);
      if (r && typeof r === 'object') out.push({ line: t, record: r });
    } catch { /* a partial or non-JSON line carries no answer */ }
  }
  return out;
}

const READERS = {
  claude(recs) {
    let answer = '';
    for (const { line, record } of recs) {
      if (record.type !== 'result') continue;
      const parsed = parseClaudeJsonResult(line);
      answer = parsed && record.is_error !== true ? parsed.text : '';
    }
    return answer;
  },

  // Current `codex exec --json` emits item.completed{item:{type:'agent_message',text}};
  // older releases emitted {msg:{type:'agent_message',message}} and task_complete.
  codex(recs) {
    let answer = '';
    for (const { record } of recs) {
      const item = record.item;
      const msg = record.msg;
      if (record.type === 'item.completed' && item && item.type === 'agent_message' && typeof item.text === 'string') {
        answer = item.text;
      } else if (record.type === 'turn.failed' || record.type === 'error') {
        answer = '';
      } else if (msg && msg.type === 'agent_message' && typeof msg.message === 'string') {
        answer = msg.message;
      } else if (msg && msg.type === 'task_complete' && typeof msg.last_agent_message === 'string') {
        answer = msg.last_agent_message;
      } else if (msg && msg.type === 'error') {
        answer = '';
      }
    }
    return answer;
  },

  // Assistant text arrives as message records (often delta chunks); the result
  // record carries only status and stats.
  gemini(recs) {
    let answer = '';
    for (const { record } of recs) {
      if (record.type === 'message' && record.role === 'assistant' && typeof record.content === 'string') {
        answer += record.content;
      } else if ((record.type === 'result' && record.status && record.status !== 'success') || record.type === 'error') {
        answer = '';
      }
    }
    return answer;
  },
};

/** The provider's sanitized answer text ('' when it gave none). */
function streamAnswer(provider, raw) {
  const read = READERS[provider];
  if (!read) throw new Error(`unknown agent provider '${provider}' (claude, codex or gemini)`);
  return stripLlmOutput(read(records(raw))) || '';
}

module.exports = { streamAnswer, PROVIDERS: Object.keys(READERS) };

if (require.main === module) {
  const [provider, file] = process.argv.slice(2);
  if (!READERS[provider] || !file) {
    process.stderr.write('usage: agent-stream.js <claude|codex|gemini> <stream.jsonl>\n');
    process.exit(2);
  }
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    process.stderr.write(`agent-stream: cannot read ${file}: ${err.message}\n`);
    process.exit(2);
  }
  const answer = streamAnswer(provider, raw);
  if (answer) process.exit(0);
  const n = records(raw).length;
  process.stdout.write(n ? `${n} JSON record(s), none an answer\n` : 'no JSON records\n');
  process.exit(1);
}
