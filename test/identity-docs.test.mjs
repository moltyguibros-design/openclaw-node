import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// install.sh and mesh-deploy copy identity/*.md into every node's workspace,
// Linux workers included, so these docs must hold for any node.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const docs = fs.readdirSync(path.join(ROOT, 'identity')).filter(f => f.endsWith('.md'))
  .map(f => [f, fs.readFileSync(path.join(ROOT, 'identity', f), 'utf8')]);

test('shipped identity docs carry no operator-specific home paths', () => {
  for (const [f, text] of docs) assert.doesNotMatch(text, /\/Users\/[^/\s`]+\//, f);
});

test('every skills/<name>/SKILL.md an identity doc points at ships', () => {
  for (const [f, text] of docs) {
    for (const [, name] of text.matchAll(/skills\/([\w-]+)\/SKILL\.md/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'skills', name, 'SKILL.md')), `${f} -> skills/${name}/SKILL.md`);
    }
  }
});

test('numbered lists in identity docs count up without gaps', () => {
  for (const [f, text] of docs) {
    let prev = 0, fenced = false;
    text.split('\n').forEach((line, i) => {
      if (/^```/.test(line)) fenced = !fenced;
      if (fenced) return;
      if (/^#/.test(line)) { prev = 0; return; }
      const n = Number(line.match(/^(\d+)\. /)?.[1]);
      if (!n) return;
      assert.ok(n === 1 || n === prev + 1, `${f}:${i + 1} item ${n} follows ${prev}`);
      prev = n;
    });
  }
});

test('AGENTS.md "Every Session" is the one boot list, and CLAUDE.md points at it', () => {
  const read = (f) => docs.find(([name]) => name === f)[1];
  const everySession = read('AGENTS.md').match(/## Every Session\n[\s\S]*?\n## /)[0];
  assert.match(everySession, /^\d+\. Read `memory\/last-session-recap\.md`/m);
  assert.doesNotMatch(everySession, /clawvault-local wake/, 'the memory daemon runs the wake');
  const bootstrap = read('CLAUDE.md').match(/# Session Bootstrap[^\n]*\n[\s\S]*?\n# /)[0];
  assert.doesNotMatch(bootstrap, /^\d+\. /m, 'CLAUDE.md must not carry a second boot list');
  assert.match(bootstrap, /AGENTS\.md.*"Every Session"/);
  for (const [f, text] of docs) assert.doesNotMatch(text, /bin\/memory-daemon(?!\.mjs)/, f);
});

test('every identity doc is installed into the workspace or referenced from outside identity/', () => {
  const installed = fs.readFileSync(path.join(ROOT, 'scripts/install/workspace.sh'), 'utf8')
    .match(/^for f in (.+); do\n  if \[ -f "\$REPO_DIR\/identity\/\$f" \]/m)[1].split(' ');
  for (const [f] of docs) {
    if (installed.includes(f)) continue;
    const r = spawnSync('git', ['grep', '-l', '-F', '-e', f, '--', '.', ':!memory-plan', ':!identity'], { cwd: ROOT, encoding: 'utf8' });
    assert.ok(r.stdout.trim(), `identity/${f} is neither installed nor referenced`);
  }
});

// soul-prompt and POST /api/souls/daedalus/prompt build the daedalus preamble
// from the souls copy, so it must not drift from the workspace identity.
test('the daedalus soul mirrors the workspace SOUL and PRINCIPLES', () => {
  for (const f of ['SOUL.md', 'PRINCIPLES.md']) {
    assert.equal(fs.readFileSync(path.join(ROOT, 'souls', 'daedalus', f), 'utf8'), fs.readFileSync(path.join(ROOT, 'identity', f), 'utf8'), f);
  }
});

test('HEARTBEAT.md claims no commit gate the installer never enables and no single node\'s eval numbers', () => {
  const text = docs.find(([f]) => f === 'HEARTBEAT.md')[1];
  assert.doesNotMatch(text, /95\.9%|Pre-commit hook active|active via core\.hooksPath/);
  assert.match(text, /bash skills\/openclaw-skill-scanner\/install-hook\.sh <clawhub-slug>/);
});

// AGENTS.md asks first for anything that leaves the machine; the unattended
// heartbeat listed pushing and committing others' work as safe without asking.
test('HEARTBEAT.md never lets the unattended agent push or commit work it did not author', () => {
  const text = docs.find(([f]) => f === 'HEARTBEAT.md')[1];
  const safe = text.match(/## Proactive Work \(safe to do without asking\)\n([\s\S]*?)\n## /)[1];
  for (const line of safe.split('\n').filter((l) => l.startsWith('- '))) {
    assert.doesNotMatch(line.replace('(ask before pushing)', ''), /\bpush/i, line);
    assert.doesNotMatch(line, /commit[^\n]*uncommitted work/i, line);
  }
  assert.match(safe, /Commit your own changes \(ask before pushing\)/);
  assert.match(text, /`uncommitted_work`: report it; commit only your own changes/);
});

// soul-prompt only prints a soul's tool list and restricted actions into its
// preamble; every shipped soul lists Bash or Write, so all start with full tools.
test('DELEGATION.md presents soul tool lists as advisory, not enforced', () => {
  const text = docs.find(([f]) => f === 'DELEGATION.md')[1];
  assert.doesNotMatch(text, /enforced by `?soul-prompt`?/);
  assert.match(text, /advisory/);
  assert.match(text, /lib\/soul-memory-access\.mjs/);
  assert.doesNotMatch(text, /only has read-only tools/);
});

// memory-maintenance stopped archiving daily files in June (checkArchival went with the
// hourly daily-log writer) and exits 0 on warnings.
test('identity docs describe memory-maintenance as it runs: no archival, no exit 1', () => {
  for (const f of ['HEARTBEAT.md', 'AGENTS.md', 'MEMORY_SPEC.md']) {
    const text = docs.find(([name]) => name === f)[1];
    text.split('\n').forEach((line, i) => {
      if (/memory-maintenance|ARCHIVAL:/.test(line)) assert.doesNotMatch(line, /archiv/i, `${f}:${i + 1}`);
    });
  }
  assert.doesNotMatch(docs.find(([f]) => f === 'MEMORY_SPEC.md')[1], /Exit 1/);
  const src = fs.readFileSync(path.join(ROOT, 'workspace-bin', 'memory-maintenance.mjs'), 'utf8');
  const body = src.match(/results\.length = 0;\n([\s\S]*?)\n\n/)[1];
  const calls = body.match(/^\s+(await )?check\w+\(\);$/gm).length;
  assert.equal(Number(src.match(/Runs (\d+) systematic checks/)[1]), calls);
});

// Nothing archives daily files any more, so no doc may require, check or promise it.
// memory/archive/ itself stays: it holds the monthly summaries.
test('no identity doc promises daily-file archival', () => {
  for (const [f, text] of docs) {
    text.split('\n').forEach((line, i) => {
      if (/archiv/i.test(line)) assert.doesNotMatch(line, /dail(y|ies)|30\s*d/i, `${f}:${i + 1}`);
    });
  }
});
