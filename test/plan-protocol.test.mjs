import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// plan-lint and plan-tick derive their repo root from their own location, so
// their suites build disposable fake repos and copy the script under test in.
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-protocol-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

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

describe('plan-tick — the plan-lint gate opens only on a CONFORMANT verdict', () => {
  const ID = 'tgate';
  let root, plan, tick, bin, home, marker;

  before(() => {
    root = path.join(tmp, 'tickrepo');
    plan = path.join(root, 'memory-plan', 'plans', ID);
    bin = path.join(tmp, 'tickbin');
    home = path.join(tmp, 'tickhome');
    marker = path.join(tmp, 'claude-invoked');
    for (const d of [path.join(root, 'workspace-bin'), plan, bin, home]) fs.mkdirSync(d, { recursive: true });
    assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
    tick = path.join(root, 'workspace-bin', 'plan-tick.sh');
    fs.copyFileSync(path.join(REPO, 'workspace-bin', 'plan-tick.sh'), tick);
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), '# INV\n\n| 1 | 1.1 | v1.1 | [ ] | open |\n');
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.0\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/bash\ncat >/dev/null\ntouch '${marker}'\n`, { mode: 0o755 });
  });

  // lint: the body of a stub plan-lint.sh, or null for no plan-lint.sh at all.
  function tickWith(lint, ...args) {
    const stub = path.join(root, 'workspace-bin', 'plan-lint.sh');
    const block = path.join(plan, 'BLOCKED.md');
    for (const f of [stub, block, marker]) fs.rmSync(f, { force: true });
    if (lint !== null) fs.writeFileSync(stub, `#!/bin/bash\n${lint}\n`, { mode: 0o755 });
    const r = spawnSync('bash', [tick, ID, ...args], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, WORKPLAN_AUTOPAUSE: '0', WORKPLAN_LINT_GATE: '1', DRY_RUN: '0' },
    });
    return { ...r, blocked: fs.existsSync(block) ? fs.readFileSync(block, 'utf8') : null, claudeRan: fs.existsSync(marker) };
  }

  it('blocks without invoking claude when the lint dies before its summary line', () => {
    const r = tickWith('echo "plan-lint: tgate"\necho "  [PASS] steps        all open rows carry the §11 contract"\nexit 1');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.claudeRan, false);
    assert.match(r.blocked, /^\*\*Trigger\*\*: plan-lint did not finish \(exit 1, no usable verdict\)/m);
    assert.match(r.blocked, /all open rows carry the §11 contract/);
    assert.match(r.blocked, /^\*\*External action:\*\*/m);
  });

  it('blocks when plan-lint.sh is missing', () => {
    const r = tickWith(null);
    assert.equal(r.claudeRan, false);
    assert.match(r.blocked, /plan-lint did not finish \(exit 127, no usable verdict\)/);
  });

  it('blocks when a CONFORMANT summary comes with a failing exit code', () => {
    const r = tickWith('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"\nexit 2');
    assert.equal(r.claudeRan, false);
    assert.match(r.blocked, /plan-lint did not finish \(exit 2, no usable verdict\)/);
  });

  it('blocks on a NONCONFORMANT verdict', () => {
    const r = tickWith('echo "  [FAIL] history      tick-logs/ missing"\necho "summary: 1 PASS · 0 WARN · 1 FAIL → NONCONFORMANT"\nexit 1');
    assert.equal(r.claudeRan, false);
    assert.match(r.blocked, /^\*\*Trigger\*\*: plan-lint NONCONFORMANT/m);
  });

  it('runs the tick on a CONFORMANT verdict', () => {
    const r = tickWith('echo "summary: 9 PASS · 0 WARN · 0 FAIL → CONFORMANT"');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.blocked, null);
    assert.equal(r.claudeRan, true);
  });

  it('--preflight reports a lint that did not finish', () => {
    const r = tickWith('echo "plan-lint: tgate"\nexit 1', '--preflight');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /conformance: tgate — plan-lint did not finish \(exit 1, no usable verdict\)/);
  });
});

describe('plan-lint — [D] deferred state and drift checks', () => {
  let root, lint;
  const CANON_DOCS = ['MASTER_PLAN.md', 'PROTOCOL.md', 'FRAMEWORK_CANONICAL.md', 'COWORK_MODEL.md', 'BLOCK_TEMPLATE.md'];

  function silo(id, { inventory }) {
    const plan = path.join(root, 'memory-plan', 'plans', id);
    fs.mkdirSync(path.join(plan, 'tick-logs'), { recursive: true });
    fs.mkdirSync(path.join(plan, 'audits'), { recursive: true });
    for (const d of CANON_DOCS) fs.copyFileSync(path.join(root, 'memory-plan', 'canonical', d), path.join(plan, d));
    fs.writeFileSync(path.join(plan, 'INVENTORY.md'), inventory);
    fs.writeFileSync(path.join(plan, 'VERSION'), 'v1.1\n');
    fs.writeFileSync(path.join(plan, 'DECISIONS.md'), '## D1 — exists (2026-07-04)\n');
    fs.writeFileSync(path.join(plan, 'COMPONENT_REGISTRY.md'), '## Family 1: x\n| **Status** | ok |\n');
    fs.writeFileSync(path.join(plan, 'ROADMAP.md'), '# roadmap\n');
    fs.writeFileSync(path.join(plan, 'TICK_PROMPT.md'), 'tick\n');
    const shim = path.join(root, 'workspace-bin', `${id}-tick.sh`);
    fs.writeFileSync(shim, '#!/bin/bash\ntrue\n');
    fs.chmodSync(shim, 0o755);
    fs.writeFileSync(path.join(plan, 'automation.json'),
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

});
