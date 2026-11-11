import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function section(doc, heading, from = 0) {
  const start = doc.indexOf(`\n${heading}\n`, from);
  assert.ok(start >= 0, `missing heading ${heading}`);
  const next = doc.indexOf('\n#', start + heading.length + 2);
  return { start, text: doc.slice(start, next < 0 ? undefined : next) };
}

test('README knowledge-server tables name every tool and KNOWLEDGE_* variable the server has', () => {
  const readme = read('README.md');
  const server = read('lib/mcp-knowledge/server.mjs');
  const toolsSrc = server.slice(server.indexOf('const TOOLS = ['), server.indexOf('\n];\n'));
  const tools = [...toolsSrc.matchAll(/^ {4}name: '([a-z_]+)',$/gm)].map((m) => m[1]);
  assert.ok(tools.includes('semantic_search') && tools.includes('sql_query'), 'TOOLS parse');
  const knowledge = section(readme, '## Semantic Knowledge Search (MCP)').start;
  const toolTable = section(readme, '### Tools exposed', knowledge).text;
  for (const t of tools) assert.ok(toolTable.includes(`| \`${t}(`), `README tools table lacks ${t}`);

  const dir = new URL('../lib/mcp-knowledge/', import.meta.url);
  const vars = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    for (const m of readFileSync(new URL(f, dir), 'utf8').matchAll(/process\.env\.(KNOWLEDGE_[A-Z_]+)/g)) vars.add(m[1]);
  }
  const configTable = section(readme, '### Configuration', knowledge).text;
  for (const v of vars) assert.ok(configTable.includes(`| \`${v}\` |`), `README config table lacks ${v}`);
});
