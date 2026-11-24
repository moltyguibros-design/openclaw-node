/**
 * session-trace-emitter.mjs — Real-time JSONL → trace event bridge.
 *
 * Watches the active session's JSONL file for new entries and emits structured
 * trace events to the observability pipeline. Every local interaction (tool call,
 * message, cost update, permission request) appears in the live feed.
 *
 * LLM-agnostic: works with any agent that writes JSONL transcripts.
 * Designed for the memory daemon's tick loop (Phase 1.5).
 *
 * Usage:
 *   import { createSessionTraceEmitter } from './session-trace-emitter.mjs';
 *   const emitter = createSessionTraceEmitter(tracer);
 *   // Each tick:
 *   emitter.processNewEntries(sessionJsonlPath);
 */

import fs from 'fs';
import { scrubSecrets } from '../lib/injection-logger.mjs';

/**
 * Map JSONL entry types to trace categories and tiers.
 * Intentionally generic — not tied to any specific LLM provider.
 */
const ENTRY_MAP = {
  // User/operator sent a message
  user:               { fn: 'message.user',       tier: 1, category: 'lifecycle' },
  // Agent produced a response
  assistant:          { fn: 'message.assistant',   tier: 2, category: 'lifecycle' },
  // Agent invoked a tool
  tool_use:           { fn: 'tool.call',           tier: 1, category: 'state_transition' },
  tool_result:        { fn: 'tool.result',         tier: 2, category: 'compute' },
  // Tool/action result
  result:             { fn: 'tool.result',         tier: 2, category: 'compute' },
  // Agent is computing
  progress:           { fn: 'agent.progress',      tier: 3, category: 'compute' },
  // Awaiting human decision
  permission_request: { fn: 'agent.permission',    tier: 1, category: 'cross_node' },
  // Error in agent execution
  error:              { fn: 'agent.error',         tier: 1, category: 'error' },
  // System message (context injection, etc.)
  system:             { fn: 'message.system',      tier: 2, category: 'lifecycle' },
  // Session summary (end of conversation)
  summary:            { fn: 'session.summary',     tier: 1, category: 'lifecycle' },
};

// Gateway transcripts wrap every turn as {type:'message', message:{role}}.
const GATEWAY_ROLE_TYPE = { user: 'user', assistant: 'assistant', system: 'system', toolResult: 'tool_result' };

// Excerpts land in the obs DB and on the NATS trace subject. Scrub before
// slicing so a cut never leaves a key too short for its pattern to catch.
const excerpt = (text, max = 100) => scrubSecrets(String(text)).slice(0, max);

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b?.type === 'text').map(b => b.text || '').join('\n');
}

/**
 * Extract a human-readable summary from an entry without content blocks.
 */
function summarizeEntry(entry) {
  if (entry.type === 'tool_use') {
    return `tool=${entry.tool || entry.name || entry.tool_name || 'unknown'}`;
  }
  if (entry.message?.content) return excerpt(textOf(entry.message.content));
  if (entry.type === 'permission_request') {
    return entry.tool || entry.permission || 'permission_requested';
  }
  if (entry.type === 'error') {
    const err = entry.error || entry.message || 'unknown error';
    return typeof err === 'string' ? excerpt(err) : 'error';
  }
  if (entry.type === 'summary' && entry.summary) return excerpt(entry.summary);
  return entry.type || 'unknown';
}

/**
 * Cost info from an entry: Claude Code keeps usage under `message`, other
 * writers at the top level.
 */
function extractCost(entry) {
  if (entry.costUSD) return { cost: entry.costUSD };
  if (entry.estimatedCostUsd) return { cost: entry.estimatedCostUsd };
  const usage = entry.message?.usage ?? entry.usage;
  if (usage) {
    return {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_read: usage.cache_read_input_tokens || 0,
    };
  }
  return null;
}

/**
 * The trace events one transcript entry yields, as [ENTRY_MAP key, summary].
 * A turn's content blocks carry its tool calls and results: Claude Code
 * `tool_use`/`tool_result`, gateway `toolCall` and `toolResult` turns.
 */
function entryEvents(entry, toolNames) {
  const msg = entry.message && typeof entry.message === 'object' ? entry.message : null;
  const type = entry.type === 'message' ? GATEWAY_ROLE_TYPE[msg?.role] : entry.type;
  if (!type || !ENTRY_MAP[type]) return [];

  if (entry.type === 'message' && type === 'tool_result') {
    return [[type, `tool=${msg.toolName || 'unknown'}${msg.isError ? ' error' : ''}`]];
  }
  if (!Array.isArray(msg?.content) || (type !== 'user' && type !== 'assistant')) {
    return [[type, summarizeEntry(entry)]];
  }

  const events = [];
  const text = textOf(msg.content).trim();
  if (text) events.push([type, excerpt(text)]);
  for (const block of msg.content) {
    if (block?.type === 'tool_use' || block?.type === 'toolCall') {
      const name = block.name || 'unknown';
      // Gateway results carry their own toolName; only Claude Code results need the id.
      if (block.type === 'tool_use' && block.id) toolNames.set(block.id, name);
      events.push(['tool_use', `tool=${name}`]);
    } else if (block?.type === 'tool_result') {
      const name = toolNames.get(block.tool_use_id) || 'unknown';
      toolNames.delete(block.tool_use_id);
      events.push(['tool_result', `tool=${name}${block.is_error ? ' error' : ''}`]);
    }
  }
  return events;
}

export function createSessionTraceEmitter(tracer) {
  // Track file positions per path so multiple JSONL files can be watched simultaneously
  const _fileState = new Map(); // path → { lastSize, lastCostMsgId }
  // tool_use id → tool name, so a later tool_result can say which tool it answers.
  const toolNames = new Map();

  return {
    /**
     * Read new entries from a JSONL file and emit trace events.
     * Supports being called with different paths each tick (multi-source).
     *
     * @param {string} jsonlPath — path to a session's .jsonl file
     */
    processNewEntries(jsonlPath) {
      if (!jsonlPath || !fs.existsSync(jsonlPath)) return;

      // Get or create tracking state for this file
      if (!_fileState.has(jsonlPath)) {
        // New file — initialize. Set lastSize to current size minus 64KB
        // so we process recent history on first encounter.
        try {
          const initStat = fs.statSync(jsonlPath);
          const initSize = Math.max(0, initStat.size - 65536);
          _fileState.set(jsonlPath, { lastSize: initSize });
          console.log(`[session-trace] Tracking: ${jsonlPath} (from offset ${initSize})`);
        } catch { return; }
      }

      const state = _fileState.get(jsonlPath);

      // Check if file has grown
      let stat;
      try {
        stat = fs.statSync(jsonlPath);
      } catch { return; }

      if (stat.size <= state.lastSize) return; // No new data

      const fd = fs.openSync(jsonlPath, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - state.lastSize);
        fs.readSync(fd, buffer, 0, buffer.length, state.lastSize);
        const lastNl = buffer.lastIndexOf(0x0a);
        if (lastNl < 0) return; // only a partial line so far
        const chunk = buffer.toString('utf8', 0, lastNl);
        const lines = chunk.split('\n').filter(Boolean);

        let emitted = 0;
        for (const line of lines) {
          let entry;
          try {
            entry = JSON.parse(line);
          } catch {
            continue; // Skip malformed lines (including partial first line)
          }

          // Skip high-frequency progress events unless in dev mode
          if (entry.type === 'progress' && process.env.OPENCLAW_TRACE_MODE !== 'dev') continue;

          const events = entryEvents(entry, toolNames);
          if (events.length === 0) continue;

          // Claude Code writes one line per content block of a turn, each
          // repeating the turn's usage; count it once.
          const msgId = entry.message?.id;
          const cost = msgId && msgId === state.lastCostMsgId ? null : extractCost(entry);
          if (cost && msgId) state.lastCostMsgId = msgId;
          const model = entry.message?.model ?? entry.model ?? '';

          events.forEach(([type, summary], i) => {
            const mapping = ENTRY_MAP[type];
            tracer.emit(mapping.fn, {
              tier: mapping.tier,
              category: mapping.category,
              args_summary: summary,
              result_summary: model,
              meta: cost && i === 0 ? JSON.stringify(cost) : null,
            });
            emitted++;
          });
        }

        state.lastSize += lastNl + 1;

        if (emitted > 0) {
          console.log(`[session-trace] Emitted ${emitted} events from ${jsonlPath.split('/').pop()}`);
        }
      } finally {
        fs.closeSync(fd);
      }
    },

    /**
     * Stop tracking one transcript (call when its session ends). Other live
     * transcripts keep their offsets, so their entries are not re-emitted.
     */
    forget(jsonlPath) {
      _fileState.delete(jsonlPath);
    },
  };
}
