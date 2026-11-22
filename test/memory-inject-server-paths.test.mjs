/**
 * memory-inject-server-paths.test.mjs — the inject server lives under
 * OPENCLAW_HOME like the rest of its daemon.
 *
 * A spawned dev node (bin/spawn-node.mjs) runs its daemon with its own
 * OPENCLAW_HOME, and node-acceptance / node-watch read the inject token from
 * $OPENCLAW_HOME/config. The server wrote the token and the injection log under
 * ~/.openclaw, and its fallbacks opened ~/.openclaw/state.db and a knowledge
 * handle without sqlite-vec (channel 2 failed on every prompt).
 *
 * Run: node --test test/memory-inject-server-paths.test.mjs
 */

import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'mis-paths-'));
const HOME_DIR = join(TMP, 'home');
const NODE_ROOT = join(TMP, 'node-root');
mkdirSync(HOME_DIR);
process.env.HOME = HOME_DIR;
process.env.OPENCLAW_HOME = NODE_ROOT;
delete process.env.GRAPH_CACHE_DB_PATH;
delete process.env.INJECTION_LOG_DISABLED;
delete process.env.INJECTION_LOG_PATH;

const { initDatabase } = await import('../lib/mcp-knowledge/core.mjs');
const { startInjectionServer } = await import('../lib/memory-inject-server.mjs');

after(() => rmSync(TMP, { recursive: true, force: true }));

it('keeps its token, log and fallback stores under OPENCLAW_HOME', async () => {
  mkdirSync(join(NODE_ROOT, 'workspace'), { recursive: true });
  const kdb = initDatabase(join(NODE_ROOT, 'workspace', '.knowledge.db'));
  kdb.prepare(`INSERT INTO session_documents (session_id, source_path, content_hash, last_indexed, turn_count)
    VALUES ('s-paths', '/fake/s-paths.jsonl', 'h', 0, 1)`).run();
  kdb.prepare(`INSERT INTO session_chunks (session_id, turn_index, role, text, snippet)
    VALUES ('s-paths', 0, 'user', 'jetstream consumer setup', 'jetstream consumer setup')`).run();
  kdb.close();

  const logs = [];
  const server = await startInjectionServer({ llmClient: null }, { port: 0, host: '127.0.0.1', log: (m) => logs.push(m) });
  let body;
  try {
    const tokenPath = join(NODE_ROOT, 'config', 'memory-injection-token');
    assert.ok(existsSync(tokenPath), 'token under OPENCLAW_HOME');
    assert.equal(readFileSync(tokenPath, 'utf8').trim(), server.token);
    assert.ok(!existsSync(join(HOME_DIR, '.openclaw')), 'nothing written under ~/.openclaw');
    assert.ok(existsSync(join(NODE_ROOT, 'state.db')), 'extraction fallback opened OPENCLAW_HOME/state.db');
    assert.ok(existsSync(join(NODE_ROOT, 'graph-cache.db')), 'graph fallback opened OPENCLAW_HOME/graph-cache.db');

    const res = await fetch(`http://127.0.0.1:${server.port}/memory/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.token}`, Connection: 'close' },
      body: JSON.stringify({ prompt: 'jetstream consumer', session_id: 's-paths-test', frontend: 'test' }),
    });
    assert.equal(res.status, 200);
    body = await res.json();
  } finally {
    await server.close();
  }

  assert.ok(body.items.snippets >= 1, `knowledge fallback opened OPENCLAW_HOME/workspace/.knowledge.db: ${JSON.stringify(body)}`);
  assert.ok(!logs.some((m) => /no such module: vec0/.test(m)), logs.join('\n'));
  assert.ok(existsSync(join(NODE_ROOT, 'workspace', 'logs', 'memory-injections.jsonl')), 'injection log under OPENCLAW_HOME');
  assert.ok(!existsSync(join(HOME_DIR, '.openclaw')), 'nothing written under ~/.openclaw');
});
