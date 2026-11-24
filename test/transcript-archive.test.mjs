import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '../workspace-bin/archive-transcripts.sh');

test('real archive filters transcripts, updates existing copies and retains removed sources', t => {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-archive-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const project = join(home, '.claude/projects/project with spaces/nested');
  const sessions = join(home, '.openclaw/agents/main/sessions');
  mkdirSync(project, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  const claude = join(project, 'conversation.jsonl');
  const gateway = join(sessions, 'session.jsonl');
  const unrelated = join(project, 'settings.json');
  writeFileSync(claude, '{"text":"bonjour"}\n');
  writeFileSync(gateway, '{"text":"gateway"}\n');
  writeFileSync(unrelated, '{"retain":"source only"}\n');
  const run = () => {
    const result = spawnSync('/bin/sh', [script], {
      env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/local/bin' },
      encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  run();
  const archive = join(home, '.openclaw/transcript-archive');
  const savedClaude = join(archive, 'claude-projects/project with spaces/nested/conversation.jsonl');
  const savedGateway = join(archive, 'gateway-sessions/session.jsonl');
  assert.equal(readFileSync(savedClaude, 'utf8'), readFileSync(claude, 'utf8'));
  assert.equal(readFileSync(savedGateway, 'utf8'), readFileSync(gateway, 'utf8'));
  assert.equal(existsSync(join(archive, 'claude-projects/project with spaces/nested/settings.json')), false);
  assert.equal(readFileSync(unrelated, 'utf8'), '{"retain":"source only"}\n');
  writeFileSync(claude, '{"text":"bonjour"}\n{"text":"updated transcript"}\n');
  run();
  assert.equal(readFileSync(savedClaude, 'utf8'), readFileSync(claude, 'utf8'));
  unlinkSync(claude);
  unlinkSync(gateway);
  run();
  assert.equal(readFileSync(savedClaude, 'utf8'), '{"text":"bonjour"}\n{"text":"updated transcript"}\n');
  assert.equal(readFileSync(savedGateway, 'utf8'), '{"text":"gateway"}\n');
  const lines = readFileSync(join(archive, 'archive.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  for (const line of lines) assert.match(line, /archived ok — 2 transcripts,/);
});

function runWithRsyncExit(t, code) {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-archive-rc-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.claude/projects/p'), { recursive: true });
  writeFileSync(join(home, '.claude/projects/p/c.jsonl'), '{}\n');
  const bin = join(home, 'fakebin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'rsync'), `#!/bin/sh\necho "rsync: simulated failure" >&2\nexit ${code}\n`);
  chmodSync(join(bin, 'rsync'), 0o755);
  const result = spawnSync('/bin/sh', [script], {
    env: { ...process.env, HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8', timeout: 10_000,
  });
  const log = readFileSync(join(home, '.openclaw/transcript-archive/archive.log'), 'utf8');
  return { result, log };
}

test('a failing rsync is logged as FAILED and exits non-zero, not "archived ok"', t => {
  const { result, log } = runWithRsyncExit(t, 11);
  assert.notEqual(result.status, 0);
  assert.match(log, /archive FAILED \(rsync rc=11\)/);
  assert.doesNotMatch(log, /archived ok/);
  assert.match(result.stderr, /rsync: simulated failure/);
  assert.match(result.stderr, /archive FAILED \(rsync rc=11\)/);
});

test('rsync partial-transfer and vanished-file exits (23/24) still count as archived', t => {
  for (const code of [23, 24]) {
    const { result, log } = runWithRsyncExit(t, code);
    assert.equal(result.status, 0, result.stderr);
    assert.match(log, /archived ok/);
  }
});

test('every enabled registry source outside the two default roots is archived under sources/<name>', t => {
  const home = mkdtempSync(join(tmpdir(), 'openclaw-archive-reg-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const extra = join(home, 'kimi/sessions');
  const disabled = join(home, 'old/sessions');
  const covered = join(home, '.claude/projects/-ws');
  for (const dir of [extra, disabled, covered]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(extra, 'k.jsonl'), '{"text":"kimi"}\n');
  writeFileSync(join(extra, 'notes.txt'), 'skip\n');
  writeFileSync(join(disabled, 'd.jsonl'), '{}\n');
  writeFileSync(join(covered, 'c.jsonl'), '{}\n');
  mkdirSync(join(home, '.openclaw/config'), { recursive: true });
  const registry = join(home, '.openclaw/config/transcript-sources.json');
  writeFileSync(registry, JSON.stringify({ sources: [
    { name: 'claude-code-workspace', path: '~/.claude/projects/-ws/', format: 'claude-code', enabled: true },
    { name: 'gateway', path: '~/.openclaw/agents/main/sessions/', format: 'openclaw-gateway', enabled: true },
    { name: 'kimi', path: '~/kimi/sessions/', format: 'generic', enabled: true },
    { name: 'old', path: disabled, format: 'generic', enabled: false },
  ] }));
  const run = () => spawnSync('/bin/sh', [script], {
    env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin:/usr/local/bin' }, encoding: 'utf8', timeout: 10_000,
  });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  const archive = join(home, '.openclaw/transcript-archive');
  assert.equal(readFileSync(join(archive, 'sources/kimi/k.jsonl'), 'utf8'), '{"text":"kimi"}\n');
  assert.equal(existsSync(join(archive, 'sources/kimi/notes.txt')), false);
  assert.equal(existsSync(join(archive, 'sources/old')), false);
  assert.equal(existsSync(join(archive, 'sources/claude-code-workspace')), false);
  assert.equal(existsSync(join(archive, 'claude-projects/-ws/c.jsonl')), true);
  assert.match(readFileSync(join(archive, 'archive.log'), 'utf8'), /archived ok — 2 transcripts,/);

  writeFileSync(registry, '{ not json');
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(readFileSync(join(archive, 'archive.log'), 'utf8'), /archive FAILED \(unreadable .*transcript-sources\.json\)/);
});
