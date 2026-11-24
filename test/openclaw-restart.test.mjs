import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'bin/openclaw-restart.sh');

// `launchctl list <label>` output: a property-list dict whose last line is `};`.
const RUNNING_DICT = `{
\t"LimitLoadToSessionType" = "Aqua";
\t"Label" = "ai.openclaw.memory-daemon";
\t"OnDemand" = false;
\t"LastExitStatus" = 9;
\t"PID" = 31660;
\t"Program" = "/usr/local/bin/node";
};`;
const STOPPED_DICT = '{\n\t"Label" = "ai.openclaw.memory-daemon";\n\t"LastExitStatus" = 0;\n};';

describe('openclaw-restart.sh', () => {
  let root;
  before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-restart-')); });
  after(() => { fs.rmSync(root, { recursive: true, force: true }); });

  // Stubs for uname plus the service managers; every call is logged, and pgrep/kill
  // are stubbed so a regression to signalling processes by pattern is caught.
  const run = (name, { os: osName, launchctl = 'exit 1', systemctl = 'exit 1' }, args = ['--status']) => {
    const stubBin = path.join(root, name);
    const log = path.join(stubBin, 'calls.log');
    fs.mkdirSync(stubBin);
    const stub = (cmd, body) => fs.writeFileSync(path.join(stubBin, cmd),
      `#!/bin/sh\necho "${cmd} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
    stub('uname', `echo ${osName}`);
    stub('launchctl', launchctl);
    stub('systemctl', systemctl);
    stub('pgrep', 'exit 1');
    stub('kill', 'exit 1');
    const r = spawnSync('bash', [script, ...args], {
      env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 10000,
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { ...r, calls };
  };

  it('reads the PID from the launchctl dict when the job is running', () => {
    const r = run('running', { os: 'Darwin', launchctl: `cat <<'EOF'\n${RUNNING_DICT}\nEOF` });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ai\.openclaw\.memory-daemon\s+running \(pid=31660\)/);
  });

  it('reports a registered job with no PID line as not running', () => {
    const r = run('stopped', { os: 'Darwin', launchctl: `cat <<'EOF'\n${STOPPED_DICT}\nEOF` });
    assert.match(r.stdout, /ai\.openclaw\.memory-daemon\s+registered \(not running\)/);
  });

  it('reports an unknown label as not registered', () => {
    const r = run('absent', { os: 'Darwin' });
    assert.match(r.stdout, /ai\.openclaw\.memory-daemon\s+not registered/);
    assert.match(r.stdout, /ai\.openclaw\.health-watch\s+not registered/);
  });

  it('macOS restart kickstarts both managed labels and signals nothing by pattern', () => {
    const r = run('mac-restart', { os: 'Darwin', launchctl: 'exit 0' }, ['restart']);
    assert.equal(r.status, 0, r.stderr);
    const uid = process.getuid();
    assert.ok(r.calls.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.memory-daemon`), r.calls.join('\n'));
    assert.ok(r.calls.includes(`launchctl kickstart -k gui/${uid}/ai.openclaw.health-watch`), r.calls.join('\n'));
    assert.ok(!r.calls.some((c) => /^(pgrep|kill) /.test(c)), r.calls.join('\n'));
  });

  it('Linux restart uses systemctl --user on the openclaw-* units and reports their PIDs', () => {
    const r = run('linux-restart', { os: 'Linux',
      systemctl: 'case "$2" in show) printf "LoadState=loaded\\nActiveState=active\\nMainPID=777\\n";; esac; exit 0' }, ['restart']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.calls.includes('systemctl --user restart -- openclaw-memory-daemon.service'), r.calls.join('\n'));
    assert.ok(r.calls.includes('systemctl --user restart -- openclaw-health-watch.service'), r.calls.join('\n'));
    assert.match(r.stdout, /openclaw-health-watch\.service\s+running \(pid=777\)/);
    assert.ok(!r.calls.some((c) => /^(pgrep|kill|launchctl) /.test(c)), r.calls.join('\n'));
  });

  it('a failed restart exits non-zero instead of claiming success', () => {
    const r = run('linux-fail', { os: 'Linux',
      systemctl: 'case "$2" in show) printf "LoadState=not-found\\nActiveState=inactive\\nMainPID=0\\n"; exit 0;; esac; exit 5' }, ['restart']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /openclaw-memory-daemon\.service: restart failed/);
    assert.match(r.stdout, /openclaw-memory-daemon\.service\s+not installed/);
  });
});
