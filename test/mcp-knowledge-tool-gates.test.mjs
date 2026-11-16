import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../lib/mcp-knowledge/server.mjs';

async function connect(opts) {
  const server = createMcpServer({}, opts);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'gate-test', version: '0' });
  await client.connect(clientSide);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('HTTP gates: sql_query and sql_schema are neither listed nor callable without KNOWLEDGE_ALLOW_SQL', async () => {
  const { client, close } = await connect({ allowReindex: false, allowSql: false });
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(names.includes('semantic_search'));
    for (const hidden of ['sql_query', 'sql_schema', 'reindex']) assert.ok(!names.includes(hidden), `${hidden} listed`);
    for (const [name, args] of [['sql_query', { db: 'state', sql: 'SELECT 1' }], ['sql_schema', { db: 'state' }]]) {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, true);
      assert.match(r.content[0].text, /disabled on this transport \(set KNOWLEDGE_ALLOW_SQL=1/);
    }
  } finally {
    await close();
  }
});

test('stdio defaults and KNOWLEDGE_ALLOW_SQL=1 keep the sql tools', async () => {
  for (const opts of [undefined, { allowReindex: false, allowSql: true }]) {
    const { client, close } = await connect(opts);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      assert.ok(names.includes('sql_query') && names.includes('sql_schema'));
    } finally {
      await close();
    }
  }
});
