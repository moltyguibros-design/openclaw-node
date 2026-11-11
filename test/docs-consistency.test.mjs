import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

test('TEST.md names the CI Node matrix and lists no tested module as a coverage gap', () => {
  const testMd = read('TEST.md');
  const matrix = read('.github/workflows/test.yml').match(/node-version: \[([\d, ]+)\]/)[1];
  assert.ok(testMd.includes(`Root unit tests on Node ${matrix}\n`), `TEST.md CI line must match the [${matrix}] matrix`);
  assert.doesNotMatch(testMd, /Node 18/);
  const testFiles = readdirSync(new URL('../test/', import.meta.url));
  const gaps = section(testMd, '## Coverage Gaps (known)').text;
  for (const [, mod] of gaps.matchAll(/^\| `(?:bin|lib)\/([\w-]+)\.m?js` \|/gm)) {
    const covering = testFiles.find((f) => f.startsWith(`${mod}.test.`) || f.startsWith(`${mod}-lifecycle.test.`));
    assert.equal(covering, undefined, `${mod} is listed as untested but test/${covering} exists`);
  }
});

test('README hooks table says validate-push.sh refuses force pushes, as the hook does', () => {
  const hook = fileURLToPath(new URL('../.claude/hooks/validate-push.sh', import.meta.url));
  const r = spawnSync('bash', [hook], { input: JSON.stringify({ tool_input: { command: 'git push origin main --force' } }), encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  const row = read('README.md').split('\n').find((l) => l.startsWith('| `validate-push.sh` |'));
  assert.match(row, /Refuses force-push \(exit 2\)/);
  const sessionRow = read('README.md').split('\n').find((l) => l.startsWith('| `session-start.sh` |'));
  assert.match(read('.claude/hooks/session-start.sh'), /\.daemon-state-\$\{_NODE_ID\}\.md/);
  assert.match(sessionRow, /\.daemon-state-<node>\.md/);
});

test('README names the obsidian-sync.json path the installer writes and the readers open', () => {
  assert.match(read('scripts/install/config.sh'), /"\$OPENCLAW_ROOT\/config\/obsidian-sync\.json"/);
  assert.match(read('lib/obsidian-vault.mjs'), /join\(homedir\(\), '\.openclaw', 'config', 'obsidian-sync\.json'\)/);
  const readme = read('README.md');
  assert.ok(readme.includes('`~/.openclaw/config/obsidian-sync.json`'));
  assert.doesNotMatch(readme, /workspace\/config\/obsidian-sync\.json/);
});
