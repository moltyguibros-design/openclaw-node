import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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

test('README says KNOWLEDGE_HOST is the only non-loopback Host the HTTP gate accepts, not 0.0.0.0', () => {
  const readme = read('README.md');
  assert.match(read('lib/mcp-knowledge/server.mjs'), /const self = new Set\(\[`\$\{host\}:\$\{port\}`, `localhost:\$\{port\}`/);
  const row = readme.split('\n').find((l) => l.startsWith('| `KNOWLEDGE_HOST` |'));
  assert.match(row, /`Host`/);
  assert.match(row, /not `0\.0\.0\.0`/);
  const para = readme.split('\n').find((l) => l.startsWith('Mesh worker nodes can reach the lead'));
  assert.match(para, /exact address or name the workers dial.*not `0\.0\.0\.0`/);
});

test('README KNOWLEDGE_ROOT default is the working directory core.mjs falls back to, and .mcp.json sets the workspace', () => {
  assert.match(read('lib/mcp-knowledge/core.mjs'), /WORKSPACE = process\.env\.KNOWLEDGE_ROOT \|\| process\.cwd\(\);/);
  assert.equal(JSON.parse(read('.mcp.json')).mcpServers.knowledge.env.KNOWLEDGE_ROOT, '${HOME}/.openclaw/workspace');
  const row = read('README.md').split('\n').find((l) => l.startsWith('| `KNOWLEDGE_ROOT` |'));
  assert.match(row, /^\| `KNOWLEDGE_ROOT` \| current working directory \(`\.mcp\.json` sets `~\/\.openclaw\/workspace`\) \|/);
});

test('TEST.md names the CI Node matrix and lists no tested module as a coverage gap', () => {
  const testMd = read('TEST.md');
  const matrix = read('.github/workflows/test.yml').match(/node-version: \[([^\]]+)\]/)[1].replace(/'/g, '');
  assert.ok(testMd.includes(`Root unit tests on Node ${matrix}\n`), `TEST.md CI line must match the [${matrix}] matrix`);
  assert.doesNotMatch(testMd, /Node 18/);
  const testFiles = readdirSync(new URL('../test/', import.meta.url));
  const gaps = section(testMd, '## Coverage Gaps (known)').text;
  for (const [, mod] of gaps.matchAll(/^\| `(?:bin|lib)\/([\w-]+)\.m?js` \|/gm)) {
    const covering = testFiles.find((f) => f.startsWith(`${mod}.test.`) || f.startsWith(`${mod}-lifecycle.test.`));
    assert.equal(covering, undefined, `${mod} is listed as untested but test/${covering} exists`);
  }

  const mcTests = readdirSync(new URL('../mission-control/src/lib/__tests__/', import.meta.url))
    .filter((f) => f.endsWith('.ts')).map((f) => read(`mission-control/src/lib/__tests__/${f}`));
  const mcRows = [...gaps.matchAll(/^\| `mission-control\/\.\.\.\/([\w/-]+)\.tsx?` \| (.*) \|$/gm)];
  assert.ok(mcRows.length >= 1, 'Mission Control gap rows parse');
  for (const [, tail, reason] of mcRows) {
    const fns = [...read(`mission-control/src/lib/${tail}.ts`).matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
    const valueImport = new RegExp(`(?:import (?!type )[^;]*from |import\\()["'](?:@/lib|\\.\\.)/${tail}["']`);
    const importers = mcTests.filter((src) => valueImport.test(src));
    const tested = fns.filter((fn) => importers.some((src) => new RegExp(`\\b${fn}\\b`).test(src)));
    if (tested.length === 0) continue;
    assert.ok(tested.length < fns.length, `${tail}.ts: every exported function is unit-tested; drop the gap row`);
    const named = reason.match(/\(only ((?:`\w+`(?:, )?)+) (?:is|are) unit-tested\)$/);
    assert.ok(named, `${tail}.ts row must say which functions are unit-tested: ${tested.join(', ')}`);
    assert.deepEqual([...named[1].matchAll(/`(\w+)`/g)].map((m) => m[1]).sort(), [...tested].sort(), `${tail}.ts row names the wrong tested functions`);
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

test('NODE_SPEC and NODE_ACCEPTANCE match the service manifest, the probe axes and the MC build', () => {
  const nodeSpec = read('docs/NODE_SPEC.md');
  const topology = section(nodeSpec, '## §5 Service topology (what runs, what it needs)').text;
  const units = new Set();
  for (const [, cell] of topology.matchAll(/^\| (?:\*\*)?(openclaw-[\w/-]+)/gm)) {
    const m = cell.match(/^(.*-)(\d(?:\/\d)+)$/);
    if (m) for (const n of m[2].split('/')) units.add(m[1] + n);
    else units.add(cell);
  }
  for (const { name } of JSON.parse(read('services/service-manifest.json'))) {
    assert.ok(units.has(name), `NODE_SPEC §5 has no row for ${name}`);
  }

  const axes = new Set([...read('lib/node-acceptance-probes.mjs').matchAll(/axis: '([a-z]+)'/g)].map((m) => m[1]));
  assert.ok(axes.has('federation'), 'probe axis parse');
  const gate = section(nodeSpec, '## §7 What "functionally running" means (the gate)').text.toLowerCase();
  const acceptance = read('docs/NODE_ACCEPTANCE.md').split('\n').filter((l) => /# one axis:|accepts `--axis/.test(l));
  assert.equal(acceptance.length, 2);
  for (const axis of axes) {
    assert.ok(gate.includes(axis), `NODE_SPEC §7 does not name the ${axis} axis`);
    for (const line of acceptance) assert.ok(line.includes(axis), `NODE_ACCEPTANCE --axis list lacks ${axis}: ${line}`);
  }
  assert.doesNotMatch(gate, /runtime, ops/);

  for (const f of ['docs/NODE_SPEC.md', 'docs/INSTALL_TEST_PROTOCOL.md', 'scripts/install/components.sh']) {
    assert.doesNotMatch(read(f), /queued tsc/, `${f}: CI builds Mission Control on every push`);
  }
  assert.match(read('.github/workflows/test.yml'), /cd mission-control && npm run build/);
});

test('operator docs state the Node baseline that package.json engines and the installer require', () => {
  const [, majorText, minorText] = read('package.json').match(/"node": ">=(\d+)\.(\d+)"/);
  const [major, minor] = [Number(majorText), Number(minorText)];
  assert.ok(read('scripts/install/prereqs.sh').includes(`[ "$major" -eq ${major} ] && [ "$minor" -ge ${minor} ]`), 'prereqs node_ok baseline');
  const floors = [
    /Node(?:\.js)?\*{0,2} ?(?:\| )?(?:≥|>=) ?(\d+)(?:\.(\d+))?/g, /Node(?:\.js)? (\d+)(?:\.(\d+))?\+/g,
    /`nodejs` \((\d+)(?:\.(\d+))?\+\)/g, /v(\d+)(?:\.(\d+))?\+/g, /node --version +# ≥ v(\d+)\.(\d+)/g,
  ];
  const installs = [/nvm install (\d+)/g, /setup_(\d+)\.x/g];
  for (const doc of ['README.md', 'docs/DOGFOOD_PROTOCOL.md', 'docs/NODE_SPEC.md', 'docs/INSTALL_TEST_PROTOCOL.md', 'docs/MULTI_NODE_DEPLOY.md', 'docs/PUBLISHERS.md']) {
    const text = read(doc);
    for (const re of floors) {
      for (const [hit, a, b = '0'] of text.matchAll(re)) {
        assert.ok(Number(a) > major || (Number(a) === major && Number(b) >= minor), `${doc}: "${hit}" is below the Node ${major}.${minor} engines floor`);
      }
    }
    for (const re of installs) {
      for (const [hit, v] of text.matchAll(re)) assert.ok(Number(v) >= major, `${doc}: "${hit}" installs below Node ${major}`);
    }
  }
  assert.doesNotMatch(read('workspace-docs/RUNBOOK_MC_DEPLOY.md'), /Node 20/);
  assert.doesNotMatch(read('docs/NODE_SPEC.md'), /operator installs \(brew\/nodejs\.org\)/);
});

test('PUBLISHERS.md calls the Claude Code PreCompact publisher wired only when the installed hook runs it', () => {
  const hook = read('.claude/hooks/pre-compact.sh').replace(/^\s*#.*$/gm, '');
  const wired = /hooks\/claude-code\/pre-compact\.sh|openclaw-extract-now/.test(hook);
  const claudeCode = section(read('docs/PUBLISHERS.md'), '### Claude Code').text;
  if (wired) {
    assert.doesNotMatch(claudeCode, /Not wired by default/);
  } else {
    assert.match(claudeCode, /Not wired by default/);
    assert.doesNotMatch(claudeCode, /No manual configuration needed|delegates to/);
  }
});

test('README does not call grappe membership signed or server-verified while the CLI writes it unsigned', () => {
  const cli = read('bin/openclaw-grappe.mjs');
  assert.doesNotMatch(cli, /\b(sign|verify)\w*\(/, 'the grappe CLI signs now: update this test and README');
  assert.match(cli, /await kv\.update\(KEY_PREFIX \+ id/, 'join writes the member from the client');
  const intro = read('README.md').split('\n').find((l) => l.startsWith('- **Federation / Grappe**'));
  assert.doesNotMatch(intro, /signed-membership|join-token verified/);
  assert.match(intro, /membership lives unsigned in the `GRAPPE_REGISTRY` KV/);
});

test('README Federation section carries the plan status while the federation block stands', () => {
  const fed = section(read('README.md'), '## Federation (Grappes)').text;
  let blocked = true;
  try { read('memory-plan/plans/federation/BLOCKED.md'); } catch { blocked = false; }
  assert.equal(/Status: BLOCKED \(D15\)/.test(fed), blocked, 'README federation status must match BLOCKED.md');
  if (!blocked) return;
  const decisions = read('memory-plan/plans/federation/DECISIONS.md');
  assert.match(decisions, /^## D15 — /m);
  assert.match(decisions, /^## D16 — Consensus gating is DEAD/m);
  assert.match(fed, /\*\*D16\*\*[^\n]*retired consensus gating/);
  assert.ok(fed.includes('(memory-plan/plans/federation/BLOCKED.md)'));
  assert.match(fed, /The full v0\.2 design \(pre-D16\) lives in \[docs\/FEDERATION_SPEC\.md\]/);

  const spec = read('docs/FEDERATION_SPEC.md');
  const head = spec.split('\n').slice(0, 15).join('\n');
  assert.match(head, /BLOCKED \(D15\)/, 'FEDERATION_SPEC must carry the plan status');
  assert.match(head, /\*\*D16\*\*[^\n]*retired consensus gating/);
  assert.doesNotMatch(head, /living contract/);
  assert.doesNotMatch(spec, /retry ×3 pending/);
});

test('OBSERVABILITY names only functions that exist, and only the mesh-deploy functions the tracer wraps', () => {
  const doc = read('docs/OBSERVABILITY.md');
  const names = [...new Set([...doc.matchAll(/^\| `([A-Za-z_$][\w$]*)` \| [\w./-]+ \| \d \|/gm)].map((m) => m[1]))];
  assert.ok(names.length > 200, 'OBSERVABILITY row parse');
  const sources = [];
  const walk = (rel) => {
    for (const entry of readdirSync(new URL(`../${rel}/`, import.meta.url), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:m?js|cjs|tsx?)$/.test(entry.name) || (rel === 'bin' && !entry.name.includes('.'))) sources.push(read(path));
    }
  };
  for (const dir of ['bin', 'lib', 'workspace-bin', 'mission-control/src', 'packages']) walk(dir);
  const corpus = sources.join('\n');
  const missing = names.filter((n) => !new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(corpus));
  assert.deepEqual(missing, [], 'OBSERVABILITY lists functions no source defines');

  const deploySrc = read('bin/mesh-deploy.js');
  const wrapped = [...deploySrc.matchAll(/^(\w+) = tracer\.wrap\('\1', \1, \{ tier: (\d)/gm)].map((m) => `${m[1]}:${m[2]}`);
  const listed = [...section(doc, '### 13.2 Mesh Deploy').text.matchAll(/^\| `(\w+)` \| mesh-deploy \| (\d) \|/gm)].map((m) => `${m[1]}:${m[2]}`);
  assert.ok(wrapped.length >= 3, 'mesh-deploy tracer.wrap parse');
  assert.deepEqual(listed.sort(), wrapped.sort());

  assert.doesNotMatch(read('workspace-bin/memory-maintenance.mjs'), /createTracer|tracer\./);
  assert.match(doc, /^### 8\.3 Memory Maintenance \(not instrumented\)$/m);
  assert.doesNotMatch(doc, /\| memory-maintenance \|/);
});

test('README skill count, circling test notes and dependency table match the repo', () => {
  const readme = read('README.md');
  const skills = readdirSync(new URL('../skills/', import.meta.url))
    .filter((d) => d !== '_quarantine' && readdirSync(new URL(`../skills/${d}/`, import.meta.url)).includes('SKILL.md')).length;
  const counts = [...readme.matchAll(/(\d+\+?) skill(?:s for| definitions)/g)];
  assert.ok(counts.length >= 2, 'README skill count parse');
  for (const [hit, n] of counts) assert.equal(n, String(skills), `README "${hit}": ${skills} skills ship outside _quarantine`);

  const adversarial = readme.split('\n').find((l) => l.startsWith('| **adversarial** (circling) |'));
  assert.doesNotMatch(adversarial, /\d+ tests/);
  assert.doesNotMatch(readme, /# All circling tests \(\d+/);

  const installers = (read('bootstrap.sh') + read('scripts/install/prereqs.sh')).toLowerCase();
  const deps = section(readme, '### System dependencies').text;
  const packages = [...deps.matchAll(/^\| `([\w.-]+)`/gm)].map((m) => m[1]);
  assert.ok(packages.length >= 10, 'dependency table parse');
  for (const p of packages) assert.ok(installers.includes(p.toLowerCase()), `README says the installer installs ${p}; neither bootstrap.sh nor prereqs.sh does`);
});

test('FEDERATION_SPEC cites code by file and symbol, never by drifting line number', () => {
  const spec = read('docs/FEDERATION_SPEC.md');
  for (const [hit] of spec.matchAll(/[\w./-]+\.(?:m?js|ts|sh):\d+/g)) assert.fail(`FEDERATION_SPEC line anchor ${hit}`);
  const index = section(spec, '## 9. Cross-reference index (file → symbol → spec section)').text;
  const rows = [...index.matchAll(/^\| `([\w./-]+)` \| `([\w.]+)(?:\(\))?`/gm)];
  assert.ok(rows.length >= 20, 'index parse');
  for (const [, file, symbol] of rows) {
    const name = symbol.split('.').pop();
    assert.match(read(file), new RegExp(`\\b${name}\\b`), `${file} has no ${symbol}`);
  }
});

test('the souls recovery recipe initializes main, as the installer does', () => {
  const guide = read('identity/MULTI_SOUL_GUIDE.md');
  assert.match(guide, /^git init -b main$/m);
  assert.doesNotMatch(guide, /^git init$/m);
});

test('OBSERVABILITY.md PlanStore and role-loader rows name functions those modules have, and the totals count them', () => {
  const require = createRequire(import.meta.url);
  const { PlanStore } = require('../lib/mesh-plans');
  const roleLoader = require('../lib/role-loader');
  const doc = read('docs/OBSERVABILITY.md');
  const has = { PlanStore: (f) => typeof PlanStore.prototype[f] === 'function', 'role-loader': (f) => typeof roleLoader[f] === 'function' };
  for (const [mod, exists] of Object.entries(has)) {
    const rows = [...doc.matchAll(new RegExp(`^\\| \`(\\w+)\` \\| ${mod} \\|`, 'gm'))].map((m) => m[1]);
    assert.ok(rows.length > 0, `no ${mod} rows`);
    for (const f of rows) assert.ok(exists(f), `OBSERVABILITY.md lists ${mod}.${f}, which does not exist`);
    assert.ok(doc.includes(`\n| ${mod} | ${rows.length} |\n`), `OBSERVABILITY.md total for ${mod} must be ${rows.length}`);
  }
});

test('federation recipes start every memory daemon with OPENCLAW_FEDERATION=1 while the daemon gates on it', () => {
  const daemon = read('workspace-bin/memory-daemon.mjs');
  assert.match(daemon, /if \(process\.env\.OPENCLAW_FEDERATION === '1'\) \{\n\s+try \{\n\s+await initFederationSubsystems/);
  assert.match(daemon, /if \(process\.env\.OPENCLAW_FEDERATION === '1'\) \{\n\s+log\(`FATAL: Shared stream config mismatch/);
  for (const doc of ['docs/DOGFOOD_PROTOCOL.md', 'docs/MULTI_NODE_DEPLOY.md']) {
    const blocks = read(doc).split('```').filter((_, i) => i % 2 === 1);
    let daemons = 0;
    for (const block of blocks) {
      const runs = block.split('\n').filter((l) => /\bnode .*memory-daemon\.mjs|^ExecStart=.*memory-daemon\.mjs/.test(l)).length;
      daemons += runs;
      assert.equal((block.match(/OPENCLAW_FEDERATION=1/g) || []).length, runs, `${doc}: a block starts ${runs} daemon(s) without OPENCLAW_FEDERATION=1:\n${block}`);
    }
    assert.ok(daemons >= 3, `${doc}: daemon command parse`);
  }
  const deploy = read('docs/MULTI_NODE_DEPLOY.md');
  for (const line of deploy.split('\n').filter((l) => /[Rr]efuse(s)? to start if/.test(l))) {
    assert.match(line, /OPENCLAW_FEDERATION=1/, `MULTI_NODE_DEPLOY promises a refusal the daemon makes only with the flag: ${line}`);
  }
  assert.match(section(deploy, '### Federation').text, /^\| `OPENCLAW_FEDERATION` \|/m);
  assert.match(section(read('docs/DOGFOOD_PROTOCOL.md'), '### All zeros in stats').text, /OPENCLAW_FEDERATION=1/);
});

test('MULTI_NODE_DEPLOY Part 2 runs the daemon as the operator on the spawned tree with the key it signs with', () => {
  const doc = read('docs/MULTI_NODE_DEPLOY.md');
  for (const stale of ['\\$(hostname)', '%h/.openclaw-%H', 'OPENCLAW_NODE_ID=%H', '/home/user/openclaw-nodedev']) {
    assert.ok(!doc.includes(stale), `MULTI_NODE_DEPLOY still contains ${stale}`);
  }
  const units = doc.split('```').filter((b, i) => i % 2 === 1 && b.includes('[Service]') && b.includes('memory-daemon.mjs'));
  assert.ok(units.length >= 1, 'systemd unit parse');
  for (const unit of units) {
    assert.match(unit, /^User=/m, 'a system unit without User= runs the daemon as root on /root');
    assert.match(unit, /^Environment=OPENCLAW_HOME=\/home\/<operator>\/\.openclaw-alpha$/m);
  }

  const startCall = read('workspace-bin/memory-daemon.mjs').match(/startFederation\(nc, NODE_ID, \{[^}]*\}\)/)[0];
  assert.doesNotMatch(startCall, /identityDir/);
  assert.match(read('lib/node-identity.mjs'), /const dir = identityDir \|\| DEFAULT_IDENTITY_DIR;/);
  assert.match(doc.slice(doc.indexOf('\n### 2.6 Per-node setup\n'), doc.indexOf('\n### 2.7 ')), /getOrCreateIdentity\(\)/);

  assert.match(read('bin/spawn-node.mjs'), /const dbPath = join\(nodeRoot, 'state\.db'\);/);
  const tree = section(doc, '### 1.2 Spawn node trees').text;
  assert.doesNotMatch(tree, /state\/\s+#.*state\.db/);
  assert.match(tree, /^ {2}state\.db +#/m);
  assert.doesNotMatch(tree, /MEMORY\.md|\.companion-state\.md/);
});

test('INSTALL_TEST_PROTOCOL T1 unit counts match the service manifest per role', () => {
  const manifest = JSON.parse(read('services/service-manifest.json'));
  const forRole = (role) => manifest.filter((s) => s.role === 'both' || s.role === role);
  const [lead, worker] = [forRole('lead').length, forRole('worker').length];
  const timers = manifest.filter((s) => s.timer && s.role === 'both').length;
  assert.equal(forRole('lead').filter((s) => s.timer).length, timers, 'every timer unit renders on both roles');
  const doc = read('docs/INSTALL_TEST_PROTOCOL.md');
  assert.equal(doc.split(`${lead} on a lead, ${worker} on a worker`).length - 1, 2, `T1.5 must give ${lead}/${worker} for macOS and Linux`);
  assert.ok(doc.includes(`openclaw-*.timer: ${timers}`), `T1.5 must give ${timers} timers`);
  assert.doesNotMatch(doc, /macOS lead: \d+ files/);
});

test('INSTALL_TEST_PROTOCOL T3 extraction-mode grep matches the lines the daemon logs', () => {
  const protocol = read('docs/INSTALL_TEST_PROTOCOL.md');
  const t3 = protocol.slice(protocol.indexOf('\n## T3 '), protocol.indexOf('\n## T4 '));
  const grep = t3.split('\n').find((l) => l.startsWith('grep -E ') && l.includes('memory-daemon.log'));
  assert.ok(grep, 'T3 extraction-mode grep');
  const re = new RegExp(grep.match(/^grep -E (['"])(.+?)\1 /)[2]);
  const templates = [...read('workspace-bin/memory-daemon.mjs').matchAll(/log\(`([^`]*(?:flush|synthesis) \[\$\{result\.mode \|\| 'regex'\}\][^`]*)`\)/g)].map((m) => m[1]);
  assert.ok(templates.length >= 4, 'daemon extraction log templates');
  const modes = [...new Set([...read('lib/pre-compression-flush.mjs').matchAll(/mode: (?:isStructured \? )?'([a-z-]+)'(?: : '([a-z-]+)')?/g)].flatMap((m) => m.slice(1)).filter((m) => m && m !== 'none'))];
  assert.deepEqual(modes.sort(), ['llm', 'llm-dedup', 'regex', 'regex-diverted']);
  for (const template of templates) {
    for (const mode of modes) {
      const line = template.replace("${result.mode || 'regex'}", mode).replace(/\$\{[^}]+\}/g, '0');
      assert.match(line, re, `T3 grep misses the daemon line "${line}"`);
    }
  }
  assert.match(t3, /# PASS: \[llm\] or \[llm-dedup\]/);
});

test('NODE_WATCH_SPEC has a row for every element node-watch grades', () => {
  const targets = [...read('lib/node-watch.mjs').matchAll(/\{ id: '([^']+)', family: '[a-z-]+', label: '([^']+)'/g)];
  assert.ok(targets.length >= 30, 'watch target parse');
  const elements = read('docs/NODE_WATCH_SPEC.md').split('\n').filter((l) => l.startsWith('| ')).map((l) => l.slice(2).split(' | ')[0]);
  for (const [, id, label] of targets) {
    const name = label.split(' (')[0];
    assert.ok(elements.some((cell) => cell.includes(name)), `NODE_WATCH_SPEC has no row for ${id} (${name})`);
  }
});

test('STATE_FILES names every state.db table, the daemon log rotation and reader, and the NODE_ID rule', () => {
  const doc = read('docs/STATE_FILES.md');
  const stateDb = section(doc, '### `state.db`').text;
  const stores = ['lib/session-store.mjs', 'lib/hyperagent-store.mjs', 'lib/extraction-store.mjs', 'lib/memory-archive.mjs'];
  assert.match(read('lib/extraction-store.mjs'), /const DEFAULT_DB_PATH = path\.join\(os\.homedir\(\), '\.openclaw\/state\.db'\);/);
  for (const store of stores) {
    const tables = [...read(store).matchAll(/CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    assert.ok(tables.length >= 3, `${store}: table parse`);
    for (const t of tables) assert.ok(stateDb.includes(`\`${t}\``), `STATE_FILES state.db lacks ${t} (${store})`);
  }

  assert.match(read('bin/log-rotate'), /^rotate_dir "\$OPENCLAW_ROOT\/workspace\/\.tmp"$/m);
  assert.match(read('lib/observer.mjs'), /DEFAULT_DAEMON_LOG = path\.join\(HOME, '\.openclaw', 'workspace', '\.tmp', 'memory-daemon\.log'\)/);
  const daemonLog = section(doc, '### `.tmp/memory-daemon.log`').text;
  assert.match(daemonLog, /`bin\/log-rotate`/);
  assert.match(daemonLog, /`lib\/observer\.mjs`/);
  assert.doesNotMatch(doc, /Grows indefinitely \(no rotation\)|No in-repo code reads this file/);

  assert.match(read('lib/node-id.js'), /OPENCLAW_NODE_ID[\s\S]*MESH_NODE_ID/);
  assert.doesNotMatch(doc, /\|\| os\.hostname\(\)|OPENCLAW_NODE_ID:-\$\(hostname\)/);
});

test('NODE_ACCEPTANCE says who runs the gate after a deploy and names the federation probes that ship', () => {
  const doc = read('docs/NODE_ACCEPTANCE.md');
  if (!read('bin/mesh-deploy-listener.js').includes('node-acceptance')) {
    assert.doesNotMatch(doc, /runs the harness post-restart/, 'mesh-deploy-listener does not run the acceptance harness');
    assert.match(section(doc, '## 10. How it enforces "100%"').text, /Deploy-listener gate — not built/);
  }
  const fed = [...read('lib/node-acceptance-probes.mjs').matchAll(/id: '([A-Z0-9-]+)', layer: '\w+', axis: 'federation'/g)].map((m) => m[1]);
  assert.ok(fed.length >= 2, 'federation probe parse');
  for (const heading of ['## 2. Scope of this round', '## 8. Inter-node reliability — L3 (DEFERRED this round; contract for the next)']) {
    const text = section(doc, heading).text;
    for (const id of fed) assert.ok(text.includes(id), `NODE_ACCEPTANCE "${heading}" calls federation unbuilt but ${id} ships`);
  }
});

test('NODE_ACCEPTANCE check tables list exactly the checks the gate emits', () => {
  const doc = read('docs/NODE_ACCEPTANCE.md');
  const implemented = new Set([
    ...[...read('lib/node-acceptance-probes.mjs').matchAll(/^\s+id: '([A-Z0-9-]+)', layer:/gm)].map((m) => m[1]),
    ...[...read('lib/node-acceptance.mjs').matchAll(/^\s+\{ component: '\w+', +id: '([A-Z0-9-]+)'/gm)].map((m) => m[1]),
  ]);
  assert.ok(implemented.size >= 20, 'acceptance check id parse');
  const tabled = new Set([...doc.matchAll(/^\| ([A-Z]{3}-L\d-[A-Z0-9]+|L0-[A-Z]+) \|/gm)].map((m) => m[1]));
  for (const id of implemented) assert.ok(tabled.has(id), `NODE_ACCEPTANCE has no table row for ${id}`);
  for (const id of tabled) assert.ok(implemented.has(id), `NODE_ACCEPTANCE tables ${id}, which the gate does not emit (list it under Not built)`);
  assert.ok(doc.slice(doc.indexOf('\n### Not built\n'), doc.indexOf('\n## 12. ')).length > 20, 'NODE_ACCEPTANCE §11 needs a "### Not built" list');
  const record = doc.slice(doc.indexOf('\n## 11. '), doc.indexOf('\n## 12. '));
  for (const [hit] of doc.replace(record, '').matchAll(/\b(?:MEM|LLM|NET)-L\d-\d+\b/g)) {
    assert.ok(implemented.has(hit), `NODE_ACCEPTANCE cites the retired ID ${hit} outside the §11 record`);
  }
  assert.doesNotMatch(doc.split('\n').slice(0, 8).join('\n'), /mocked unit tests|not yet run against a live node/);
  assert.match(read('lib/node-acceptance-probes.mjs'), /note = \(process\.platform !== 'win32' && \(st\.mode & 0o077\)\) \? ` \(warning: mode/);
  assert.match(doc.split('\n').find((l) => l.startsWith('| L0-TOKEN |')), /warning/);
});

test('README Distributed Mission Control describes the daemon submit path, daemon-side CAS and the tests that exist', () => {
  const readme = read('README.md');
  const start = readme.indexOf('\n## Distributed Mission Control\n');
  const dmc = readme.slice(start, readme.indexOf('\n## ', start + 1));
  assert.match(read('mission-control/src/app/api/mesh/tasks/route.ts'), /requestDaemon\(await getNats\(\), "mesh\.tasks\.submit"/);
  assert.match(read('lib/mesh-tasks.js'), /await this\.kv\.update\(key, sc\.encode\(JSON\.stringify\(updated\)\), entry\.revision\);/);
  const layer2 = dmc.split('\n').find((l) => l.startsWith('**Layer 2 '));
  assert.match(layer2, /`POST \/api\/mesh\/tasks`[^\n]*`mesh\.tasks\.submit`/);
  const cas = section(dmc, '### CAS (Compare-And-Swap) Explained').text;
  assert.match(cas, /Mission Control never writes KV/);
  assert.doesNotMatch(cas, /you must provide the current revision|fails with a 409/);
  assert.doesNotMatch(dmc, /mesh-kv\.ts +# Sync engine|CAS push/);
  assert.doesNotMatch(dmc, /\d+ (?:unit |integration )?tests\b/, 'test counts drift; name what the files cover instead');
  for (const line of dmc.split('\n').filter((l) => l.includes('mesh-kv-sync.test.ts'))) assert.doesNotMatch(line, /CAS|authority|proposals/, line);
  for (const line of dmc.split('\n').filter((l) => l.includes('distributed-mc.test.js'))) assert.doesNotMatch(line, /proposal/, line);
  const row = read('TEST.md').split('\n').find((l) => l.startsWith('| `mesh-kv-sync.test.ts` |'));
  assert.doesNotMatch(row, /CAS|conflict resolution|KV-to-DB/);
});

test('NODE_ACCEPTANCE gives the legacy local.> stream procedure the daemon and NET-L2-STREAM print', () => {
  const net = section(read('docs/NODE_ACCEPTANCE.md'), '## 6. Axis: Network connection (local)').text;
  const lel = read('lib/local-event-log.mjs');
  assert.ok(lel.includes("nats stream edit ${name} --subjects 'local.${legacyId}.>'"), 'local-event-log remedy parse');
  assert.ok(net.includes("`nats stream edit local-events-<old-id> --subjects 'local.<old-id>.>'`"), 'NODE_ACCEPTANCE §6 lacks the narrowing command');
  assert.match(lel, /throw new Error\(`cannot create \$\{streamName\}/);
  assert.match(read('workspace-bin/memory-daemon.mjs'), /log\(`Local event log unavailable \(\$\{evtErr\.message\}\)/);
  assert.ok(net.includes('`Local event log unavailable (cannot create local-events-<NODE_ID>'), 'NODE_ACCEPTANCE §6 misquotes the daemon log');
  assert.match(net, /Preserve its history first/);
});

test('MULTI_NODE_DEPLOY gives the INJECTION_TOKEN_BUDGET default memory-injector falls back to', () => {
  const fallback = read('lib/memory-injector.mjs').match(/INJECTION_TOKEN_BUDGET\) \|\| (\d+)/)[1];
  const rows = read('docs/MULTI_NODE_DEPLOY.md').split('\n').filter((l) => l.startsWith('| `INJECTION_TOKEN_BUDGET`'));
  assert.ok(rows.length > 0, 'INJECTION_TOKEN_BUDGET row missing');
  for (const row of rows) assert.ok(row.includes(`| \`${fallback}\` |`), row);
});
