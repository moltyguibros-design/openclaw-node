/**
 * Tests for lib/mesh-harness.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  loadHarnessRules,
  rulesByEnforcement,
  postExecutionScan,
  scanOutputForBlocks,
  formatHarnessForPrompt,
  runMeshHarness,
  runPreChecks,
} = require('../lib/mesh-harness');

// ── loadHarnessRules ─────────────────────────────

describe('loadHarnessRules', () => {
  it('loads mesh-scoped rules from shipped config', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(rules.length > 0, 'Expected at least one mesh rule');
    for (const r of rules) {
      assert.ok(r.scope.includes('mesh'), `Rule ${r.id} should have mesh scope`);
    }
  });

  it('loads local-scoped rules', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'local'
    );
    assert.ok(rules.length > 0, 'Expected at least one local rule');
    for (const r of rules) {
      assert.ok(r.scope.includes('local'), `Rule ${r.id} should have local scope`);
    }
  });

  it('local includes session-boot-context, mesh does not', () => {
    const local = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'local'
    );
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(local.some(r => r.id === 'session-boot-context'), 'Local should have session-boot-context');
    assert.ok(!mesh.some(r => r.id === 'session-boot-context'), 'Mesh should NOT have session-boot-context');
  });

  it('mesh includes scope-enforcement, local does not', () => {
    const local = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'local'
    );
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(mesh.some(r => r.id === 'scope-enforcement'), 'Mesh should have scope-enforcement');
    assert.ok(!local.some(r => r.id === 'scope-enforcement'), 'Local should NOT have scope-enforcement');
  });

  it('excludes inactive rules', () => {
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    assert.ok(!mesh.some(r => r.id === 'block-sudo-in-scripts'), 'Inactive rule should be excluded');
  });

  it('returns empty for missing file', () => {
    const rules = loadHarnessRules('/nonexistent/path.json', 'mesh');
    assert.deepStrictEqual(rules, []);
  });
});

// ── rulesByEnforcement ───────────────────────────

describe('rulesByEnforcement', () => {
  it('filters rules by enforcement type', () => {
    const mesh = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const scopeRules = rulesByEnforcement(mesh, 'scope_check');
    assert.ok(scopeRules.length > 0, 'Should have scope_check rules');
    assert.ok(scopeRules.every(r => r.mesh_enforcement === 'scope_check'));

    const blockRules = rulesByEnforcement(mesh, 'output_block');
    assert.ok(blockRules.length > 0, 'Should have output_block rules');
  });
});

// ── postExecutionScan ────────────────────────────

describe('postExecutionScan', () => {
  it('detects error patterns in output', () => {
    const output = 'line 1\nError: something failed\nline 3\nFAIL tests\nline 5';
    const patterns = ['error:', 'Error:', 'FAIL'];
    const result = postExecutionScan(output, patterns);
    assert.ok(result.suspicious, 'Should be suspicious');
    assert.ok(result.matches.length >= 2, 'Should match at least 2 lines');
  });

  it('not suspicious for clean output', () => {
    const output = 'Building...\nDone in 2.3s\nAll good';
    const patterns = ['error:', 'Error:', 'FAIL'];
    const result = postExecutionScan(output, patterns);
    assert.ok(!result.suspicious, 'Should not be suspicious');
    assert.strictEqual(result.matches.length, 0);
  });

  it('handles null/empty inputs', () => {
    assert.deepStrictEqual(postExecutionScan(null, []).suspicious, false);
    assert.deepStrictEqual(postExecutionScan('', ['error']).suspicious, false);
    assert.deepStrictEqual(postExecutionScan('error here', null).suspicious, false);
  });
});

// ── scanOutputForBlocks ──────────────────────────

describe('scanOutputForBlocks', () => {
  it('detects rm -rf in output', () => {
    const rules = [{
      id: 'block-rm-rf',
      pattern: 'rm\\s+-rf\\s+[^{]',
      active: true,
    }];
    const output = 'Running cleanup...\nrm -rf /tmp/old\nDone';
    const result = scanOutputForBlocks(output, rules);
    assert.ok(result.blocked, 'Should be blocked');
    assert.strictEqual(result.violations[0].ruleId, 'block-rm-rf');
  });

  it('passes clean output', () => {
    const rules = [{
      id: 'block-rm-rf',
      pattern: 'rm\\s+-rf\\s+[^{]',
      active: true,
    }];
    const result = scanOutputForBlocks('npm test\nAll passed', rules);
    assert.ok(!result.blocked, 'Should not be blocked');
  });
});

// ── formatHarnessForPrompt ───────────────────────

describe('formatHarnessForPrompt', () => {
  it('formats inject rules into prompt text', () => {
    const rules = [
      { id: 'r1', tier: 1, type: 'inject', content: 'RULE: do X' },
      { id: 'r2', tier: 2, type: 'inject', content: 'RULE: do Y', activateOn: ['task start'] },
      { id: 'r3', type: 'enforce', content: 'mechanical only' }, // should be excluded
    ];
    const output = formatHarnessForPrompt(rules, 'task start');
    assert.ok(output.includes('## Harness Rules'), 'Should have header');
    assert.ok(output.includes('RULE: do X'), 'Should include r1');
    assert.ok(output.includes('RULE: do Y'), 'Should include r2');
    assert.ok(!output.includes('mechanical only'), 'Should exclude enforce type');
  });

  it('does not inject inactive lifecycle phases', () => {
    const rules = [
      { id: 'start', tier: 2, type: 'inject', content: 'START RULE', activateOn: ['task start'] },
      { id: 'close', tier: 2, type: 'inject', content: 'CLOSE RULE', activateOn: ['task complete'] },
    ];
    const output = formatHarnessForPrompt(rules, 'task start\nstatus: running');
    assert.match(output, /START RULE/);
    assert.doesNotMatch(output, /CLOSE RULE/);
  });

  it('retired rules are inert even when a stale copy still carries content (0.1)', () => {
    const rules = [
      { id: 'live', tier: 1, type: 'inject', content: 'LIVE RULE' },
      { id: 'ghost', tier: 1, type: 'inject', content: 'GHOST RULE', retired: true },
    ];
    const output = formatHarnessForPrompt(rules, 'task start');
    assert.match(output, /LIVE RULE/);
    assert.doesNotMatch(output, /GHOST RULE/);
  });

  it('the shipped source config carries no active hyperagent rule (mesh-only boundary)', () => {
    const shipped = JSON.parse(
      require('node:fs').readFileSync(path.join(__dirname, '../config/harness-rules.json'), 'utf-8'));
    for (const r of shipped) {
      if (String(r.id || '').startsWith('hyperagent-')) {
        assert.equal(r.retired, true, `${r.id} must be retired`);
        assert.equal(r.content, undefined, `${r.id} must carry no content`);
      }
    }
    assert.equal(formatHarnessForPrompt(shipped, 'task start task complete').toLowerCase().includes('hyperagent'), false);
  });

  it('returns empty for no inject rules', () => {
    const output = formatHarnessForPrompt([{ id: 'x', type: 'enforce', content: 'y' }]);
    assert.strictEqual(output, '');
  });
});

// ── runMeshHarness (composite) ───────────────────

describe('runMeshHarness', () => {
  it('passes with clean state', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const result = runMeshHarness({
      rules,
      worktreePath: null, // no worktree = skip scope check
      taskScope: [],
      llmOutput: 'All good\nDone',
      hasMetric: true,
      log: () => {},
    });
    assert.ok(result.pass, 'Should pass with clean output and metric');
    assert.strictEqual(result.violations.length, 0);
  });

  it('warns on metric-less completion', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const result = runMeshHarness({
      rules,
      worktreePath: null,
      taskScope: [],
      llmOutput: 'Done',
      hasMetric: false,
      log: () => {},
    });
    assert.ok(result.warnings.some(w => w.rule === 'build-before-done'),
      'Should warn about missing metric');
  });

  it('detects output block violations', () => {
    const rules = loadHarnessRules(
      path.join(__dirname, '..', 'config', 'harness-rules.json'),
      'mesh'
    );
    const result = runMeshHarness({
      rules,
      worktreePath: null,
      taskScope: [],
      llmOutput: 'Cleaning up...\nrm -rf /var/data\nDone',
      hasMetric: true,
      log: () => {},
    });
    assert.ok(!result.pass, 'Should fail on rm -rf');
    assert.ok(result.violations.some(v => v.rule === 'block-rm-rf'));
  });
});

// ── preCommitSecretScan ─────────────────────────

describe('preCommitSecretScan', () => {
  const fs = require('fs');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const { preCommitSecretScan } = require('../lib/mesh-harness');

  // A worker's edits are still unstaged when the harness runs (commitWorktree
  // stages them afterwards), so the scan must see unstaged and untracked files.
  function repoWith(files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-harness-scan-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'README.md'), 'clean\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return { dir, git };
  }

  it('blocks a secret in an untracked, unstaged file and leaves the index untouched', (t) => {
    // Assembled at runtime so this fixture is not itself a secret-shaped line in the diff.
    const { dir, git } = repoWith({ 'config.js': `const ${'pass' + 'word'} = "hunter2-not-real";\n` });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const result = preCommitSecretScan(dir);
    assert.strictEqual(result.blocked, true);
    assert.ok(result.findings.some(f => f.includes('password')));
    assert.strictEqual(git('diff', '--cached', '--name-only').toString(), '');
  });

  it('blocks an Anthropic-style key the regex fallback used to miss', (t) => {
    const key = 'sk-' + 'ant-api03-' + 'Ab1'.repeat(30);
    const { dir } = repoWith({ 'k.js': `const k = "${key}";\n` });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.strictEqual(preCommitSecretScan(dir).blocked, true);
  });

  it('passes a clean change', (t) => {
    const { dir } = repoWith({ 'notes.md': 'nothing sensitive here\n' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.strictEqual(preCommitSecretScan(dir).blocked, false);
  });

  // A stand-in gitleaks on PATH that logs its argv, prints `output` to stderr and exits `code`.
  function stubGitleaks(t, output, code) {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-harness-gitleaks-'));
    const log = path.join(bin, 'argv.log');
    fs.writeFileSync(path.join(bin, 'gitleaks'), `#!/bin/sh\necho "$*" >> '${log}'\necho '${output}' >&2\nexit ${code}\n`, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
    t.after(() => { process.env.PATH = prevPath; fs.rmSync(bin, { recursive: true, force: true }); });
    return () => fs.readFileSync(log, 'utf8').trim();
  }

  it('runs gitleaks protect --staged and blocks on the leaks it reports', (t) => {
    const argv = stubGitleaks(t, 'WRN leaks found: 1', 1);
    const { dir } = repoWith({ 'notes.md': 'nothing sensitive here\n' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const result = preCommitSecretScan(dir);
    assert.strictEqual(argv(), 'protect --staged --no-banner --redact');
    assert.strictEqual(result.blocked, true);
    assert.ok(result.findings.some(f => f.startsWith('gitleaks:')));
  });

  it('a gitleaks error does not block a clean change', (t) => {
    stubGitleaks(t, 'error: unknown flag', 1);
    const { dir } = repoWith({ 'notes.md': 'nothing sensitive here\n' });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    assert.strictEqual(preCommitSecretScan(dir).blocked, false);
  });

  it('the regex fallback still runs when gitleaks finds nothing', (t) => {
    stubGitleaks(t, 'INF no leaks found', 0);
    const { dir } = repoWith({ 'config.js': `const ${'pass' + 'word'} = "hunter2-not-real";\n` });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const result = preCommitSecretScan(dir);
    assert.strictEqual(result.blocked, true);
    assert.ok(result.findings.some(f => f.startsWith('regex:')));
  });
});

describe('enforceScopeCheck directory-style scope entries', () => {
  const fs = require('fs');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const { enforceScopeCheck, scopeEntryMatches } = require('../lib/mesh-harness');

  it('a trailing-slash or bare name covers the files under it; globs and exact files are unchanged', () => {
    assert.strictEqual(scopeEntryMatches('docs/', 'docs/x.md'), true);
    assert.strictEqual(scopeEntryMatches('src/lib/', 'src/lib/deep/a.ts'), true);
    assert.strictEqual(scopeEntryMatches('src', 'src/a.js'), true);
    assert.strictEqual(scopeEntryMatches('src', 'src'), true);
    assert.strictEqual(scopeEntryMatches('src', 'srcfoo.js'), false);
    assert.strictEqual(scopeEntryMatches('docs/', 'docs'), false);
    assert.strictEqual(scopeEntryMatches('src/*.js', 'src/a.js'), true);
    assert.strictEqual(scopeEntryMatches('src/*.js', 'src/lib/a.js'), false);
  });

  it('keeps work under docs/ and src, and reverts only what is outside', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-harness-scope-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'src/a.js'), 'v1\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');

    fs.writeFileSync(path.join(dir, 'src/a.js'), 'v2\n');
    fs.writeFileSync(path.join(dir, 'src/lib/b.js'), 'new\n');
    fs.writeFileSync(path.join(dir, 'docs/x.md'), 'doc\n');
    fs.writeFileSync(path.join(dir, 'srcfoo.js'), 'out\n');

    const result = enforceScopeCheck(dir, ['docs/', 'src']);
    assert.deepStrictEqual(result.violations, ['srcfoo.js']);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'src/a.js'), 'utf8'), 'v2\n');
    assert.ok(fs.existsSync(path.join(dir, 'src/lib/b.js')));
    assert.ok(fs.existsSync(path.join(dir, 'docs/x.md')));
    assert.ok(!fs.existsSync(path.join(dir, 'srcfoo.js')));
  });

  function scratchRepo(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-harness-names-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/aXb.js'), 'v1\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    return dir;
  }

  it('reverts a non-ASCII name and a glob-character name literally, sparing the in-scope edit the glob matches', (t) => {
    const dir = scratchRepo(t);
    fs.writeFileSync(path.join(dir, 'src/aXb.js'), 'edited\n');
    fs.writeFileSync(path.join(dir, 'café.txt'), 'out\n');
    fs.writeFileSync(path.join(dir, '*aXb.js'), 'out\n');

    const result = enforceScopeCheck(dir, ['src/']);
    assert.deepStrictEqual([...result.violations].sort(), ['*aXb.js', 'café.txt']);
    assert.deepStrictEqual([...result.reverted].sort(), ['*aXb.js', 'café.txt']);
    assert.ok(!fs.existsSync(path.join(dir, 'café.txt')));
    assert.ok(!fs.existsSync(path.join(dir, '*aXb.js')));
    assert.strictEqual(fs.readFileSync(path.join(dir, 'src/aXb.js'), 'utf8'), 'edited\n');
  });

  it('runMeshHarness scans an in-scope file with a non-ASCII name for forbidden patterns', (t) => {
    const dir = scratchRepo(t);
    fs.writeFileSync(path.join(dir, 'src/café.js'), 'console.log("debug")\n');
    const result = runMeshHarness({
      rules: [],
      worktreePath: dir,
      taskScope: ['src/'],
      llmOutput: '',
      hasMetric: true,
      log: () => {},
      role: { forbidden_patterns: [{ pattern: 'console\\.log', description: 'no console.log' }] },
    });
    assert.ok(result.violations.some(v => v.rule === 'forbidden:console\\.log' && v.file === 'src/café.js'));
  });
});

// ── postCommitValidate ──────────────────────────

describe('postCommitValidate (shipped git-conventional-commits rule)', () => {
  const fs = require('fs');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const { postCommitValidate } = require('../lib/mesh-harness');

  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'harness-rules.json'), 'utf8'));
  const command = rules.find(r => r.id === 'git-conventional-commits').mesh_validate_command;

  function repoWithSubject(subject) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-harness-postcommit-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    git('commit', '-q', '--allow-empty', '-m', subject);
    return dir;
  }

  for (const subject of ['mesh(T-1): work', 'fix(auth): correct token refresh', 'chore: bump deps']) {
    it(`passes "${subject}"`, (t) => {
      const dir = repoWithSubject(subject);
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const result = postCommitValidate(dir, command);
      assert.strictEqual(result.passed, true, result.output);
    });
  }

  it('fails a non-conventional subject', (t) => {
    const dir = repoWithSubject('bad message');
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const result = postCommitValidate(dir, command);
    assert.strictEqual(result.passed, false);
    assert.doesNotMatch(result.output, /blocked/);
  });
});

// ── runPreChecks (install-infra-packaging#23) ────
// no-assume-running declares a pre_check of nats; nothing used to run it.

describe('runPreChecks', () => {
  const shipped = () => loadHarnessRules(path.join(__dirname, '..', 'config', 'harness-rules.json'), 'mesh');
  const rule = (services) => [{ id: 'svc', mesh_enforcement: 'pre_check', mesh_pre_checks: services }];

  it('probes the services the shipped no-assume-running rule lists', async () => {
    const probed = [];
    const result = await runPreChecks({ rules: shipped(), probes: { nats: async () => { probed.push('nats'); } } });
    assert.deepStrictEqual(probed, ['nats']);
    assert.deepStrictEqual(result, { pass: true, failures: [] });
  });

  it('fails when a probe throws, naming the rule, service and reason', async () => {
    const result = await runPreChecks({ rules: shipped(), probes: { nats: async () => { throw new Error('connection closed'); } } });
    assert.strictEqual(result.pass, false);
    assert.deepStrictEqual(result.failures, [{ rule: 'no-assume-running', service: 'nats', reason: 'connection closed' }]);
  });

  it('fails a listed service that has no probe', async () => {
    const result = await runPreChecks({ rules: rule(['redis']), probes: {} });
    assert.deepStrictEqual(result.failures, [{ rule: 'svc', service: 'redis', reason: 'no probe for this service' }]);
  });

  it('fails a probe that never answers', async () => {
    const result = await runPreChecks({ rules: rule(['nats']), probes: { nats: () => new Promise(() => {}) }, timeoutMs: 20 });
    assert.deepStrictEqual(result.failures, [{ rule: 'svc', service: 'nats', reason: 'no answer within 20ms' }]);
  });

  it('passes when no rule declares a pre_check', async () => {
    assert.deepStrictEqual(await runPreChecks({ rules: [{ id: 'x', mesh_enforcement: 'scope_check' }] }), { pass: true, failures: [] });
  });
});
