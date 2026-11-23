import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// plan-lint derives its repo root from its own location, so its suite builds a
// disposable fake repo and copies the script under test into it.
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-protocol-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// What each tick provider's CLI prints on a run that answered, and on one that
// printed only metadata (init, usage, an empty result) and answered nothing.
const STREAMS = {
  claude: {
    answer: [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'm', tools: [] },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Step 1.1 waits on the operator.' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Step 1.1 waits on the operator.', usage: { input_tokens: 9, output_tokens: 7 }, total_cost_usd: 0.01 },
    ],
    empty: [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'm', tools: [] },
      { type: 'result', subtype: 'success', is_error: false, result: '', usage: { input_tokens: 9, output_tokens: 0 }, total_cost_usd: 0.001 },
    ],
  },
  codex: {
    answer: [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'Step 1.1 waits on the operator.' } },
      { type: 'turn.completed', usage: { input_tokens: 9, cached_input_tokens: 0, output_tokens: 7 } },
    ],
    empty: [
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: '**Reading the inventory**' } },
      { type: 'turn.completed', usage: { input_tokens: 9, cached_input_tokens: 0, output_tokens: 0 } },
    ],
  },
  gemini: {
    answer: [
      { type: 'init', session_id: 's1', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'user', content: 'tick' },
      { type: 'message', role: 'assistant', content: 'Step 1.1 waits ', delta: true },
      { type: 'message', role: 'assistant', content: 'on the operator.', delta: true },
      { type: 'result', status: 'success', stats: { total_tokens: 16 } },
    ],
    empty: [
      { type: 'init', session_id: 's1', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'user', content: 'tick' },
      { type: 'result', status: 'success', stats: { total_tokens: 9 } },
    ],
  },
};
const printStream = (records) => `cat <<'STREAM_EOF'\n${records.map((r) => JSON.stringify(r)).join('\n')}\nSTREAM_EOF`;

// plan-tick reads the agent's answer with REPO/lib/agent-stream.js and `node`.
// The link resolves to the real file, so its own requires load from this repo;
// node goes into the fake bin, because these PATHs deliberately leave out the
// directories a developer's real agent CLIs live in (often node's own bin).
function provisionAnswerCheck(root, bin) {
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(REPO, 'lib', 'agent-stream.js'), path.join(root, 'lib', 'agent-stream.js'));
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
}

function bash(script, { input } = {}) {
  return spawnSync('bash', [script], { input: input ?? '', encoding: 'utf8' });
}

describe('validate-push hook — force push is refused, not warned (review Phase 3)', () => {
  const hook = path.join(REPO, '.claude', 'hooks', 'validate-push.sh');
  const run = (command) => bash(hook, { input: JSON.stringify({ tool_input: { command } }) }).status;
  it('refuses --force wherever it sits in the command', () => {
    assert.equal(run('git push --force origin feature'), 2);
    assert.equal(run('git push origin main --force'), 2);
    assert.equal(run('git push origin feature --force-with-lease'), 2);
  });
  it('refuses the short flag and a + refspec', () => {
    assert.equal(run('git push -f origin feature'), 2);
    assert.equal(run('git push origin +main'), 2);
  });
  it('allows an ordinary push and ignores non-push commands', () => {
    assert.equal(run('git push -u origin feature'), 0);
    assert.equal(run('npm test'), 0);
  });
});

describe('git pre-push hook — non-fast-forward refused from any tool', () => {
  const hook = path.join(REPO, 'config', 'git-hooks', 'pre-push');
  const Z = '0'.repeat(40);
  let repo, A, B, C;
  before(() => {
    repo = path.join(tmp, 'push-repo');
    fs.mkdirSync(repo);
    const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd: repo, encoding: 'utf8' }).stdout.trim();
    git('init', '-q');
    const commit = (msg) => { git('commit', '-q', '--allow-empty', '-m', msg); return git('rev-parse', 'HEAD'); };
    A = commit('a');
    B = commit('b');
    git('checkout', '-q', A);
    C = commit('c');
  });
  const push = (line) => spawnSync('bash', [hook, 'origin', 'url'], { cwd: repo, input: `${line}\n`, encoding: 'utf8' });
  it('refuses a ref update that drops remote commits', () => {
    const r = push(`refs/heads/main ${C} refs/heads/main ${B}`);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /non-fast-forward/);
  });
  it('refuses when the remote tip is not in local history', () => {
    assert.equal(push(`refs/heads/main ${C} refs/heads/main ${'1'.repeat(40)}`).status, 1);
  });
  it('allows a fast-forward, a new ref and a deletion', () => {
    assert.equal(push(`refs/heads/main ${B} refs/heads/main ${A}`).status, 0);
    assert.equal(push(`refs/heads/new ${C} refs/heads/new ${Z}`).status, 0);
    assert.equal(push(`(delete) ${Z} refs/heads/old ${A}`).status, 0);
  });
});

describe('validate-commit hook — gitleaks judged by exit code, not its text', () => {
  const hook = path.join(REPO, '.claude', 'hooks', 'validate-commit.sh');
  // A real trufflehog on PATH would take the tool-error fallback instead of the regex scan.
  const hasTrufflehog = spawnSync('sh', ['-c', 'command -v trufflehog'], { encoding: 'utf8' }).status === 0;
  let bin, calls, n = 0;
  before(() => {
    bin = path.join(tmp, 'gl-bin');
    fs.mkdirSync(bin);
    calls = path.join(tmp, 'gl-calls');
    fs.writeFileSync(path.join(bin, 'gitleaks'),
      '#!/bin/sh\necho "$*" >> "$FAKE_GL_CALLS"\nprintf "%s\\n" "$FAKE_GL_OUT" >&2\nexit "$FAKE_GL_RC"\n', { mode: 0o755 });
  });
  function commit(files, { out, rc, command = 'git commit -m "fix: x"', pathFirst }) {
    const repo = path.join(tmp, `gl-repo-${n++}`);
    fs.mkdirSync(repo);
    spawnSync('git', ['init', '-q'], { cwd: repo });
    for (const [f, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
      fs.writeFileSync(path.join(repo, f), body);
    }
    spawnSync('git', ['add', ...Object.keys(files)], { cwd: repo });
    const PATH = [pathFirst, bin, process.env.PATH].filter(Boolean).join(':');
    const r = spawnSync('bash', [hook], {
      cwd: repo, encoding: 'utf8',
      input: JSON.stringify({ tool_input: { command } }),
      env: { ...process.env, PATH, FAKE_GL_OUT: out, FAKE_GL_RC: String(rc), FAKE_GL_CALLS: calls },
    });
    return { ...r, repo };
  }
  it('passes a clean scan even though its output reads "no leaks found"', () => {
    const r = commit({ 'a.txt': 'hello\n' }, { out: 'INF no leaks found', rc: 0 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  it('blocks when gitleaks exits 1', () => {
    const r = commit({ 'a.txt': 'hello\n' }, { out: 'WRN leaks found: 1', rc: 1 });
    assert.equal(r.status, 2, r.stdout + r.stderr);
  });
  it('treats any other exit as a tool error and falls back to the regex scan',
    { skip: hasTrufflehog && 'trufflehog on PATH replaces the regex fallback' }, () => {
      const usage = 'Error: unknown flag: --staged\n      --redact   redact secrets from logs';
      const clean = commit({ 'a.txt': 'hello\n' }, { out: usage, rc: 126 });
      assert.equal(clean.status, 0, clean.stdout + clean.stderr);
      const leak = commit({ 'b.txt': `${['api', 'key'].join('_')} = "abcdef"\n` }, { out: usage, rc: 126 });
      assert.equal(leak.status, 2, leak.stdout + leak.stderr);
      assert.match(leak.stdout, /Potential secrets detected/);
    });
  it('scans the staged changes with protect --staged', () => {
    commit({ 'a.txt': 'hello\n' }, { out: 'INF no leaks found', rc: 0 });
    assert.match(fs.readFileSync(calls, 'utf8'), /^protect --staged/m);
    assert.doesNotMatch(fs.readFileSync(calls, 'utf8'), /^detect/m);
  });
  // macOS grep has no -P: the message extraction failed silently and the format check never ran.
  it('checks the commit message format with a grep that has no -P', () => {
    const realGrep = spawnSync('sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout.trim();
    const bsd = path.join(tmp, 'bsd-grep-bin');
    fs.mkdirSync(bsd, { recursive: true });
    fs.writeFileSync(path.join(bsd, 'grep'),
      `#!/bin/sh\nfor a in "$@"; do case "$a" in -*P*) echo "grep: invalid option -- P" >&2; exit 2 ;; esac; done\nexec ${realGrep} "$@"\n`,
      { mode: 0o755 });
    const opts = { out: 'INF no leaks found', rc: 0, pathFirst: bsd };
    const WARN = /WARNING: Commit message doesn't follow conventional format/;
    const bad = commit({ 'a.txt': 'hello\n' }, { ...opts, command: 'git commit -m "bad message"' });
    assert.equal(bad.status, 0, bad.stdout + bad.stderr);
    assert.match(bad.stdout, WARN);
    const badSingle = commit({ 'a.txt': 'hello\n' }, { ...opts, command: "git commit -m 'bad message'" });
    assert.match(badSingle.stdout, WARN);
    for (const command of ["git commit -m 'fix: ok'", 'git commit -m "feat(x): ok"']) {
      const ok = commit({ 'a.txt': 'hello\n' }, { ...opts, command });
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.doesNotMatch(ok.stdout, WARN, command);
    }
  });
  // Each staged .json name was spliced into a node -e source string, so a crafted name ran
  // as JavaScript before the commit was blocked, and a name with a space was never checked.
  it('validates staged JSON without running its file name as code', () => {
    const clean = { out: 'INF no leaks found', rc: 0 };
    const evil = "x'+require('fs').writeFileSync('PWNED','')+'.json";
    const injected = commit({ [evil]: '{bad' }, clean);
    assert.equal(injected.status, 2, injected.stdout + injected.stderr);
    assert.match(injected.stdout, /Invalid JSON/);
    assert.equal(fs.existsSync(path.join(injected.repo, 'PWNED')), false, 'the file name ran as JavaScript');

    const spaced = commit({ 'a b.json': '{bad' }, clean);
    assert.equal(spaced.status, 2, spaced.stdout + spaced.stderr);
    assert.match(spaced.stdout, /Invalid JSON in a b\.json/);

    const valid = commit({ 'ok.json': '{"a":1}', 'sub/dir/n.json': '{}' }, clean);
    assert.equal(valid.status, 0, valid.stdout + valid.stderr);
    const nested = commit({ 'sub/dir/bad.json': '{bad' }, clean);
    assert.equal(nested.status, 2, nested.stdout + nested.stderr);
    assert.match(nested.stdout, /Invalid JSON in sub\/dir\/bad\.json/);
  });
});

describe('plan-lint — [D] deferred state and drift checks', () => {
  let root, lint;
  const CANON_DOCS = ['MASTER_PLAN.md', 'PROTOCOL.md', 'FRAMEWORK_CANONICAL.md', 'COWORK_MODEL.md', 'BLOCK_TEMPLATE.md'];

  function silo(id, { inventory, audits = true, clone = false, shim: withShim = true }) {
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(clone ? plan : path.join(plan, 'tick-logs'), { recursive: true });
    if (audits) fs.mkdirSync(path.join(plan, 'audits'), { recursive: true });
    for (const d of CANON_DOCS) fs.copyFileSync(path.join(root, 'memory-plan', 'canonical', d), path.join(plan, d));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), inventory);
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.1\n');
    fs.writeFileSync(path.join(plan, 'DECISIONS.md'), '## D1 — exists (2026-07-04)\n');
    fs.writeFileSync(path.join(plan, 'COMPONENT_REGISTRY.md'), '## Family 1: x\n| **Status** | ok |\n');
    fs.writeFileSync(path.join(plan, 'ROADMAP.md'), '# roadmap\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    const shim = path.join(root, 'workspace-bin', `${id}-tick.sh`);
    if (withShim) {
      fs.writeFileSync(shim, '#!/bin/bash\ntrue\n');
      fs.chmodSync(shim, 0o755);
    }
    // A fresh clone carries neither: both are gitignored.
    if (!clone) fs.writeFileSync(path.join(plan, 'automation.json'),
      JSON.stringify({ plist_label: `ai.openclaw.${id}-tick`, tick_command: shim }));
    return plan;
  }

  before(() => {
    root = path.join(tmp, 'lintrepo');
    fs.mkdirSync(path.join(root, 'workspace-bin'), { recursive: true });
    fs.mkdirSync(path.join(root, 'memory-plan', 'canonical'), { recursive: true });
    for (const d of CANON_DOCS) fs.writeFileSync(path.join(root, 'memory-plan', 'canonical', d), `# ${d}\n`);
    lint = path.join(root, 'workspace-bin', 'plan-lint.sh');
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-lint.sh'), lint);
    fs.chmodSync(lint, 0o755);
  });

  const ROW = (step, st, desc) => `| 1 | ${step} | v${step} | [${st}] | ${desc} |`;
  const CONTRACT = (step) =>
    `> **${step} — Goal:** g.\n> **Needs:** n.\n> **Feeds:** f.\n> **Verify:** code: v.\n`;

  it('[D] rows do not FAIL contract-less; open rows do', () => {
    const inv = `# INV\n\n${ROW('1.1', 'x', 'done')}\n${ROW('1.2', 'D', 'deferred')}\n\n${CONTRACT('1.1')}`;
    silo('tdefer', { inventory: inv });
    const r = spawnSync('bash', [lint, 'tdefer'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /CONFORMANT/);

    const inv2 = `# INV\n\n${ROW('1.1', ' ', 'open no contract')}\n`;
    silo('topen', { inventory: inv2 });
    const r2 = spawnSync('bash', [lint, 'topen'], { encoding: 'utf8' });
    assert.equal(r2.status, 1);
    assert.match(r2.stdout, /open row\(s\) without the §11 contract/);
  });

  it('whitespace-variant rows still parse (unified row contract)', () => {
    const inv = `# INV\n\n|  1  |  1.1  |  v1.1  |  [x]  |  spaced row  |\n\n${CONTRACT('1.1')}`;
    silo('tspace', { inventory: inv });
    const r = spawnSync('bash', [lint, 'tspace'], { encoding: 'utf8' });
    assert.match(r.stdout, /1 row\(s\) in the load-bearing format/);
  });

  it('a silo without audits/ lints to the summary line; closed steps WARN on the missing dir', () => {
    const inv = `# INV\n\n${ROW('1.1', ' ', 'open')}\n\n${CONTRACT('1.1')}`;
    silo('tnoaudits', { inventory: inv, audits: false });
    const r = spawnSync('bash', [lint, 'tnoaudits'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[PASS\] steps +audit coverage: 0 PRE \/ 0 POST for 0 closed step\(s\)/);
    assert.match(r.stdout, /^summary: .* → CONFORMANT$/m);

    const inv2 = `# INV\n\n${ROW('1.1', 'x', 'done')}\n\n${CONTRACT('1.1')}`;
    silo('tnoaudits-closed', { inventory: inv2, audits: false });
    const r2 = spawnSync('bash', [lint, 'tnoaudits-closed'], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /\[WARN\] steps +audit coverage: no audits\/ dir for 1 closed step\(s\)/);
    assert.match(r2.stdout, /^summary: .* → CONFORMANT$/m);
  });

  it('a fresh clone (no automation.json, no tick-logs/) is CONFORMANT on derived defaults', () => {
    const inv = `# INV\n\n${ROW('1.1', ' ', 'open')}\n\n${CONTRACT('1.1')}`;
    silo('tclone', { inventory: inv, clone: true });
    const r = spawnSync('bash', [lint, 'tclone'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[PASS\] automation +no automation\.json — derived defaults \(tick_command workspace-bin\/tclone-tick\.sh\)/);
    assert.match(r.stdout, /\[WARN\] history +tick-logs\/ missing/);
    assert.match(r.stdout, /^summary: .* → CONFORMANT$/m);

    silo('tclone-noshim', { inventory: inv, clone: true, shim: false });
    const r2 = spawnSync('bash', [lint, 'tclone-noshim'], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /\[WARN\] automation +no automation\.json and no derived tick shim/);
  });

});

describe('plan-lint — the history surface grades the commit that closed VERSION', () => {
  const GIT = 'git -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null';
  const CANON_DOCS = ['MASTER_PLAN.md', 'PROTOCOL.md', 'FRAMEWORK_CANONICAL.md', 'COWORK_MODEL.md', 'BLOCK_TEMPLATE.md'];
  const ROW = (step, st) => `| 1 | ${step} | v${step} | [${st}] | step ${step} |`;
  const CONTRACT = (step) =>
    `> **${step} — Goal:** g.\n> **Needs:** n.\n> **Feeds:** f.\n> **Verify:** code: v.\n`;
  let n = 0;

  const sh = (cwd, cmd) => {
    const r = spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `${cmd}\n${r.stderr}`);
  };
  // Run from outside the repo, so plan-lint must find its git files from $REPO alone.
  const lint = (root, id) => spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-lint.sh'), id],
    { cwd: os.tmpdir(), encoding: 'utf8' });

  function gitSilo(id, { version, inventory }) {
    const root = path.join(tmp, `histrepo${++n}`);
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(path.join(plan, 'tick-logs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'memory-plan', 'canonical'));
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    for (const d of CANON_DOCS) {
      fs.writeFileSync(path.join(root, 'memory-plan', 'canonical', d), `# ${d}\n`);
      fs.writeFileSync(path.join(plan, d), `# ${d}\n`);
    }
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-lint.sh'), path.join(root, 'workspace-bin', 'plan-lint.sh'));
    fs.writeFileSync(path.join(root, 'workspace-bin', `${id}-tick.sh`), '#!/bin/bash\ntrue\n', { mode: 0o755 });
    fs.writeFileSync(path.join(plan, 'tick-logs', '.gitkeep'), '');
    fs.writeFileSync(path.join(plan, 'VERSION'), `${version}\n`);
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), inventory);
    fs.writeFileSync(path.join(plan, 'DECISIONS.md'), '## D1 — exists (2026-07-04)\n');
    fs.writeFileSync(path.join(plan, 'COMPONENT_REGISTRY.md'), '## Family 1: x\n| **Status** | ok |\n');
    fs.writeFileSync(path.join(plan, 'ROADMAP.md'), '# roadmap\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    sh(root, 'git init -q .');
    return { root, plan };
  }
  const CLOSED_V11 = `# INV\n\n${ROW('1.1', 'x')}\n${ROW('1.2', ' ')}\n\n${CONTRACT('1.1')}${CONTRACT('1.2')}`;

  it('a shallow clone warns on a graft it cannot grade instead of blaming it for the close', () => {
    const src = gitSilo('tsh', { version: 'v1.1', inventory: CLOSED_V11 });
    sh(src.root, `git add -A && ${GIT} commit -q -m $'v1.1 close\\n\\nRuntime-Evidence: observed'`);
    sh(src.root, `echo later > later.txt && git add later.txt && ${GIT} commit -q -m later`);
    const clone = path.join(tmp, `histclone${n}`);
    sh(tmp, `git clone -q --depth 1 file://${src.root} ${clone}`);

    const r = lint(clone, 'tsh');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[WARN\] history +VERSION's closing commit is outside this shallow clone \(graft [0-9a-f]{7}\)/);
    assert.doesNotMatch(r.stdout, /\[FAIL\]/);
    assert.match(r.stdout, /^summary: .* → CONFORMANT$/m);

    const full = lint(src.root, 'tsh');
    assert.equal(full.status, 0, full.stdout + full.stderr);
    assert.match(full.stdout, /\[PASS\] history +closing commit [0-9a-f]{7} carries a Runtime-Evidence: trailer/);
  });

  it('a full clone still FAILs a close without the trailer, whatever later commits carry', () => {
    const src = gitSilo('tnotrailer', { version: 'v1.1', inventory: CLOSED_V11 });
    sh(src.root, `git add -A && ${GIT} commit -q -m 'v1.1 close'`);
    sh(src.root, `${GIT} commit -q --allow-empty -m $'later\\n\\nRuntime-Evidence: unrelated'`);
    const r = lint(src.root, 'tnotrailer');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /\[FAIL\] history +VERSION \(v1\.1\) was closed by [0-9a-f]{7} with no Runtime-Evidence: trailer/);
  });

  it('the committed v0.0 scaffold carrier closes nothing; a later close without the trailer still FAILs', () => {
    const src = gitSilo('tv0', { version: 'v0.0', inventory: `# INV\n\n${ROW('1.1', ' ')}\n\n${CONTRACT('1.1')}` });
    sh(src.root, `git add -A && ${GIT} commit -q -m 'scaffold plan tv0'`);
    const r = lint(src.root, 'tv0');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /was closed by/);
    assert.match(r.stdout, /^summary: .* → CONFORMANT$/m);

    fs.writeFileSync(path.join(src.plan, 'VERSION'), 'v1.1\n');
    sh(src.root, `${GIT} commit -qam 'v1.1 close'`);
    const r2 = lint(src.root, 'tv0');
    assert.equal(r2.status, 1, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /\[FAIL\] history +VERSION \(v1\.1\) was closed by [0-9a-f]{7} with no Runtime-Evidence: trailer/);
  });
});

describe('plan-tick conformance gate — fails closed when plan-lint never reaches its verdict', () => {
  const ID = 'tgate';
  let root, plan, env, claudeLog;

  function lintStub(body) {
    const p = path.join(root, 'workspace-bin', 'plan-lint.sh');
    fs.writeFileSync(p, `#!/bin/bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  }
  const tick = (...args) =>
    spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-tick.sh'), ID, ...args], { encoding: 'utf8', env });
  const blocked = () => fs.existsSync(path.join(plan, 'BLOCKED.md'));
  const block = () => fs.readFileSync(path.join(plan, 'BLOCKED.md'), 'utf8');
  const claudeRan = () => fs.existsSync(claudeLog);

  before(() => {
    root = path.join(tmp, 'tickrepo');
    plan = path.join(root, 'memory-plan', 'plans', ID);
    fs.mkdirSync(plan, { recursive: true });
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), path.join(root, 'workspace-bin', 'plan-tick.sh'));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '| 1 | 1.1 | v1.1 | [ ] | open step |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);

    const bin = path.join(tmp, 'tickbin');
    fs.mkdirSync(bin);
    claudeLog = path.join(tmp, 'claude-invocations');
    // Answers like a real agent run: one that answers nothing and changes nothing is a failed run.
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\ncat >/dev/null\necho "$*" >> '${claudeLog}'\n${printStream(STREAMS.claude.answer)}\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    provisionAnswerCheck(root, bin);
    const home = path.join(tmp, 'tickhome');
    fs.mkdirSync(home);
    // Not process.env: the close gate runs this suite inside a real tick, whose
    // WORKPLAN_AUTOPAUSE=1 + WORKPLAN_PLIST_LABEL would let a blocked test tick
    // launchctl-disable the live chain; DRY_RUN or WORKPLAN_LINT_GATE=0 would skip the gate.
    env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp };
  });

  beforeEach(() => {
    fs.rmSync(path.join(plan, 'BLOCKED.md'), { force: true });
    fs.rmSync(claudeLog, { force: true });
  });

  it('a lint that exits 1 before its summary line blocks the tick; claude never runs', () => {
    lintStub([
      'echo "plan-lint: tgate"',
      'echo "  [PASS] master-plan  DECISIONS.md has entries"',
      'echo "  [PASS] steps        INVENTORY.md: 1 row(s) in the load-bearing format"',
      'exit 1',
    ].join('\n'));
    const r = tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(claudeRan(), false, 'claude was invoked on a silo plan-lint never finished grading');
    assert.match(r.stdout, /skip: plan-lint did not finish \(exit 1, no verdict\)/);
    const b = block();
    assert.match(b, /^\*\*Trigger\*\*: plan-lint did not finish \(exit 1, no verdict\)/m);
    assert.match(b, /\[PASS\] steps +INVENTORY\.md: 1 row\(s\)/, 'the raw partial output rides in the block');
    assert.match(b, /^\*\*External action:\*\* .*stops before its `summary:` line/m);
    assert.doesNotMatch(b, /NONCONFORMANT|FAIL/, 'the block claims FAILs the lint never reported');
  });

  it('an exit code outside 0/1 blocks even after a summary line', () => {
    lintStub('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\nexit 2');
    tick();
    assert.equal(claudeRan(), false);
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 2, no verdict\)/m);
  });

  it('a CONFORMANT summary opens the gate only as the last line of an exit-0 run', () => {
    lintStub('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\nexit 1');
    tick();
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 1, no verdict\)/m);

    fs.rmSync(path.join(plan, 'BLOCKED.md'));
    lintStub('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\necho "plan-lint: output after the verdict"');
    tick();
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 0, no verdict\)/m);
    assert.equal(claudeRan(), false);
  });

  it('a plan-lint that cannot run blocks the tick too', () => {
    fs.rmSync(path.join(root, 'workspace-bin', 'plan-lint.sh'));
    tick();
    assert.equal(claudeRan(), false);
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint did not finish \(exit 127, no verdict\)/m);
  });

  it('a NONCONFORMANT verdict still blocks as FAILs', () => {
    lintStub('echo "  [FAIL] history      tick-logs/ missing"\necho "summary: 0 PASS · 0 WARN · 1 FAIL → NONCONFORMANT"\nexit 1');
    tick();
    assert.equal(claudeRan(), false);
    assert.match(block(), /^\*\*Trigger\*\*: plan-lint NONCONFORMANT — the tick refused to drive a silo with FAILs$/m);
  });

  it('a CONFORMANT summary lets the tick through to claude', () => {
    lintStub('echo "  [PASS] block        no BLOCKED.md — chain runnable"\necho "summary: 1 PASS · 0 WARN · 0 FAIL → CONFORMANT"');
    const r = tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(blocked(), false, blocked() ? block() : '');
    assert.equal(claudeRan(), true, r.stdout + r.stderr);
  });

  it('--preflight names an unfinished lint instead of logging an empty line', () => {
    lintStub('exit 1');
    const r = tick('--preflight');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /\[tgate\] conformance: tgate plan-lint did not finish \(exit 1, no verdict\)$/m);
    assert.doesNotMatch(r.stdout, /\[tgate\] $/m);

    lintStub('echo "conformance: tgate 9P/0W/0F → CONFORMANT"');
    assert.match(tick('--preflight').stdout, /\[tgate\] conformance: tgate 9P\/0W\/0F → CONFORMANT$/m);
  });
});

describe('plan-tick close gate — the commit that closed VERSION must carry the trailer', () => {
  const ID = 'tclose';
  const GIT = 'git -c user.name=t -c user.email=t@t';
  let n = 0;

  function closeTick(claudeBody, extraEnv = {}) {
    const root = path.join(tmp, `closerepo${++n}`);
    const plan = path.join(root, 'memory-plan', 'plans', ID);
    fs.mkdirSync(plan, { recursive: true });
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), path.join(root, 'workspace-bin', 'plan-tick.sh'));
    fs.writeFileSync(path.join(root, 'workspace-bin', 'plan-lint.sh'),
      '#!/bin/bash\necho "summary: 1 PASS · 0 WARN · 0 FAIL → CONFORMANT"\n');
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '| 1 | 1.1 | v1.1 | [ ] | open step |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    const sh = (cmd) => assert.equal(spawnSync('bash', ['-c', cmd], { cwd: root }).status, 0, cmd);
    sh('git init -q .');
    sh(`git add -A && ${GIT} commit -q -m $'seed\\n\\nRuntime-Evidence: seed'`);

    const bin = path.join(tmp, `closebin${n}`);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\ncat >/dev/null\n${claudeBody}\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    const home = path.join(tmp, `closehome${n}`);
    fs.mkdirSync(home);
    // Not process.env: this suite runs inside a real tick's close gate, and
    // WORKPLAN_CLOSE_CHECK=none keeps the stub tick from running the suite again.
    const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, WORKPLAN_CLOSE_CHECK: 'none', ...extraEnv };
    const r = spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-tick.sh'), ID], { encoding: 'utf8', env });
    const blockPath = path.join(plan, 'BLOCKED.md');
    const digestPath = path.join(home, '.openclaw', 'workspace', 'memory', `${ID}-progress.md`);
    return { r, block: fs.existsSync(blockPath) ? fs.readFileSync(blockPath, 'utf8') : null,
      digest: fs.existsSync(digestPath) ? fs.readFileSync(digestPath, 'utf8') : '' };
  }

  it('refuses a close whose VERSION bump was never committed', () => {
    const { r, block } = closeTick(`printf 'v1.1\\n' > memory-plan/plans/${ID}/VERSION`);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(block, 'no BLOCKED.md for an uncommitted close');
    assert.match(block, /VERSION v1\.1 is not committed/);
  });

  it('checks the commit that closed VERSION, not a later commit at HEAD', () => {
    const { r, block } = closeTick([
      `printf 'v1.1\\n' > memory-plan/plans/${ID}/VERSION`,
      `${GIT} commit -qam 'v1.1 close'`,
      `${GIT} commit -q --allow-empty -m $'later\\n\\nRuntime-Evidence: unrelated'`,
    ].join('\n'));
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(block, 'no BLOCKED.md for a close without a trailer');
    assert.match(block, /closing commit \([0-9a-f]{7}\) carries no Runtime-Evidence: trailer/);
    assert.doesNotMatch(block, /is not committed/);
  });

  it('accepts a committed close that carries the trailer', () => {
    const { r, block } = closeTick([
      `printf 'v1.1\\n' > memory-plan/plans/${ID}/VERSION`,
      `${GIT} commit -qam $'v1.1 close\\n\\nRuntime-Evidence: observed'`,
    ].join('\n'));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(block, null, block ?? '');
  });

  describe('a closing run that also wrote BLOCKED.md', () => {
    const AGENT_BLOCK = '# CONTINUATION_BLOCKED\n\n**Trigger**: macro re-orient\n';
    const closeAndBlock = [
      `printf 'v1.1\\n' > memory-plan/plans/${ID}/VERSION`,
      `${GIT} commit -qam $'v1.1 close\\n\\nRuntime-Evidence: observed'`,
      `printf '# CONTINUATION_BLOCKED\\n\\n**Trigger**: macro re-orient\\n' > memory-plan/plans/${ID}/BLOCKED.md`,
    ].join('\n');

    it('still runs the close check, and a red one is appended to the agent block', () => {
      const { r, block, digest } = closeTick(closeAndBlock, { WORKPLAN_CLOSE_CHECK: 'false' });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.ok(block.startsWith(AGENT_BLOCK), block);
      assert.match(block, /## Close gate refused/);
      assert.match(block, /close check 'false' failed/);
      assert.match(digest, /CLOSE REFUSED at `v1\.1`/);
    });

    it('leaves the agent block as written when the close check is green', () => {
      const { r, block, digest } = closeTick(closeAndBlock, { WORKPLAN_CLOSE_CHECK: 'true' });
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(block, AGENT_BLOCK);
      assert.match(digest, /BLOCKED at `v1\.1` — macro re-orient/);
      assert.doesNotMatch(digest, /CLOSE REFUSED/);
    });
  });
});

describe('plan-tick shares one repo lock and blames only its own silo for dirt', () => {
  const GIT = 'git -c user.name=t -c user.email=t@t';
  let n = 0;

  function repo(id, { agentExtra = '', env: extra = {} } = {}) {
    const root = path.join(tmp, `lockrepo${++n}`);
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(plan, { recursive: true });
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    fs.mkdirSync(path.join(root, 'lib'));
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), path.join(root, 'workspace-bin', 'plan-tick.sh'));
    fs.writeFileSync(path.join(root, 'workspace-bin', 'plan-lint.sh'),
      '#!/bin/bash\necho "summary: 1 PASS · 0 WARN · 0 FAIL → CONFORMANT"\n');
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '| 1 | 1.1 | v1.1 | [ ] | open step |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    fs.writeFileSync(path.join(root, 'lib', 'code.js'), 'one\n');
    const sh = (cmd) => assert.equal(spawnSync('bash', ['-c', cmd], { cwd: root }).status, 0, cmd);
    const bin = path.join(tmp, `lockbin${n}`);
    fs.mkdirSync(bin);
    provisionAnswerCheck(root, bin);
    sh(`git init -q . && git add -A && ${GIT} commit -q -m seed`);
    const seen = path.join(tmp, `lockseen${n}`);
    fs.writeFileSync(path.join(bin, 'claude'),
      `#!/bin/bash\ncat >/dev/null\ncat memory-plan/.tick.lock/plan > '${seen}'\n${agentExtra}\n${printStream(STREAMS.claude.answer)}\n`);
    fs.chmodSync(path.join(bin, 'claude'), 0o755);
    const home = path.join(tmp, `lockhome${n}`);
    fs.mkdirSync(home);
    const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, TMPDIR: tmp, WORKPLAN_CLOSE_CHECK: 'none', ...extra };
    const tick = () => spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-tick.sh'), id], { encoding: 'utf8', env });
    return { root, plan, seen, tick, blockPath: path.join(plan, 'BLOCKED.md') };
  }

  it('tracked edits outside the silo skip the tick without writing BLOCKED.md', () => {
    const f = repo('pdirt');
    fs.writeFileSync(path.join(f.root, 'lib', 'code.js'), 'operator edit\n');
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /skip: tracked changes outside memory-plan\/plans\/pdirt\//);
    assert.equal(fs.existsSync(f.blockPath), false, 'a plan was blocked for dirt it never touched');
    assert.equal(fs.existsSync(f.seen), false, 'claude ran on a dirty tree');
  });

  // A chain waiting on someone else's dirt re-polls every throttle gap and re-logged the list each time.
  it('a waiting chain lists the outside dirt once, then only when it changes', () => {
    const f = repo('pquiet');
    const listed = /^ {8} M lib\/code\.js$/m;
    fs.writeFileSync(path.join(f.root, 'lib', 'code.js'), 'operator edit\n');
    const first = f.tick();
    const second = f.tick();
    assert.match(first.stdout, listed);
    assert.match(second.stdout, /skip: tracked changes outside memory-plan\/plans\/pquiet\//);
    assert.doesNotMatch(second.stdout, listed);
    fs.appendFileSync(path.join(f.root, 'workspace-bin', 'plan-lint.sh'), '# operator edit\n');
    assert.match(f.tick().stdout, /^ {8} M workspace-bin\/plan-lint\.sh$/m);
  });

  it('a tick keeps the newest 200 tick-log pairs plus the live one, and caps the launchd logs', () => {
    const f = repo('pprune');
    const logs = path.join(f.plan, 'tick-logs');
    fs.mkdirSync(logs);
    const name = (i) => `20260101-${String(i).padStart(6, '0')}`;
    for (let i = 0; i < 205; i++) {
      fs.writeFileSync(path.join(logs, `${name(i)}.log`), 'log\n');
      fs.writeFileSync(path.join(logs, `${name(i)}.jsonl`), '{}\n');
    }
    fs.symlinkSync(`${name(0)}.log`, path.join(logs, 'current.log'));
    fs.writeFileSync(path.join(logs, 'launchd.stdout.log'), Buffer.alloc(11 * 1024 * 1024, 'x'));
    fs.writeFileSync(path.join(logs, 'launchd.stderr.log'), 'small\n');
    fs.writeFileSync(f.blockPath, '# CONTINUATION_BLOCKED\n');
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const left = (ext) => fs.readdirSync(logs).filter((e) => e.endsWith(ext) && e.startsWith('2026')).sort();
    const expected = [0, ...Array.from({ length: 200 }, (_, i) => i + 5)].map(name);
    assert.deepEqual(left('.log'), expected.map((n) => `${n}.log`));
    assert.deepEqual(left('.jsonl'), expected.map((n) => `${n}.jsonl`));
    assert.equal(fs.statSync(path.join(logs, 'launchd.stdout.log')).size, 0);
    assert.equal(fs.readFileSync(path.join(logs, 'launchd.stderr.log'), 'utf8'), 'small\n');
  });

  it('tracked edits inside the silo on a clean VERSION still write the stall block', () => {
    const f = repo('pown');
    fs.appendFileSync(path.join(f.plan, 'INVENTORY.md'), '| 2 | 1.2 | v1.2 | [ ] | half-done |\n');
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(f.blockPath, 'utf8'), /silent stall — tree dirty on clean VERSION=v1\.0/);
  });

  it("another plan's live tick holds the lock for every plan", () => {
    const f = repo('pwait');
    fs.mkdirSync(path.join(f.root, 'memory-plan', '.tick.lock'));
    fs.writeFileSync(path.join(f.root, 'memory-plan', '.tick.lock', 'plan'), 'other\n');
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /skip: another tick is already running \(other, lock age=/);
    assert.equal(fs.existsSync(f.seen), false, 'two plans ticked at once in one working tree');
  });

  it('a tick names itself in the repo lock and releases it on exit', () => {
    const f = repo('pruns');
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(f.seen, 'utf8'), 'pruns\n');
    assert.equal(fs.existsSync(path.join(f.root, 'memory-plan', '.tick.lock')), false);
  });

  const close = (id) => `printf 'v1.1\\n' > memory-plan/plans/${id}/VERSION\n${GIT} commit -qam $'v1.1\\n\\nRuntime-Evidence: observed'`;

  it("a tick whose lock was reaped does not delete the new holder's lock", () => {
    // The close check runs at the repo root: it stands in for another plan's tick
    // that reaped this one's lock as stale and took it.
    const f = repo('preaped', { agentExtra: close('preaped'), env: {
      WORKPLAN_CLOSE_CHECK: 'rm -rf memory-plan/.tick.lock && mkdir memory-plan/.tick.lock && echo other > memory-plan/.tick.lock/plan' } });
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(path.join(f.root, 'memory-plan', '.tick.lock', 'plan'), 'utf8'), 'other\n');
  });

  it('the close gate starts with a fresh lock window', () => {
    const f = repo('pfresh', { agentExtra: `${close('pfresh')}\ntouch -t 200001010000 memory-plan/.tick.lock`, env: {
      WORKPLAN_CLOSE_CHECK: '[ $(( $(date +%s) - $(stat -c %Y memory-plan/.tick.lock 2>/dev/null || stat -f %m memory-plan/.tick.lock) )) -lt 3600 ]' } });
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(f.blockPath), false);
  });
});

describe('plan-tick counts failed agent runs and blocks after WORKPLAN_FAIL_LIMIT in a row', () => {
  const GIT = 'git -c user.name=t -c user.email=t@t';
  let n = 0;

  function repo(id, { agent, provider = 'claude', version = 'v1.0', env: extra = {} } = {}) {
    const root = path.join(tmp, `failrepo${++n}`);
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(plan, { recursive: true });
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), path.join(root, 'workspace-bin', 'plan-tick.sh'));
    fs.writeFileSync(path.join(root, 'workspace-bin', 'plan-lint.sh'),
      '#!/bin/bash\necho "summary: 1 PASS · 0 WARN · 0 FAIL → CONFORMANT"\n');
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '| 1 | 1.1 | v1.1 | [ ] | open step |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), `${version}\n`);
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'memory-plan/plans/*/tick-logs/\n');
    const sh = (cmd) => assert.equal(spawnSync('bash', ['-c', cmd], { cwd: root }).status, 0, cmd);
    const bin = path.join(tmp, `failbin${n}`);
    fs.mkdirSync(bin);
    provisionAnswerCheck(root, bin);
    sh(`git init -q . && git add -A && ${GIT} commit -q -m seed`);
    const setAgent = (body) => {
      fs.writeFileSync(path.join(bin, provider), `#!/bin/bash\ncat >/dev/null\n${body}\n`);
      fs.chmodSync(path.join(bin, provider), 0o755);
    };
    // A fake launchctl: an auto-pause must be observable, and must never reach a live chain.
    const launchctlLog = path.join(tmp, `launchctl${n}.log`);
    fs.writeFileSync(path.join(bin, 'launchctl'), `#!/bin/bash\necho "$*" >> '${launchctlLog}'\n`);
    fs.chmodSync(path.join(bin, 'launchctl'), 0o755);
    if (agent !== undefined) setAgent(agent);
    const home = path.join(tmp, `failhome${n}`);
    fs.mkdirSync(home);
    // Without a fake agent, PATH must not reach a real agent CLI installed on this machine.
    const basePath = process.env.PATH.split(path.delimiter)
      .filter((d) => d && !['claude', 'codex', 'gemini'].some((a) => fs.existsSync(path.join(d, a)))).join(path.delimiter);
    const env = { PATH: `${bin}${path.delimiter}${basePath}`, HOME: home, TMPDIR: tmp, WORKPLAN_CLOSE_CHECK: 'none',
      WORKPLAN_AGENT_PROVIDER: provider, ...extra };
    const tick = () => spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-tick.sh'), id], { encoding: 'utf8', env, timeout: 60_000 });
    const blockPath = path.join(plan, 'BLOCKED.md');
    const failFile = path.join(plan, 'tick-logs', '.agent-failures');
    return {
      root, plan, tick, setAgent, sh, bin,
      launchctl: () => (fs.existsSync(launchctlLog) ? fs.readFileSync(launchctlLog, 'utf8') : ''),
      block: () => (fs.existsSync(blockPath) ? fs.readFileSync(blockPath, 'utf8') : null),
      fails: () => (fs.existsSync(failFile) ? fs.readFileSync(failFile, 'utf8').trim() : null),
      seedFails: (k) => { fs.mkdirSync(path.dirname(failFile), { recursive: true }); fs.writeFileSync(failFile, `${k}\n`); },
    };
  }

  it('an agent that exits 1 fails the tick with exit 1, then blocks and exits 2 on the third in a row', () => {
    const f = repo('fexit', { agent: 'echo "auth expired" >&2\nexit 1' });
    for (const k of [1, 2]) {
      const r = f.tick();
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`agent run failed \\(${k}/3 in a row\\): claude exited rc=1`));
      assert.equal(f.fails(), String(k));
      assert.equal(f.block(), null, 'blocked below the limit');
    }
    const r = f.tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const b = f.block();
    assert.match(b, /^\*\*Trigger\*\*: agent CLI claude failed 3 runs in a row — last: exited rc=1$/m);
    assert.match(b, /^- Last exit code: 1$/m);
    assert.match(b, /^- Last log: .*\/tick-logs\/\d{8}-\d{6}\.log$/m);
    assert.match(b, /^\*\*External action:\*\* sign the agent CLI `claude` in again .*quota.*, then delete this file to resume\.$/m);
    assert.equal(f.fails(), null, 'the counter outlived the block it produced');
    const again = f.tick();
    assert.equal(again.status, 0, 'a blocked plan must short-circuit, not count');
    assert.match(again.stdout, /skip: .*BLOCKED\.md present/);
  });

  it('WORKPLAN_FAIL_LIMIT sets N, and a good run resets the count', () => {
    const f = repo('freset', { agent: 'exit 3', env: { WORKPLAN_FAIL_LIMIT: '2' } });
    assert.equal(f.tick().status, 1);
    assert.equal(f.fails(), '1');
    f.setAgent(printStream(STREAMS.claude.answer));
    const ok = f.tick();
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(f.fails(), null, 'a good run did not reset the count');
    f.setAgent('exit 3');
    assert.equal(f.tick().status, 1);
    const r = f.tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(f.block(), /failed 2 runs in a row — last: exited rc=3/);
  });

  it('an agent that prints nothing and changes nothing is a failed run', () => {
    const f = repo('fsilent', { agent: 'exit 0', env: { WORKPLAN_FAIL_LIMIT: '1' } });
    const r = f.tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(f.block(), /last: exited 0 without an answer \(no JSON records\) and changed nothing/);
    assert.match(f.block(), /gave no answer and changed nothing: read its stream \(.*\/tick-logs\/\d{8}-\d{6}\.jsonl\)/);
  });

  it('a silent exit-0 run that committed work is not a failure', () => {
    const f = repo('fcommit', { agent: `${GIT} commit -q --allow-empty -m work` });
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.fails(), null);
  });

  it('a hung agent is stopped at the wall-clock limit with its whole process group (rc=124)', () => {
    const pidFile = path.join(tmp, 'hung-child.pid');
    const f = repo('fhang', {
      agent: `sleep 300 &\necho $! > '${pidFile}'\necho working\nwait`,
      env: { WORKPLAN_TICK_TIMEOUT: '2', WORKPLAN_FAIL_LIMIT: '1' },
    });
    const t0 = Date.now();
    const r = f.tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(Date.now() - t0 < 30_000, 'the limit did not stop the run');
    assert.match(r.stdout, /\] claude exited rc=124 after /);
    assert.match(f.block(), /last: ran past the 2s wall-clock limit and was stopped \(rc=124\)/);
    const child = fs.readFileSync(pidFile, 'utf8').trim();
    const st = spawnSync('ps', ['-o', 'stat=', '-p', child], { encoding: 'utf8' }).stdout.trim();
    assert.ok(st === '' || st.startsWith('Z'), `the agent's child ${child} outlived the timeout (ps stat ${st})`);
  });

  it('WORKPLAN_TICK_TIMEOUT at or past the 3600 s lock reap falls back to the default', () => {
    const f = repo('fcap', { agent: printStream(STREAMS.claude.answer), env: { WORKPLAN_TICK_TIMEOUT: '3600' } });
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /WORKPLAN_TICK_TIMEOUT=3600 must be 1\.\.3599 s — using 2700/);
  });

  it('an agent CLI that is not installed counts as a failed run (rc=127), not a FATAL loop', () => {
    const f = repo('fmissing', { env: { WORKPLAN_FAIL_LIMIT: '1' } });
    const r = f.tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(f.block(), /last: could not be started \(rc=127\)/);
    assert.match(f.block(), /not installed, not executable, or not on the PATH/);
  });

  it("a failing run that moved VERSION or wrote BLOCKED.md keeps the tick's own verdict", () => {
    const f = repo('fverdict', { agent: "printf 'v1.1-pre\\n' > memory-plan/plans/fverdict/VERSION\nexit 1" });
    f.seedFails(2);
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.fails(), null, 'a run that moved VERSION was counted as a failure');
    assert.equal(f.block(), null);

    const g = repo('fown', { agent: "printf '**Trigger**: own reason\\n' > memory-plan/plans/fown/BLOCKED.md\nexit 1" });
    g.seedFails(2);
    const rb = g.tick();
    assert.equal(rb.status, 2, rb.stdout + rb.stderr);
    assert.equal(g.block(), '**Trigger**: own reason\n', "the wrapper overwrote the tick's own BLOCKED.md");
    assert.equal(g.fails(), null);
  });

  // An exit-0 run that changed nothing is good only if the provider answered.
  // Metadata (init, usage, an empty result) counted as output, so a CLI that
  // answered nothing deleted .agent-failures on every tick and never blocked.
  for (const provider of ['claude', 'codex', 'gemini']) {
    it(`${provider}: a metadata-only exit-0 run counts to 3, then blocks and auto-pauses`, () => {
      const f = repo(`fempty${provider}`, { provider, agent: printStream(STREAMS[provider].empty),
        env: { WORKPLAN_AUTOPAUSE: '1', WORKPLAN_PLIST_LABEL: 'test.empty' } });
      for (const k of [1, 2]) {
        const r = f.tick();
        assert.equal(r.status, 1, r.stdout + r.stderr);
        assert.match(r.stdout, new RegExp(`agent run failed \\(${k}/3 in a row\\): ${provider} exited 0 without an answer \\(\\d+ JSON record\\(s\\), none an answer\\) and changed nothing`));
        assert.equal(f.fails(), String(k));
        assert.equal(f.block(), null);
      }
      const r = f.tick();
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(f.block(), new RegExp(`^\\*\\*Trigger\\*\\*: agent CLI ${provider} failed 3 runs in a row — last: exited 0 without an answer`, 'm'));
      assert.match(f.block(), /^- Last exit code: 0$/m);
      assert.equal(f.fails(), null);
      assert.match(f.launchctl(), /^disable gui\/\d+\/test\.empty$/m);
      assert.match(f.launchctl(), /^bootout gui\/\d+\/test\.empty$/m);
    });

    it(`${provider}: a real answer is a good run and resets the count`, () => {
      const f = repo(`fanswer${provider}`, { provider, agent: printStream(STREAMS[provider].answer) });
      f.seedFails(2);
      const r = f.tick();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(f.fails(), null);
      assert.equal(f.block(), null);
    });

    it(`${provider}: metadata-only output with committed work is a good run`, () => {
      const f = repo(`fwork${provider}`, { provider,
        agent: `${GIT} commit -q --allow-empty -m work\n${printStream(STREAMS[provider].empty)}` });
      f.seedFails(2);
      const r = f.tick();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(f.fails(), null);
    });
  }

  it('an empty or error result is no answer; a bare {"type":"result"} is no answer', () => {
    for (const [name, stream] of [
      ['bare', [{ type: 'result' }]],
      ['error', [{ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' }]],
      ['initonly', [{ type: 'system', subtype: 'init', session_id: 's' }]],
      ['thinking', [{ type: 'result', is_error: false, result: 'Thinking...\nthe plan\n...done thinking.' }]],
    ]) {
      const f = repo(`fres${name}`, { agent: printStream(stream), env: { WORKPLAN_FAIL_LIMIT: '1' } });
      const r = f.tick();
      assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(f.block(), /last: exited 0 without an answer/, name);
    }
  });

  it('a metadata-only run that changed tracked files is a good run, even uncommitted', () => {
    const f = repo('fedit', { agent: `echo edit >> memory-plan/plans/fedit/INVENTORY.md\n${printStream(STREAMS.claude.empty)}` });
    f.seedFails(2);
    const r = f.tick();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(f.fails(), null);
  });

  it('on an in-flight dirty tree, "changed nothing" compares against the tree the tick started on', () => {
    const f = repo('finflight', { version: 'v1.1-pre', agent: printStream(STREAMS.claude.empty), env: { WORKPLAN_FAIL_LIMIT: '2' } });
    fs.appendFileSync(path.join(f.plan, 'INVENTORY.md'), 'half-done\n');
    const r = f.tick();
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /info: tree dirty but VERSION=v1\.1-pre \(in-flight\); proceeding/);
    assert.match(r.stdout, /agent run failed \(1\/2 in a row\): claude exited 0 without an answer/);
    f.setAgent(`echo more >> memory-plan/plans/finflight/INVENTORY.md\n${printStream(STREAMS.claude.empty)}`);
    const moved = f.tick();
    assert.equal(moved.status, 0, moved.stdout + moved.stderr);
    assert.equal(f.fails(), null, 'a run that edited the already-dirty tree was counted as a failure');
  });

  it('when the answer cannot be checked, the run fails closed and says why', () => {
    const f = repo('fnocheck', { agent: printStream(STREAMS.claude.answer), env: { WORKPLAN_FAIL_LIMIT: '1' } });
    const node = path.join(f.bin, 'node');
    fs.rmSync(node);
    fs.writeFileSync(node, '#!/bin/bash\necho "node: broken" >&2\nexit 3\n');
    fs.chmodSync(node, 0o755);
    const r = f.tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(f.block(), /last: exited 0 and changed nothing, and its answer could not be checked \(rc=3: node: broken\)/);
  });
});

describe("plan-tick runs the plan's agent CLI chosen by WORKPLAN_AGENT_PROVIDER", () => {
  const ID = 'tagent';
  const GIT = 'git -c user.name=t -c user.email=t@t';
  const AGENTS = ['claude', 'codex', 'gemini'];
  let n = 0;

  function agentTick({ provider, installed = AGENTS, args = [] } = {}) {
    const root = path.join(tmp, `agentrepo${++n}`);
    const plan = path.join(root, 'memory-plan', 'plans', ID);
    fs.mkdirSync(plan, { recursive: true });
    fs.mkdirSync(path.join(root, 'workspace-bin'));
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), path.join(root, 'workspace-bin', 'plan-tick.sh'));
    fs.writeFileSync(path.join(root, 'workspace-bin', 'plan-lint.sh'),
      '#!/bin/bash\necho "summary: 1 PASS · 0 WARN · 0 FAIL → CONFORMANT"\n');
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '| 1 | 1.1 | v1.1 | [ ] | open step |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'the tick prompt\n');
    assert.equal(spawnSync('bash', ['-c', `git init -q . && git add -A && ${GIT} commit -q -m seed`], { cwd: root }).status, 0);
    const bin = path.join(tmp, `agentbin${n}`);
    const seen = path.join(tmp, `agentseen${n}`);
    fs.mkdirSync(bin);
    fs.mkdirSync(seen);
    for (const name of installed) {
      fs.writeFileSync(path.join(bin, name),
        `#!/bin/bash\nprintf '%s\\n' "$@" > '${seen}/${name}.argv'\ncat > '${seen}/${name}.stdin'\n${printStream(STREAMS[name].answer)}\n`);
      fs.chmodSync(path.join(bin, name), 0o755);
    }
    provisionAnswerCheck(root, bin);
    const home = path.join(tmp, `agenthome${n}`);
    fs.mkdirSync(home);
    // A bare PATH: a real agent CLI on the developer's machine must not stand in for a missing fake.
    const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, TMPDIR: tmp, WORKPLAN_CLOSE_CHECK: 'none',
      ...(provider === undefined ? {} : { WORKPLAN_AGENT_PROVIDER: provider }) };
    const r = spawnSync('bash', [path.join(root, 'workspace-bin', 'plan-tick.sh'), ID, ...args], { encoding: 'utf8', env });
    const ran = AGENTS.filter((a) => fs.existsSync(path.join(seen, `${a}.argv`)));
    const argv = (a) => fs.readFileSync(path.join(seen, `${a}.argv`), 'utf8').split('\n').slice(0, -1);
    const stdin = (a) => fs.readFileSync(path.join(seen, `${a}.stdin`), 'utf8');
    return { r, ran, argv, stdin, home, root };
  }

  it('without a provider the tick runs claude with the argv it always had', () => {
    const t = agentTick();
    assert.equal(t.r.status, 0, t.r.stdout + t.r.stderr);
    assert.deepEqual(t.ran, ['claude']);
    assert.deepEqual(t.argv('claude'), [
      '--print',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Bash(node:*),Bash(nats:*),Bash(/opt/homebrew/bin/nats:*),Bash(curl:*),Bash(lsof:*),Bash(npm:*),Bash(git:*),Bash(jq:*),Bash(launchctl:*)',
      '--add-dir', path.join(t.home, '.openclaw', 'workspace'),
      '--add-dir', path.join(t.home, '.openclaw'),
      '--output-format', 'stream-json',
      '--verbose',
    ]);
    assert.equal(t.stdin('claude'), 'the tick prompt\n');
  });

  it('codex runs headless through exec with the prompt on stdin', () => {
    const t = agentTick({ provider: 'codex' });
    assert.equal(t.r.status, 0, t.r.stdout + t.r.stderr);
    assert.deepEqual(t.ran, ['codex']);
    assert.deepEqual(t.argv('codex'), ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json', '-']);
    assert.equal(t.stdin('codex'), 'the tick prompt\n');
  });

  it('gemini runs headless with the same extra directories claude gets', () => {
    const t = agentTick({ provider: 'gemini' });
    assert.equal(t.r.status, 0, t.r.stdout + t.r.stderr);
    assert.deepEqual(t.ran, ['gemini']);
    assert.deepEqual(t.argv('gemini'), [
      '--approval-mode', 'yolo',
      '--include-directories', path.join(t.home, '.openclaw', 'workspace'),
      '--include-directories', path.join(t.home, '.openclaw'),
      '--output-format', 'stream-json',
    ]);
    assert.equal(t.stdin('gemini'), 'the tick prompt\n');
  });

  it('an unknown provider is refused before the lock and no agent runs', () => {
    const t = agentTick({ provider: 'ollama' });
    assert.equal(t.r.status, 1, t.r.stdout + t.r.stderr);
    assert.match(t.r.stdout, /FATAL: unknown agent_provider 'ollama' \(claude, codex or gemini\)/);
    assert.deepEqual(t.ran, []);
    assert.equal(fs.existsSync(path.join(t.root, 'memory-plan', '.tick.lock')), false);
  });

  // follow-up#14 step 1: a missing CLI is a failed run (rc=127) counted toward
  // WORKPLAN_FAIL_LIMIT, not a FATAL the chain relaunches forever.
  it("a chosen provider whose CLI is missing is a failed run naming it, even when claude is installed", () => {
    const t = agentTick({ provider: 'codex', installed: ['claude'] });
    assert.equal(t.r.status, 1, t.r.stdout + t.r.stderr);
    assert.match(t.r.stdout, /agent run failed \(1\/3 in a row\): codex could not be started \(rc=127\)/);
    assert.deepEqual(t.ran, []);
  });

  it('BLOCKED.md names the chosen provider\'s CLI, and the log markers name it', () => {
    const t = agentTick({ provider: 'gemini', installed: [] });
    const blockFile = path.join(t.root, 'memory-plan', 'plans', ID, 'BLOCKED.md');
    const tick = () => spawnSync('bash', [path.join(t.root, 'workspace-bin', 'plan-tick.sh'), ID],
      { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: t.home, TMPDIR: tmp, WORKPLAN_CLOSE_CHECK: 'none', WORKPLAN_AGENT_PROVIDER: 'gemini' } });
    tick();
    const r = tick();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(fs.readFileSync(blockFile, 'utf8'), /^\*\*Trigger\*\*: agent CLI gemini failed 3 runs in a row — last: could not be started \(rc=127\)$/m);
    const logs = path.join(t.root, 'memory-plan', 'plans', ID, 'tick-logs');
    const last = fs.readdirSync(logs).filter((f) => /^\d{8}-\d{6}\.log$/.test(f)).sort().pop();
    const text = fs.readFileSync(path.join(logs, last), 'utf8');
    assert.match(text, /^## ─── live gemini work ───$/m);
    assert.match(text, /^## ─── end gemini \(rc=127\) ───$/m);
  });

  it('the claude default keeps its log markers byte for byte', () => {
    const t = agentTick();
    const logs = path.join(t.root, 'memory-plan', 'plans', ID, 'tick-logs');
    const last = fs.readdirSync(logs).filter((f) => /^\d{8}-\d{6}\.log$/.test(f)).sort().pop();
    const text = fs.readFileSync(path.join(logs, last), 'utf8');
    assert.match(text, /^## ─── live claude work ───$/m);
    assert.match(text, /^## ─── end claude \(rc=0\) ───$/m);
    assert.match(t.r.stdout, /\] claude exited rc=0 after \d+s$/m);
  });

  it('--preflight reports the chosen agent CLI', () => {
    assert.match(agentTick({ provider: 'gemini', args: ['--preflight'] }).r.stdout, /\[tagent\] gemini CLI: {2}present$/m);
    assert.match(agentTick({ provider: 'codex', installed: [], args: ['--preflight'] }).r.stdout,
      /\[tagent\] codex CLI: {2}MISSING \(a real tick would fail with rc=127\)$/m);
    assert.match(agentTick({ args: ['--preflight'] }).r.stdout, /\[tagent\] claude CLI: {2}present$/m);
    assert.match(agentTick({ provider: 'ollama', args: ['--preflight'] }).r.stdout,
      /\[tagent\] agent CLI: {3}'ollama' is not a known agent_provider \(real tick would FATAL\)$/m);
  });
});

describe('new-plan.sh — refuses an id whose shim would be the engine', () => {
  let root;
  const scaffold = (id) =>
    spawnSync('bash', [path.join(root, 'workspace-bin', 'new-plan.sh'), id], { encoding: 'utf8' });

  before(() => {
    root = path.join(tmp, 'newplanrepo');
    const bin = path.join(root, 'workspace-bin');
    const tpl = path.join(root, 'memory-plan', 'canonical', 'templates');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(tpl, { recursive: true });
    for (const s of ['new-plan.sh', 'plan-tick.sh']) fs.copyFileSync(path.join(REPO, 'workspace-bin', s), path.join(bin, s));
    for (const s of ['sync-canonical.sh', 'plan-lint.sh']) {
      fs.writeFileSync(path.join(bin, s), '#!/bin/bash\nexit 0\n');
      fs.chmodSync(path.join(bin, s), 0o755);
    }
    fs.copyFileSync(path.join(REPO, 'memory-plan', 'canonical', 'templates', 'automation.template.json'),
      path.join(tpl, 'automation.template.json'));
  });

  it("id 'plan' is refused before anything is scaffolded", () => {
    const r = scaffold('plan');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /refusing: id 'plan'/);
    assert.equal(fs.existsSync(path.join(root, 'memory-plan', 'plans', 'plan')), false);
  });

  it('an ordinary id gets its own shim fronting the engine', () => {
    const r = scaffold('demo');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(root, 'workspace-bin', 'demo-tick.sh'), 'utf8'), /plan-tick\.sh" demo "\$@"/);
  });
});
