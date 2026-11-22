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
