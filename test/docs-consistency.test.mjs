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
